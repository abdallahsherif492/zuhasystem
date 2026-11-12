-- ===========================================================================
-- Moderators' daily targets, and the deduction for missing one
-- ===========================================================================
-- What each shift owes is set by what the business needs (every store order
-- worked within N hours, every stuck shipment followed up every N days, a
-- minimum of orders from messages, a minimum confirmation rate), not by what
-- the team usually manages. The rules live in src/lib/hr/daily-targets.ts;
-- an hourly job (/api/cron/moderator-targets) scores every shift that has
-- ended and, when the owner has set an amount for a missed target, books it
-- as a deduction in payroll.
--
-- This file adds:
--   1. orders.confirmed_at / confirmed_by — when and by whom an order left
--      Waiting other than by cancelling (cancelled_at / cancelled_by exist
--      since 20261107). The actions log keeps 30 days; these stay.
--   2. moderator_target_settings — one row per business.
--   3. moderator_scorecards — one row per moderator per working day.
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. When an order was confirmed, and by whom
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS confirmed_by TEXT;

CREATE OR REPLACE FUNCTION public.orders_track_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_old TEXT := lower(btrim(COALESCE(OLD.status, '')));
    v_new TEXT := lower(btrim(COALESCE(NEW.status, '')));
BEGIN
    IF v_old = 'waiting' AND v_new NOT IN ('waiting', 'cancelled', 'canceled') THEN
        NEW.confirmed_at := now();
        -- Whoever this update says, else the signed-in user, else the
        -- moderator credited with the order.
        IF NEW.confirmed_by IS NOT DISTINCT FROM OLD.confirmed_by THEN
            NEW.confirmed_by := COALESCE(NULLIF(lower(auth.jwt() ->> 'email'), ''), lower(NEW.closed_by));
        END IF;
    ELSIF v_new = 'waiting' AND v_old <> 'waiting' THEN
        -- Back to Waiting: it is unconfirmed again.
        NEW.confirmed_at := NULL;
        NEW.confirmed_by := NULL;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_orders_track_confirm ON public.orders;
CREATE TRIGGER trg_orders_track_confirm
    BEFORE UPDATE OF status ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.orders_track_confirm();

-- Confirmations of the last 30 days, from the actions log (single and bulk).
WITH logged AS (
    SELECT DISTINCT ON (x.order_id) x.order_id, lower(a.user_email) AS who, a.created_at
      FROM public.actions_log a
      CROSS JOIN LATERAL (
          SELECT a.entity_id::text AS order_id
           WHERE jsonb_typeof(a.metadata::jsonb -> 'orders') IS DISTINCT FROM 'array'
          UNION ALL
          SELECT e ->> 'id'
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.metadata::jsonb -> 'orders') = 'array' THEN a.metadata::jsonb -> 'orders' ELSE '[]'::jsonb END) e
      ) x
     WHERE a.entity_type = 'order'
       AND a.user_email IS NOT NULL
       AND x.order_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.changes::jsonb) = 'array' THEN a.changes::jsonb ELSE '[]'::jsonb END) c
                    WHERE c ->> 'field' = 'Status'
                      AND lower(c ->> 'old_value') = 'waiting'
                      AND lower(COALESCE(c ->> 'new_value', '')) NOT IN ('waiting', 'cancelled', 'canceled'))
     ORDER BY x.order_id, a.created_at
)
UPDATE public.orders o
   SET confirmed_at = l.created_at,
       confirmed_by = l.who
  FROM logged l
 WHERE o.id = l.order_id::uuid
   AND o.confirmed_at IS NULL
   AND lower(btrim(COALESCE(o.status, ''))) NOT IN ('waiting', 'cancelled', 'canceled');

CREATE INDEX IF NOT EXISTS idx_orders_confirmed_at
    ON public.orders (business_id, confirmed_at)
    WHERE confirmed_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Settings (Settings → Moderator targets)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moderator_target_settings (
    business_id          UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    enabled              BOOLEAN NOT NULL DEFAULT false,
    -- Off: shifts are scored and shown, nothing is booked in payroll.
    apply_to_payroll     BOOLEAN NOT NULL DEFAULT true,
    -- Emails of the moderators measured.
    members              TEXT[] NOT NULL DEFAULT '{}',
    confirm_within_hours NUMERIC(5,2) NOT NULL DEFAULT 2 CHECK (confirm_within_hours >= 0),
    backlog_days         INTEGER NOT NULL DEFAULT 1 CHECK (backlog_days >= 0),
    min_message_orders   INTEGER NOT NULL DEFAULT 0 CHECK (min_message_orders >= 0),
    followup_every_days  INTEGER NOT NULL DEFAULT 1 CHECK (followup_every_days >= 1),
    stale_days           INTEGER NOT NULL DEFAULT 5 CHECK (stale_days >= 0),
    min_confirm_rate     NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (min_confirm_rate BETWEEN 0 AND 100),
    min_handled_for_rate INTEGER NOT NULL DEFAULT 10 CHECK (min_handled_for_rate >= 1),
    -- What each missed target costs, in EGP. 0: shown, never deducted.
    deduct_confirm       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (deduct_confirm >= 0),
    deduct_messages      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (deduct_messages >= 0),
    deduct_followups     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (deduct_followups >= 0),
    deduct_rate          NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (deduct_rate >= 0),
    -- Most a moderator can lose this way in a month. NULL: no limit.
    monthly_cap          NUMERIC(10,2) CHECK (monthly_cap IS NULL OR monthly_cap >= 0),
    -- No shift before this day is scored.
    starts_on            DATE,
    updated_by           TEXT,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.moderator_target_settings ENABLE ROW LEVEL SECURITY;
-- Every member reads them (a moderator sees what is asked of them);
-- managers change them.
DROP POLICY IF EXISTS moderator_target_settings_read ON public.moderator_target_settings;
CREATE POLICY moderator_target_settings_read ON public.moderator_target_settings FOR SELECT TO authenticated
    USING (business_id IN (SELECT public.get_my_business_ids()) OR public.am_i_admin_of_business(business_id));
DROP POLICY IF EXISTS moderator_target_settings_write ON public.moderator_target_settings;
CREATE POLICY moderator_target_settings_write ON public.moderator_target_settings FOR ALL TO authenticated
    USING (public.is_business_manager(business_id))
    WITH CHECK (public.is_business_manager(business_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.moderator_target_settings TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Scorecards: one per moderator per working day, written by the job
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moderator_scorecards (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_email    TEXT NOT NULL,
    work_date     DATE NOT NULL,
    shift_start   TIMESTAMPTZ NOT NULL,
    shift_end     TIMESTAMPTZ NOT NULL,
    -- evaluated | absent (a working day with no activity at all) | leave
    status        TEXT NOT NULL CHECK (status IN ('evaluated', 'absent', 'leave')),
    share         NUMERIC(6,4) NOT NULL DEFAULT 0,
    -- [{key, target, done, met, detail}]
    metrics       JSONB NOT NULL DEFAULT '[]'::jsonb,
    missed        TEXT[] NOT NULL DEFAULT '{}',
    -- What the missed targets cost, after the monthly cap.
    deduction     NUMERIC(10,2) NOT NULL DEFAULT 0,
    -- The payroll deduction booked for it. Deleting that in payroll waives it.
    adjustment_id UUID REFERENCES public.payroll_adjustments(id) ON DELETE SET NULL,
    -- Why nothing was booked, when it was not (month settled, no salary row...).
    payroll_note  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, user_email, work_date)
);
CREATE INDEX IF NOT EXISTS idx_moderator_scorecards_day ON public.moderator_scorecards (business_id, work_date);

ALTER TABLE public.moderator_scorecards ENABLE ROW LEVEL SECURITY;
-- Managers see everyone's; a moderator sees their own.
DROP POLICY IF EXISTS moderator_scorecards_read ON public.moderator_scorecards;
CREATE POLICY moderator_scorecards_read ON public.moderator_scorecards FOR SELECT TO authenticated
    USING (public.is_business_manager(business_id) OR lower(user_email) = lower(auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS moderator_scorecards_manage ON public.moderator_scorecards;
CREATE POLICY moderator_scorecards_manage ON public.moderator_scorecards FOR DELETE TO authenticated
    USING (public.is_business_manager(business_id));
GRANT SELECT, DELETE ON public.moderator_scorecards TO authenticated;
-- Written by the job with the service role only.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP TABLE IF EXISTS public.moderator_scorecards;
-- DROP TABLE IF EXISTS public.moderator_target_settings;
-- DROP TRIGGER IF EXISTS trg_orders_track_confirm ON public.orders;
-- DROP FUNCTION IF EXISTS public.orders_track_confirm();
-- DROP INDEX IF EXISTS public.idx_orders_confirmed_at;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS confirmed_at, DROP COLUMN IF EXISTS confirmed_by;
-- (Deductions already booked stay in payroll_adjustments; delete them there.)
