-- Migration: cancellations under suspicion, and a second try for them
-- Created At: 2026-11-07
--
-- Most cancelled store orders carry no trace of why: no failed call was
-- recorded, no reason, and the actions log that knew who cancelled keeps 30
-- days. This adds:
--
--   1. On the order: who cancelled it, when, from which status, and why
--      (cancel_reason, picked from a fixed list when cancelling from New from
--      stores; a trigger fills in who and when whatever the route).
--   2. cancellation_suspects(): cancelled orders that look given up on too
--      soon — few or no recorded calls, cancelled quickly, for no reason or
--      for "no answer" — each with a score and the reasons for it.
--   3. reopen_cancelled_orders(): puts suspects back in Waiting so sales try
--      again, keeping a record in cancellation_reopens to measure what came of
--      it (confirmed, cancelled again, still waiting).
--   4. Every morning at 9 (Cairo), the suspects of the last three days are
--      put back by themselves, for businesses that turned it on in Settings
--      (theme_config.cancellation_review.auto).
--
-- Nothing is deleted. Putting an order back in Waiting moves no stock:
-- neither Cancelled nor Waiting is a stock-out status.

-- ===========================================================================
-- 1. Who cancelled, when, from where, why
-- ===========================================================================
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by   TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_from TEXT,
    ADD COLUMN IF NOT EXISTS cancel_reason  TEXT,
    ADD COLUMN IF NOT EXISTS cancel_note    TEXT;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_cancel_reason_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_cancel_reason_check CHECK (cancel_reason IS NULL OR cancel_reason IN (
    'customer_refused', 'no_answer', 'phone_off', 'price', 'duplicate', 'wrong_number', 'fake', 'out_of_stock', 'other'));

CREATE OR REPLACE FUNCTION public.orders_track_cancel()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_now_cancelled BOOLEAN := lower(btrim(COALESCE(NEW.status, ''))) IN ('cancelled', 'canceled');
    v_was_cancelled BOOLEAN := lower(btrim(COALESCE(OLD.status, ''))) IN ('cancelled', 'canceled');
BEGIN
    IF v_now_cancelled AND NOT v_was_cancelled THEN
        NEW.cancelled_at   := now();
        NEW.cancelled_from := OLD.status;
        -- Who: whoever this update says, or the signed-in user.
        IF NEW.cancelled_by IS NOT DISTINCT FROM OLD.cancelled_by THEN
            NEW.cancelled_by := lower(auth.jwt() ->> 'email');
        END IF;
        -- Why: only what this update says; a reason left from an earlier
        -- cancellation of the same order is not this one's.
        IF NEW.cancel_reason IS NOT DISTINCT FROM OLD.cancel_reason THEN
            NEW.cancel_reason := NULL;
        END IF;
        IF NEW.cancel_note IS NOT DISTINCT FROM OLD.cancel_note THEN
            NEW.cancel_note := NULL;
        END IF;
    ELSIF v_was_cancelled AND NOT v_now_cancelled THEN
        -- Back in play: the cancellation no longer describes the order
        -- (cancellation_reopens keeps it when the reopen was ours).
        NEW.cancelled_at := NULL;
        NEW.cancelled_by := NULL;
        NEW.cancelled_from := NULL;
        NEW.cancel_reason := NULL;
        NEW.cancel_note := NULL;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_orders_track_cancel ON public.orders;
CREATE TRIGGER trg_orders_track_cancel
    BEFORE UPDATE OF status ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.orders_track_cancel();

-- Orders cancelled before today: when from status_changed_at, who and from
-- where from the actions log (it keeps 30 days; older ones stay unknown).
UPDATE public.orders o
   SET cancelled_at = COALESCE(o.status_changed_at, o.created_at)
 WHERE lower(btrim(COALESCE(o.status, ''))) IN ('cancelled', 'canceled')
   AND o.cancelled_at IS NULL;

WITH logged AS (
    SELECT DISTINCT ON (x.order_id) x.order_id, lower(a.user_email) AS who, x.from_status
      FROM public.actions_log a
      CROSS JOIN LATERAL (
          SELECT a.entity_id::text AS order_id,
                 (SELECT c ->> 'old_value' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.changes::jsonb) = 'array' THEN a.changes::jsonb ELSE '[]'::jsonb END) c
                   WHERE c ->> 'new_value' = 'Cancelled' LIMIT 1) AS from_status
          UNION ALL
          SELECT e ->> 'id', e ->> 'from'
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.metadata::jsonb -> 'orders') = 'array' THEN a.metadata::jsonb -> 'orders' ELSE '[]'::jsonb END) e
      ) x
     WHERE a.action_type = 'update_status'
       AND a.user_email IS NOT NULL
       AND x.order_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.changes::jsonb) = 'array' THEN a.changes::jsonb ELSE '[]'::jsonb END) c
                    WHERE c ->> 'new_value' = 'Cancelled')
     ORDER BY x.order_id, a.created_at DESC
)
UPDATE public.orders o
   SET cancelled_by = COALESCE(o.cancelled_by, l.who),
       cancelled_from = COALESCE(o.cancelled_from, l.from_status)
  FROM logged l
 WHERE o.id::text = l.order_id
   AND lower(btrim(COALESCE(o.status, ''))) IN ('cancelled', 'canceled');

CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at
    ON public.orders (business_id, cancelled_at)
    WHERE cancelled_at IS NOT NULL;

-- ===========================================================================
-- 2. What was put back, and by whom
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.cancellation_reopens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    order_id      UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    reopened_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    source        TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
    reopened_by   TEXT,
    score         INTEGER,
    reasons       TEXT[],
    -- The cancellation as it stood, since reopening clears it from the order.
    cancelled_at  TIMESTAMPTZ,
    cancelled_by  TEXT,
    cancel_reason TEXT,
    cancel_note   TEXT,
    -- One second try per order: a reopened order cancelled again stays cancelled.
    UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS idx_cancellation_reopens_business
    ON public.cancellation_reopens (business_id, reopened_at);

ALTER TABLE public.cancellation_reopens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cancellation_reopens_read ON public.cancellation_reopens;
CREATE POLICY cancellation_reopens_read ON public.cancellation_reopens FOR SELECT TO authenticated
    USING (business_id IN (SELECT public.get_my_business_ids()) OR public.am_i_admin_of_business(business_id));
GRANT SELECT ON public.cancellation_reopens TO authenticated;
-- Written only through reopen_cancelled_orders() and the daily run.

-- ===========================================================================
-- 3. The suspects
-- ===========================================================================
-- A cancelled order is considered only when a second try makes sense:
--   * a store or manual order of type new (not a missed form, not a return),
--     never confirmed (closed_by empty), cancelled from Waiting, nothing sent
--     to a courier, not reopened before;
--   * not cancelled for a reason that settles it (refused, duplicate, wrong
--     number, fake, price, out of stock), and no note saying so;
--   * not one of several orders from the same customer within three days.
-- Then points, 50 or more makes it a suspect:
--   no call recorded 45 · one call 25 · several calls all within one hour 15
--   cancelled within 1 hour of arriving 30 · within 6 hours 20 · same day 10
--   no reason, or "no answer" / "phone off" 10
--   EasyOrders rates the customer's deliveries high 10 (low −15)
--   the customer has received an order from us before 15
-- Cancelling for "no answer" or "phone off" counts as one call.
CREATE OR REPLACE FUNCTION public.cancellation_suspects_core(
    p_business_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_ids UUID[] DEFAULT NULL)
RETURNS TABLE (order_id UUID, score INTEGER, reasons TEXT[], cancelled_at TIMESTAMPTZ, cancelled_by TEXT,
               cancel_reason TEXT, cancel_note TEXT, attempts INTEGER, minutes_to_cancel INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    WITH c AS (
        SELECT o.id, o.created_at, o.customer_id, o.customer_info, o.notes, o.cancel_reason, o.cancel_note,
               o.cancelled_by, o.last_attempt_note, o.last_attempt_reason, COALESCE(o.confirm_attempts, 0) AS summary_attempts,
               COALESCE(o.cancelled_at, o.status_changed_at, o.created_at) AS c_at,
               right(regexp_replace(COALESCE(o.customer_info ->> 'phone', ''), '\D', '', 'g'), 10) AS phone
          FROM public.orders o
         WHERE o.business_id = p_business_id
           AND lower(btrim(COALESCE(o.status, ''))) IN ('cancelled', 'canceled')
           AND COALESCE(o.cancelled_at, o.status_changed_at, o.created_at) >= p_from
           AND COALESCE(o.cancelled_at, o.status_changed_at, o.created_at) < p_to
           AND (p_ids IS NULL OR o.id = ANY (p_ids))
           AND COALESCE(o.order_type, 'new') = 'new'
           AND COALESCE(o.tags::text, '') NOT ILIKE '%missed%'
           AND o.closed_by IS NULL
           AND lower(btrim(COALESCE(o.cancelled_from, 'waiting'))) = 'waiting'
           AND NOT COALESCE(o.stock_deducted, false)
           AND o.courier_sent_at IS NULL
           AND COALESCE(o.cancel_reason, '') NOT IN ('customer_refused', 'duplicate', 'wrong_number', 'fake', 'out_of_stock', 'price')
           AND COALESCE(o.last_attempt_reason, '') <> 'wrong_number'
           AND NOT EXISTS (SELECT 1 FROM public.cancellation_reopens r WHERE r.order_id = o.id)
    ),
    f AS (
        SELECT c.*,
               GREATEST(COALESCE(a.n, 0), c.summary_attempts)
                   + CASE WHEN c.cancel_reason IN ('no_answer', 'phone_off') THEN 1 ELSE 0 END AS calls,
               a.span,
               concat_ws(' ', c.cancel_note, c.last_attempt_note, c.notes, c.customer_info ->> 'internal_workbench_notes', a.notes) AS said,
               EXTRACT(epoch FROM (c.c_at - c.created_at)) / 60 AS mins,
               EXISTS (
                   SELECT 1 FROM public.orders x
                    WHERE x.business_id = p_business_id AND x.id <> c.id
                      AND x.created_at BETWEEN c.created_at - interval '3 days' AND c.created_at + interval '3 days'
                      AND COALESCE(x.order_type, 'new') <> 'missed'
                      AND ((c.customer_id IS NOT NULL AND x.customer_id = c.customer_id)
                           OR (length(c.phone) = 10 AND right(regexp_replace(COALESCE(x.customer_info ->> 'phone', ''), '\D', '', 'g'), 10) = c.phone))
               ) AS repeated,
               (c.customer_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.orders x
                    WHERE x.business_id = p_business_id AND x.customer_id = c.customer_id
                      AND lower(btrim(COALESCE(x.status, ''))) IN ('delivered', 'collected')
                      AND x.created_at < c.created_at
               )) AS received_before
          FROM c
          LEFT JOIN LATERAL (
              SELECT count(*)::int AS n, max(t.created_at) - min(t.created_at) AS span, string_agg(t.note, ' ') AS notes
                FROM public.order_confirmation_attempts t WHERE t.order_id = c.id
          ) a ON true
    ),
    scored AS (
        SELECT f.*, s.score, s.reasons
          FROM f
          CROSS JOIN LATERAL (
              SELECT COALESCE(sum(v.p), 0)::int AS score,
                     array_agg(v.r ORDER BY v.p DESC) FILTER (WHERE v.r IS NOT NULL AND v.p > 0) AS reasons
                FROM (VALUES
                    (CASE WHEN f.calls = 0 THEN 45 WHEN f.calls = 1 THEN 25
                          WHEN f.span < interval '1 hour' THEN 15 ELSE 0 END,
                     CASE WHEN f.calls = 0 THEN 'اتلغى من غير ولا محاولة اتصال متسجلة'
                          WHEN f.calls = 1 THEN 'محاولة اتصال واحدة بس'
                          WHEN f.span < interval '1 hour' THEN 'كل محاولات الاتصال في ساعة واحدة' END),
                    (CASE WHEN f.mins < 60 THEN 30 WHEN f.mins < 360 THEN 20 WHEN f.mins < 1440 THEN 10 ELSE 0 END,
                     CASE WHEN f.mins < 60 THEN 'اتلغى في أقل من ساعة من وصوله'
                          WHEN f.mins < 360 THEN 'اتلغى في أول 6 ساعات'
                          WHEN f.mins < 1440 THEN 'اتلغى في نفس يومه' END),
                    (CASE WHEN f.cancel_reason IS NULL OR f.cancel_reason IN ('no_answer', 'phone_off') THEN 10 ELSE 0 END,
                     CASE WHEN f.cancel_reason IS NULL THEN 'اتلغى من غير سبب'
                          WHEN f.cancel_reason IN ('no_answer', 'phone_off') THEN 'اتلغى عشان مابيردش' END),
                    (CASE f.customer_info ->> 'delivery_rate' WHEN 'high' THEN 10 WHEN 'low' THEN -15 ELSE 0 END,
                     CASE WHEN f.customer_info ->> 'delivery_rate' = 'high' THEN 'تقييم استلامه عالي في EasyOrders' END),
                    (CASE WHEN f.received_before THEN 15 ELSE 0 END,
                     CASE WHEN f.received_before THEN 'استلم مننا أوردر قبل كده' END)
                ) v(p, r)
          ) s
         WHERE NOT f.repeated
           AND f.said !~ '(مش ?(عاي?ز|عاوز|عايزه|عاوزه|محتاج|طالب)|رافض|رفض|مكرر|هزار|وهمي|ما ?طلبش|متطلبش|الرقم غلط|رقم غلط|(عاي?ز|عاوز) يلغي|لغى الطلب|لغي الطلب|اشترى من مكان|جاب من بره)'
    )
    SELECT s.id, s.score, COALESCE(s.reasons, '{}'), s.c_at, s.cancelled_by, s.cancel_reason, s.cancel_note,
           s.calls, round(s.mins)::int
      FROM scored s
     WHERE s.score >= 50
     ORDER BY s.score DESC, s.c_at DESC;
$$;
REVOKE ALL ON FUNCTION public.cancellation_suspects_core(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancellation_suspects(p_business_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (order_id UUID, score INTEGER, reasons TEXT[], cancelled_at TIMESTAMPTZ, cancelled_by TEXT,
               cancel_reason TEXT, cancel_note TEXT, attempts INTEGER, minutes_to_cancel INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = p_business_id AND lower(bu.user_email) = lower(auth.jwt() ->> 'email'))
       AND NOT public.am_i_admin_of_business(p_business_id) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN QUERY SELECT * FROM public.cancellation_suspects_core(p_business_id, p_from, p_to, NULL);
END $$;
REVOKE ALL ON FUNCTION public.cancellation_suspects(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancellation_suspects(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ===========================================================================
-- 4. Putting them back in Waiting
-- ===========================================================================
-- Only orders that are suspects right now are reopened, whatever was asked:
-- one confirmed or reopened in the meantime is skipped. Returns how many.
CREATE OR REPLACE FUNCTION public.cancellation_reopen_core(
    p_business_id UUID, p_ids UUID[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_source TEXT, p_by TEXT)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ids UUID[];
BEGIN
    WITH s AS (
        SELECT * FROM public.cancellation_suspects_core(p_business_id, p_from, p_to, p_ids)
    ), ins AS (
        INSERT INTO public.cancellation_reopens
            (business_id, order_id, source, reopened_by, score, reasons, cancelled_at, cancelled_by, cancel_reason, cancel_note)
        SELECT p_business_id, s.order_id, p_source, p_by, s.score, s.reasons, s.cancelled_at, s.cancelled_by, s.cancel_reason, s.cancel_note
          FROM s
        ON CONFLICT (order_id) DO NOTHING
        RETURNING order_id
    )
    SELECT array_agg(order_id) INTO v_ids FROM ins;

    IF v_ids IS NULL THEN
        RETURN 0;
    END IF;

    UPDATE public.orders o
       SET status = 'Waiting',
           tags = CASE WHEN 'reopened' = ANY (COALESCE(o.tags, '{}')) THEN o.tags ELSE array_append(COALESCE(o.tags, '{}'), 'reopened') END
     WHERE o.id = ANY (v_ids) AND o.business_id = p_business_id;

    INSERT INTO public.actions_log (business_id, user_email, action_type, entity_type, entity_id, entity_name, changes, metadata)
    VALUES (p_business_id, COALESCE(p_by, 'System'), 'update_status', 'order', v_ids[1]::text,
            array_length(v_ids, 1) || ' orders → Waiting (second try)',
            jsonb_build_array(jsonb_build_object('field', 'Status', 'old_value', 'Cancelled', 'new_value', 'Waiting')),
            jsonb_build_object('bulk', true, 'count', array_length(v_ids, 1), 'source', 'cancellation_review_' || p_source,
                               'orders', (SELECT jsonb_agg(jsonb_build_object('id', i, 'from', 'Cancelled')) FROM unnest(v_ids) i)));

    RETURN array_length(v_ids, 1);
END $$;
REVOKE ALL ON FUNCTION public.cancellation_reopen_core(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reopen_cancelled_orders(p_business_id UUID, p_order_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_business_manager(p_business_id) AND NOT public.am_i_admin_of_business(p_business_id) THEN
        RAISE EXCEPTION 'بس الأونر أو الأدمن يقدر يرجّع الأوردرات.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_order_ids IS NULL OR cardinality(p_order_ids) = 0 THEN
        RETURN 0;
    END IF;
    RETURN public.cancellation_reopen_core(p_business_id, p_order_ids, '-infinity', 'infinity', 'manual', lower(auth.jwt() ->> 'email'));
END $$;
REVOKE ALL ON FUNCTION public.reopen_cancelled_orders(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_cancelled_orders(UUID, UUID[]) TO authenticated;

-- ===========================================================================
-- 5. Every morning
-- ===========================================================================
-- The last three days' suspects, cancelled at least an hour ago, for every
-- business that turned it on. Each order gets one second try only.
CREATE OR REPLACE FUNCTION public.cancellation_review_daily()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    b RECORD;
    v_total INTEGER := 0;
BEGIN
    FOR b IN SELECT id FROM public.businesses
              WHERE lower(COALESCE(theme_config -> 'cancellation_review' ->> 'auto', 'false')) = 'true'
    LOOP
        BEGIN
            v_total := v_total + public.cancellation_reopen_core(b.id, NULL, now() - interval '3 days', now() - interval '1 hour', 'auto', 'auto');
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'cancellation_review_daily: business % failed: %', b.id, SQLERRM;
        END;
    END LOOP;
    RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.cancellation_review_daily() FROM PUBLIC, anon, authenticated;

-- 9 in the morning in Cairo: 07:00 UTC in winter (8 in summer time, still
-- before the sales day starts).
DO $$
BEGIN
    PERFORM cron.unschedule('cancellation-review-daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cancellation-review-daily');
    PERFORM cron.schedule('cancellation-review-daily', '0 7 * * *', 'SELECT public.cancellation_review_daily();');
END $$;

NOTIFY pgrst, 'reload schema';

-- Rollback (orders already reopened stay as they are now):
--   SELECT cron.unschedule('cancellation-review-daily');
--   DROP FUNCTION IF EXISTS public.cancellation_review_daily();
--   DROP FUNCTION IF EXISTS public.reopen_cancelled_orders(UUID, UUID[]);
--   DROP FUNCTION IF EXISTS public.cancellation_reopen_core(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.cancellation_suspects(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS public.cancellation_suspects_core(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID[]);
--   DROP TABLE IF EXISTS public.cancellation_reopens;
--   DROP TRIGGER IF EXISTS trg_orders_track_cancel ON public.orders;
--   DROP FUNCTION IF EXISTS public.orders_track_cancel();
