-- ===========================================================================
-- Managers can read the team's attendance
-- ===========================================================================
-- The policy that lets managers see everyone's clock-ins (20260627) only
-- names the roles 'owner' and 'admin'. A super admin, and the daily-targets
-- report that a manager opens, read nobody's attendance but their own: the
-- report then shows people who did clock in as "did not clock in" and
-- measures their shift by the schedule instead of the hours they worked.
-- (The scorecards written every hour by the job were not affected; it reads
-- with the service role.)
--
-- Now: anyone public.is_business_manager() recognises (owner, admin, super
-- admin), the same rule payroll uses. Safe to run more than once.

DROP POLICY IF EXISTS "Business admins can view all attendance in their business" ON public.attendance_logs;
CREATE POLICY "Business admins can view all attendance in their business"
    ON public.attendance_logs
    FOR SELECT
    USING (public.is_business_manager(business_id) OR public.am_i_admin_of_business(business_id));

-- Rollback: re-create the policy from 20260627_fix_attendance_rls.sql.
