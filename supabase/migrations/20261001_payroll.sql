-- Migration: monthly payroll — bonuses, deductions, advances and payslips
-- Created At: 2026-10-01
--
-- employee_salaries holds what each person earns a month. What they are paid
-- for a given month is that, plus bonuses, minus deductions, minus advances
-- already handed over during the month. Those were being written straight
-- into accounting as Salaries expenses ("سلفة يوسف") with nothing tying them
-- to the person or the month, so settling a salary meant adding them up by
-- hand.
--
--   payroll_adjustments  bonus / deduction / advance, per person per month,
--                        added any time during the month.
--   payslips             the settled month: a snapshot of the figures, so a
--                        later raise or a deleted adjustment never rewrites a
--                        payslip that was already paid.
--
-- Money: an advance is cash out on the day it is given, so it is booked as a
-- Salaries expense then (unless it was already booked by hand). Settling
-- books only the rest — the net — so the month's Salaries expense adds up to
-- the full gross, never twice.
--
-- Like employee_salaries, all of this is readable by managers only, and none
-- of it goes to actions_log, which every member can read. An employee sees
-- their own settled payslips through get_my_payslips().
--
-- Self-contained: is_business_manager() is (re)defined here too, since these
-- files are applied by hand.

-- ===========================================================================
-- 0. Who may see pay (same definition as 20260824_employee_salaries.sql)
-- ===========================================================================
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
-- 1. Names on the payslip
-- ===========================================================================
-- The team is known by e-mail only. A payslip needs a name, and the job title
-- is what a payslip usually carries under it. Kept here, with the pay, rather
-- than on business_users.
ALTER TABLE public.employee_salaries
    ADD COLUMN IF NOT EXISTS employee_name TEXT,
    ADD COLUMN IF NOT EXISTS job_title     TEXT;

-- ===========================================================================
-- 2. Tables
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.payroll_adjustments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    business_user_id UUID NOT NULL REFERENCES public.business_users(id) ON DELETE CASCADE,
    period           DATE NOT NULL CHECK (EXTRACT(DAY FROM period) = 1),  -- first of the month
    kind             TEXT NOT NULL CHECK (kind IN ('bonus', 'deduction', 'advance')),
    amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    reason           TEXT NOT NULL DEFAULT '',
    entry_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    -- The Salaries expense booked for an advance, when it was booked here.
    transaction_id   UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    created_by       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_period
    ON public.payroll_adjustments (business_id, period);

CREATE TABLE IF NOT EXISTS public.payslips (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    -- Kept when the membership is deleted: the payslip still happened.
    business_user_id UUID REFERENCES public.business_users(id) ON DELETE SET NULL,
    user_email       TEXT NOT NULL,
    employee_name    TEXT,
    job_title        TEXT,
    period           DATE NOT NULL CHECK (EXTRACT(DAY FROM period) = 1),
    base_salary      NUMERIC(12,2) NOT NULL DEFAULT 0,
    bonuses          NUMERIC(12,2) NOT NULL DEFAULT 0,
    deductions       NUMERIC(12,2) NOT NULL DEFAULT 0,
    advances         NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_pay          NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- The adjustments as they were when settled: [{kind, amount, reason, entry_date}]
    items            JSONB NOT NULL DEFAULT '[]'::jsonb,
    paid_on          DATE NOT NULL DEFAULT CURRENT_DATE,
    account_name     TEXT,
    transaction_id   UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    -- When advances were more than the pay, what is left is carried into next
    -- month as an advance; reopening the payslip takes it back out.
    carryover_id     UUID REFERENCES public.payroll_adjustments(id) ON DELETE SET NULL,
    notes            TEXT,
    settled_by       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_user_id, period)
);
CREATE INDEX IF NOT EXISTS idx_payslips_period ON public.payslips (business_id, period);

-- ===========================================================================
-- 3. Managers only
-- ===========================================================================
ALTER TABLE public.payroll_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslips            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_adjustments_managers ON public.payroll_adjustments;
CREATE POLICY payroll_adjustments_managers ON public.payroll_adjustments FOR ALL TO authenticated
    USING (public.is_business_manager(business_id))
    WITH CHECK (public.is_business_manager(business_id));

-- Read-only from the app: payslips are written by payroll_settle() only.
DROP POLICY IF EXISTS payslips_managers_read ON public.payslips;
CREATE POLICY payslips_managers_read ON public.payslips FOR SELECT TO authenticated
    USING (public.is_business_manager(business_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_adjustments TO authenticated;
GRANT SELECT ON public.payslips TO authenticated;

-- A settled month is closed: its adjustments cannot change until the payslip
-- is reopened, or the payslip would no longer match them.
CREATE OR REPLACE FUNCTION public.payroll_check_open()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.payroll_adjustments;
BEGIN
    r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    IF EXISTS (SELECT 1 FROM public.payslips p
                WHERE p.business_user_id = r.business_user_id AND p.period = r.period) THEN
        RAISE EXCEPTION 'مرتب الشهر ده اتسوّى. افتح التسوية الأول عشان تعدّل.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN r;
END $$;

DROP TRIGGER IF EXISTS trg_payroll_check_open ON public.payroll_adjustments;
CREATE TRIGGER trg_payroll_check_open
    BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_adjustments
    FOR EACH ROW EXECUTE FUNCTION public.payroll_check_open();

-- ===========================================================================
-- 4. Functions
-- ===========================================================================
-- A member's name for descriptions: the payslip name, else the e-mail's local part.
CREATE OR REPLACE FUNCTION public.payroll_member_name(p_business_user_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(NULLIF(trim(es.employee_name), ''), split_part(bu.user_email, '@', 1))
      FROM public.business_users bu
      LEFT JOIN public.employee_salaries es ON es.business_user_id = bu.id
     WHERE bu.id = p_business_user_id;
$$;

-- Add a bonus, deduction or advance. An advance given now is booked as a
-- Salaries expense from p_account_name; pass NULL when it was already booked.
CREATE OR REPLACE FUNCTION public.payroll_add_adjustment(
    p_business_user_id UUID, p_period DATE, p_kind TEXT, p_amount NUMERIC,
    p_reason TEXT, p_entry_date DATE, p_account_name TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_business UUID;
    v_tx UUID;
    v_id UUID;
BEGIN
    SELECT business_id INTO v_business FROM public.business_users WHERE id = p_business_user_id;
    IF v_business IS NULL OR NOT public.is_business_manager(v_business) THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_kind = 'advance' AND NULLIF(trim(p_account_name), '') IS NOT NULL THEN
        INSERT INTO public.transactions (business_id, transaction_date, type, category, amount, description, account_name)
        VALUES (v_business, COALESCE(p_entry_date, CURRENT_DATE), 'expense', 'Salaries', -abs(p_amount),
                'سلفة — ' || public.payroll_member_name(p_business_user_id)
                    || COALESCE(NULLIF(': ' || trim(p_reason), ': '), ''),
                p_account_name)
        RETURNING id INTO v_tx;
    END IF;

    INSERT INTO public.payroll_adjustments (business_id, business_user_id, period, kind, amount, reason, entry_date, transaction_id, created_by)
    VALUES (v_business, p_business_user_id, date_trunc('month', p_period)::date, p_kind, abs(p_amount),
            COALESCE(p_reason, ''), COALESCE(p_entry_date, CURRENT_DATE), v_tx, auth.jwt() ->> 'email')
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- Remove one; the expense this page booked for it goes with it.
CREATE OR REPLACE FUNCTION public.payroll_delete_adjustment(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.payroll_adjustments;
BEGIN
    SELECT * INTO a FROM public.payroll_adjustments WHERE id = p_id;
    IF NOT FOUND THEN RETURN; END IF;
    IF NOT public.is_business_manager(a.business_id) THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    DELETE FROM public.payroll_adjustments WHERE id = p_id;
    IF a.transaction_id IS NOT NULL THEN
        DELETE FROM public.transactions WHERE id = a.transaction_id AND business_id = a.business_id;
    END IF;
END $$;

-- Settle a month: snapshot the figures, book the net as a Salaries expense
-- from p_account_name (NULL = paid outside the system), and carry a negative
-- net into next month as an advance.
CREATE OR REPLACE FUNCTION public.payroll_settle(
    p_business_user_id UUID, p_period DATE, p_paid_on DATE, p_account_name TEXT, p_notes TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_period   DATE := date_trunc('month', p_period)::date;
    v_member   public.business_users;
    v_sal      public.employee_salaries;
    v_name     TEXT;
    v_base     NUMERIC := 0;
    v_bonus    NUMERIC := 0;
    v_ded      NUMERIC := 0;
    v_adv      NUMERIC := 0;
    v_net      NUMERIC;
    v_items    JSONB;
    v_tx       UUID;
    v_carry    UUID;
    v_id       UUID;
BEGIN
    SELECT * INTO v_member FROM public.business_users WHERE id = p_business_user_id;
    IF NOT FOUND OR NOT public.is_business_manager(v_member.business_id) THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF EXISTS (SELECT 1 FROM public.payslips WHERE business_user_id = p_business_user_id AND period = v_period) THEN
        RAISE EXCEPTION 'مرتب الشهر ده اتسوّى قبل كده.' USING ERRCODE = 'unique_violation';
    END IF;

    SELECT * INTO v_sal FROM public.employee_salaries WHERE business_user_id = p_business_user_id;
    v_base := COALESCE(v_sal.monthly_salary, 0);
    v_name := public.payroll_member_name(p_business_user_id);

    SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'bonus'), 0),
           COALESCE(sum(amount) FILTER (WHERE kind = 'deduction'), 0),
           COALESCE(sum(amount) FILTER (WHERE kind = 'advance'), 0),
           COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'reason', reason, 'entry_date', entry_date)
                              ORDER BY entry_date, created_at), '[]'::jsonb)
      INTO v_bonus, v_ded, v_adv, v_items
      FROM public.payroll_adjustments
     WHERE business_user_id = p_business_user_id AND period = v_period;

    v_net := v_base + v_bonus - v_ded - v_adv;

    IF v_net > 0 AND NULLIF(trim(p_account_name), '') IS NOT NULL THEN
        INSERT INTO public.transactions (business_id, transaction_date, type, category, amount, description, account_name)
        VALUES (v_member.business_id, COALESCE(p_paid_on, CURRENT_DATE), 'expense', 'Salaries', -v_net,
                'مرتب ' || to_char(v_period, 'MM/YYYY') || ' — ' || v_name, p_account_name)
        RETURNING id INTO v_tx;
    END IF;

    INSERT INTO public.payslips (business_id, business_user_id, user_email, employee_name, job_title, period,
                                 base_salary, bonuses, deductions, advances, net_pay, items,
                                 paid_on, account_name, transaction_id, notes, settled_by)
    VALUES (v_member.business_id, p_business_user_id, v_member.user_email, v_name, v_sal.job_title, v_period,
            v_base, v_bonus, v_ded, v_adv, v_net, v_items,
            COALESCE(p_paid_on, CURRENT_DATE), CASE WHEN v_tx IS NULL THEN NULL ELSE p_account_name END,
            v_tx, NULLIF(trim(p_notes), ''), auth.jwt() ->> 'email')
    RETURNING id INTO v_id;

    -- Advances beyond the pay: the rest is still owed, from next month's.
    IF v_net < 0 THEN
        INSERT INTO public.payroll_adjustments (business_id, business_user_id, period, kind, amount, reason, entry_date, created_by)
        VALUES (v_member.business_id, p_business_user_id, (v_period + interval '1 month')::date, 'advance', -v_net,
                'متبقي من مرتب ' || to_char(v_period, 'MM/YYYY'), COALESCE(p_paid_on, CURRENT_DATE), auth.jwt() ->> 'email')
        RETURNING id INTO v_carry;
        UPDATE public.payslips SET carryover_id = v_carry WHERE id = v_id;
    END IF;

    RETURN v_id;
END $$;

-- Reopen a settled month to correct it: the payslip, the expense it booked
-- and any amount it carried forward are removed; the adjustments stay.
CREATE OR REPLACE FUNCTION public.payroll_reopen(p_payslip_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.payslips;
BEGIN
    SELECT * INTO p FROM public.payslips WHERE id = p_payslip_id;
    IF NOT FOUND THEN RETURN; END IF;
    IF NOT public.is_business_manager(p.business_id) THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    DELETE FROM public.payslips WHERE id = p_payslip_id;
    IF p.transaction_id IS NOT NULL THEN
        DELETE FROM public.transactions WHERE id = p.transaction_id AND business_id = p.business_id;
    END IF;
    IF p.carryover_id IS NOT NULL THEN
        -- Fails, by the trigger above, if next month is itself settled already.
        DELETE FROM public.payroll_adjustments WHERE id = p.carryover_id;
    END IF;
END $$;

-- An employee's own settled payslips, newest first.
CREATE OR REPLACE FUNCTION public.get_my_payslips(p_business_id UUID)
RETURNS SETOF public.payslips
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.* FROM public.payslips p
      JOIN public.business_users bu ON bu.id = p.business_user_id
     WHERE p.business_id = p_business_id
       AND bu.user_email = auth.jwt() ->> 'email'
     ORDER BY p.period DESC;
$$;

REVOKE ALL ON FUNCTION public.payroll_member_name(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_add_adjustment(UUID, DATE, TEXT, NUMERIC, TEXT, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_delete_adjustment(UUID)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_settle(UUID, DATE, DATE, TEXT, TEXT)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_reopen(UUID)                                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_payslips(UUID)                                          TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- Rollback
-- ===========================================================================
--   DROP FUNCTION IF EXISTS public.get_my_payslips(UUID);
--   DROP FUNCTION IF EXISTS public.payroll_reopen(UUID);
--   DROP FUNCTION IF EXISTS public.payroll_settle(UUID, DATE, DATE, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.payroll_delete_adjustment(UUID);
--   DROP FUNCTION IF EXISTS public.payroll_add_adjustment(UUID, DATE, TEXT, NUMERIC, TEXT, DATE, TEXT);
--   DROP FUNCTION IF EXISTS public.payroll_member_name(UUID);
--   DROP TABLE IF EXISTS public.payslips, public.payroll_adjustments;
--   DROP FUNCTION IF EXISTS public.payroll_check_open();
--   ALTER TABLE public.employee_salaries DROP COLUMN IF EXISTS employee_name, DROP COLUMN IF EXISTS job_title;
