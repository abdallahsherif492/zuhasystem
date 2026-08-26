-- Migration: a worklist for orders stuck in shipping
-- Created At: 2026-08-25
--
-- 271 orders are sitting in a problem state right now — 78 Returning, 30 Hold
-- To redeliver, and 163 Shipped that have not moved in an average of 17 days —
-- together worth 152,610 EGP. None of them are lost yet: an order only becomes
-- a return when it physically reaches the warehouse. Until then a phone call
-- can still save it, and saving one is far cheaper than winning a new order
-- because the courier fee and the ad spend are already paid.
--
-- Nothing in the system surfaces them as work. They sit inside the general
-- logistics table among thousands of healthy orders.

-- ===========================================================================
-- 1. How long has it been stuck?
-- ===========================================================================
-- The single most useful sort for this screen, and the system could not
-- answer it: orders record when they were created, never when their status
-- last moved. An order created three weeks ago that shipped yesterday is
-- fine; one that has been "Returning" since Tuesday is not, and by
-- created_at they look identical.
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

-- Existing rows have no history to recover, so they start from creation.
-- That overstates the age of anything that changed status recently, which is
-- the safe direction: it surfaces orders for review rather than hiding them.
UPDATE public.orders
   SET status_changed_at = created_at
 WHERE status_changed_at IS NULL;

CREATE OR REPLACE FUNCTION public.touch_status_changed_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.status_changed_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_status_changed_at ON public.orders;
CREATE TRIGGER trg_orders_status_changed_at
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.touch_status_changed_at();

CREATE INDEX IF NOT EXISTS idx_orders_status_changed
    ON public.orders (business_id, status, status_changed_at);

-- ===========================================================================
-- 2. The follow-up trail
-- ===========================================================================
-- One row per attempt, never overwritten. Two people picking up the same
-- stuck order need to see what the other already tried — otherwise the
-- customer gets called three times with the same question, which is how a
-- recoverable order turns into a refused one.
CREATE TABLE IF NOT EXISTS public.shipping_followups (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    order_id       UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,

    -- What happened on this attempt.
    outcome        TEXT NOT NULL CHECK (outcome IN (
                       'reached_rescheduled',   -- عميل رد واتفقنا على ميعاد
                       'reached_confirmed',     -- عميل رد ومتمسك بالأوردر
                       'no_answer',             -- محدش رد
                       'phone_off',             -- الرقم مقفول
                       'wrong_number',          -- رقم غلط
                       'customer_refused',      -- العميل رفض الاستلام
                       'courier_contacted',     -- اتكلمنا مع شركة الشحن
                       'other')),
    note           TEXT,
    -- When to try again. The screen sorts overdue promises to the top.
    next_action_at DATE,
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_followups_order
    ON public.shipping_followups (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_followups_business
    ON public.shipping_followups (business_id, created_at DESC);

ALTER TABLE public.shipping_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read followups" ON public.shipping_followups;
CREATE POLICY "Members read followups"
ON public.shipping_followups FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.business_users bu
               WHERE bu.business_id = shipping_followups.business_id
                 AND bu.user_email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Members write followups" ON public.shipping_followups;
CREATE POLICY "Members write followups"
ON public.shipping_followups FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.business_users bu
               WHERE bu.business_id = shipping_followups.business_id
                 AND bu.user_email = auth.jwt() ->> 'email'))
WITH CHECK (EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = shipping_followups.business_id
                      AND bu.user_email = auth.jwt() ->> 'email'));

-- ===========================================================================
-- 3. Which statuses count as "stuck"
-- ===========================================================================
-- Returning and Hold To redeliver are explicit courier problems. Shipped is
-- only a problem once it has sat too long — a parcel shipped this morning is
-- healthy, the same parcel three weeks later is not, and the caller decides
-- where that line falls.
CREATE OR REPLACE FUNCTION public.get_shipping_issues(
    p_business_id UUID,
    p_stale_days  INTEGER DEFAULT 5
)
RETURNS TABLE (
    order_id        UUID,
    reference       TEXT,
    status          TEXT,
    bucket          TEXT,
    customer_name   TEXT,
    customer_phone  TEXT,
    governorate     TEXT,
    total_amount    NUMERIC,
    courier         TEXT,
    closed_by       TEXT,
    days_stuck      INTEGER,
    followup_count  BIGINT,
    last_followup   TIMESTAMPTZ,
    last_outcome    TEXT,
    next_action_at  DATE
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.business_id = p_business_id
          AND bu.user_email = auth.jwt() ->> 'email'
    ) THEN
        RAISE EXCEPTION 'not a member of this business';
    END IF;

    RETURN QUERY
    WITH stuck AS (
        SELECT o.*,
               lower(btrim(coalesce(o.status, ''))) AS st,
               GREATEST(0, EXTRACT(DAY FROM now() - COALESCE(o.status_changed_at, o.created_at)))::INT AS age
        FROM public.orders o
        WHERE o.business_id = p_business_id
          AND lower(btrim(coalesce(o.status, ''))) IN ('returning', 'hold to redeliver', 'shipped')
    ),
    latest AS (
        SELECT DISTINCT ON (f.order_id)
               f.order_id, f.created_at, f.outcome, f.next_action_at
        FROM public.shipping_followups f
        WHERE f.business_id = p_business_id
        ORDER BY f.order_id, f.created_at DESC
    ),
    counts AS (
        SELECT f.order_id, COUNT(*) AS c
        FROM public.shipping_followups f
        WHERE f.business_id = p_business_id
        GROUP BY f.order_id
    )
    SELECT
        s.id,
        COALESCE(NULLIF(s.easyorders_id, ''), left(s.id::TEXT, 8)),
        s.status,
        CASE s.st
            WHEN 'returning'         THEN 'returning'
            WHEN 'hold to redeliver' THEN 'hold'
            ELSE 'stale'
        END,
        s.customer_info ->> 'name',
        s.customer_info ->> 'phone',
        s.customer_info ->> 'governorate',
        s.total_amount,
        sc.name,
        s.closed_by,
        s.age,
        COALESCE(c.c, 0),
        l.created_at,
        l.outcome,
        l.next_action_at
    FROM stuck s
    LEFT JOIN public.shipping_companies sc ON sc.id = s.shipping_company_id
    LEFT JOIN latest l ON l.order_id = s.id
    LEFT JOIN counts c ON c.order_id = s.id
    -- A shipped parcel is only work once it has gone quiet.
    WHERE s.st <> 'shipped' OR s.age >= p_stale_days
    -- Oldest first: the longest-stuck order is the one about to be lost.
    ORDER BY s.age DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shipping_issues(UUID, INTEGER) TO authenticated;

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT bucket, count(*), sum(total_amount)
--     FROM get_shipping_issues('<business id>', 5) GROUP BY bucket;

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.get_shipping_issues(UUID, INTEGER);
-- DROP TABLE IF EXISTS public.shipping_followups;
-- DROP TRIGGER IF EXISTS trg_orders_status_changed_at ON public.orders;
-- DROP FUNCTION IF EXISTS public.touch_status_changed_at();
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS status_changed_at;
