-- ===========================================================================
-- Daily targets: attendance deductions, and a moderator's own month
-- ===========================================================================
-- Follows 20261113_moderator_daily_targets.sql.
--   1. Deductions the owner sets for arriving late, leaving early, forgetting
--      to clock out and working without clocking in, against the scheduled
--      shift, with a few minutes of grace. Scored with the shift.
--   2. What attendance counted on each scorecard.
--   3. get_my_pay_items(): a moderator's own bonuses and deductions for a
--      month. payroll_adjustments is managers-only, so the moderator's page
--      (/my-hr/today) reads its own lines through this.
-- Safe to run more than once.

ALTER TABLE public.moderator_target_settings
    ADD COLUMN IF NOT EXISTS grace_minutes      INTEGER       NOT NULL DEFAULT 10 CHECK (grace_minutes >= 0),
    ADD COLUMN IF NOT EXISTS deduct_late        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (deduct_late >= 0),
    ADD COLUMN IF NOT EXISTS deduct_early       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (deduct_early >= 0),
    ADD COLUMN IF NOT EXISTS deduct_no_clockout NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (deduct_no_clockout >= 0),
    ADD COLUMN IF NOT EXISTS deduct_no_clockin  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (deduct_no_clockin >= 0);

ALTER TABLE public.moderator_scorecards
    -- {scheduled_start, scheduled_end, clock_in, clock_out, late_minutes,
    --  early_minutes, items: [{key, amount, detail}]}
    ADD COLUMN IF NOT EXISTS attendance JSONB;

CREATE OR REPLACE FUNCTION public.get_my_pay_items(p_business_id UUID, p_period DATE)
RETURNS TABLE (kind TEXT, amount NUMERIC, reason TEXT, entry_date DATE, automatic BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT a.kind, a.amount, a.reason, a.entry_date, (a.created_by = 'system: daily targets') AS automatic
      FROM public.payroll_adjustments a
      JOIN public.business_users bu ON bu.id = a.business_user_id
     WHERE a.business_id = p_business_id
       AND bu.business_id = p_business_id
       AND lower(bu.user_email) = lower(auth.jwt() ->> 'email')
       AND a.period = date_trunc('month', p_period)::date
       AND COALESCE(a.apply_to_salary, true)
     ORDER BY a.entry_date DESC, a.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_my_pay_items(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pay_items(UUID, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Rollback:
-- DROP FUNCTION IF EXISTS public.get_my_pay_items(UUID, DATE);
-- ALTER TABLE public.moderator_scorecards DROP COLUMN IF EXISTS attendance;
-- ALTER TABLE public.moderator_target_settings DROP COLUMN IF EXISTS grace_minutes, DROP COLUMN IF EXISTS deduct_late,
--     DROP COLUMN IF EXISTS deduct_early, DROP COLUMN IF EXISTS deduct_no_clockout, DROP COLUMN IF EXISTS deduct_no_clockin;
