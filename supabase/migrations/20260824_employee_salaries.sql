-- Migration: a salary per team member
-- Created At: 2026-08-24
--
-- Kept out of business_users on purpose. The team page reads that table with
-- select('*') for the whole business, so a salary column there would show every
-- member of staff what all their colleagues earn the moment it was added. A
-- separate table can be locked to managers, which is what pay needs.
--
-- Self-contained: the helper is defined here rather than reused from another
-- migration, because these files get applied by hand and a split dependency
-- only works if both halves are run, in order.

-- ===========================================================================
-- 1. Who may see pay
-- ===========================================================================
-- Role spellings vary across the app's history — 'super_admin' from the seed
-- data, 'super admin' from the team screen's own dropdown — so normalise the
-- underscore rather than listing every variant.
CREATE OR REPLACE FUNCTION public.is_business_manager(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.business_id = p_business_id
          AND bu.user_email = auth.jwt() ->> 'email'
          AND lower(replace(bu.role, '_', ' ')) IN ('owner', 'admin', 'super admin')
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_business_manager(UUID) TO authenticated;

-- ===========================================================================
-- 2. The table
-- ===========================================================================
-- One current salary per membership. UNIQUE on business_user_id so the app can
-- upsert without first checking whether a row exists.
CREATE TABLE IF NOT EXISTS public.employee_salaries (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    business_user_id UUID NOT NULL UNIQUE REFERENCES public.business_users(id) ON DELETE CASCADE,
    -- Denormalised so the payroll list survives a membership being deleted and
    -- still says who it referred to.
    user_email       TEXT,
    monthly_salary   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_salary >= 0),
    notes            TEXT,
    updated_by       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_salaries_business
    ON public.employee_salaries (business_id);

ALTER TABLE public.employee_salaries ENABLE ROW LEVEL SECURITY;

-- Managers only, for reading as well as writing. Staff cannot see their own row
-- either: this table is the payroll, and a single SELECT policy that let people
-- read "their own" would also be the one an ordinary member could widen by
-- changing the filter client-side. Showing someone their own salary, if that is
-- ever wanted, belongs in a purpose-built view rather than here.
DROP POLICY IF EXISTS "Managers read salaries" ON public.employee_salaries;
CREATE POLICY "Managers read salaries"
ON public.employee_salaries FOR SELECT TO authenticated
USING (public.is_business_manager(business_id));

DROP POLICY IF EXISTS "Managers write salaries" ON public.employee_salaries;
CREATE POLICY "Managers write salaries"
ON public.employee_salaries FOR ALL TO authenticated
USING (public.is_business_manager(business_id))
WITH CHECK (public.is_business_manager(business_id));

-- ===========================================================================
-- 3. Deliberately NOT audited
-- ===========================================================================
-- The generic log_row_change trigger is not attached here, and that is a
-- decision rather than an oversight: it records old and new values into
-- actions_log, which every member of the business can read. Auditing pay that
-- way would publish the exact figures the table above exists to protect.
-- updated_at and updated_by record who last touched a salary without saying
-- what anyone earns.

-- ===========================================================================
-- 4. Monthly payroll total
-- ===========================================================================
-- One number for a manager to check against the Salaries expense category.
-- Guarded the same way the table is, so it cannot be used to infer the total
-- by someone who may not read the rows.
CREATE OR REPLACE FUNCTION public.get_monthly_payroll(p_business_id UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE WHEN public.is_business_manager(p_business_id)
                THEN COALESCE((SELECT SUM(monthly_salary) FROM public.employee_salaries
                                WHERE business_id = p_business_id), 0)
                ELSE NULL
           END;
$$;

GRANT EXECUTE ON FUNCTION public.get_monthly_payroll(UUID) TO authenticated;

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT public.is_business_manager('<business id>');   -- true for owners
--   SELECT * FROM employee_salaries;                      -- empty for staff
--   SELECT public.get_monthly_payroll('<business id>');

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.get_monthly_payroll(UUID);
-- DROP TABLE IF EXISTS public.employee_salaries;
-- DROP FUNCTION IF EXISTS public.is_business_manager(UUID);
