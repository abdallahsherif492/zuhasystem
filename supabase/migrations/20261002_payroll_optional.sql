-- Migration: payroll — every deduction and every accounting entry is a choice
-- Created At: 2026-10-02
-- Requires: 20261001_payroll.sql
--
-- The first version decided a few things by itself: an advance always came
-- off the salary, settling a month always offered to book an expense, an
-- advance larger than the pay was always carried into next month, and
-- deleting or reopening always removed the expense that had been booked.
-- Each of these is now the manager's call:
--
--   apply_to_salary   per entry: whether this deduction or advance comes off
--                     this month's pay. Off, it stays on record (an advance
--                     not to be taken back yet) without touching the net.
--   p_account_name    NULL books nothing in accounting — for an advance and
--                     for the salary itself. The app now asks, off by default.
--   p_carry_over      whether what advances leave owing moves to next month.
--   p_delete_transaction
--                     when an entry is deleted or a month reopened, whether the
--                     expense it booked goes too, or stays in accounting.

ALTER TABLE public.payroll_adjustments
    ADD COLUMN IF NOT EXISTS apply_to_salary BOOLEAN NOT NULL DEFAULT true;

-- The old signatures go, so a call cannot land on a stale overload.
DROP FUNCTION IF EXISTS public.payroll_add_adjustment(UUID, DATE, TEXT, NUMERIC, TEXT, DATE, TEXT);
DROP FUNCTION IF EXISTS public.payroll_delete_adjustment(UUID);
DROP FUNCTION IF EXISTS public.payroll_settle(UUID, DATE, DATE, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.payroll_reopen(UUID);

CREATE OR REPLACE FUNCTION public.payroll_add_adjustment(
    p_business_user_id UUID, p_period DATE, p_kind TEXT, p_amount NUMERIC,
    p_reason TEXT, p_entry_date DATE, p_account_name TEXT, p_apply_to_salary BOOLEAN DEFAULT true
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

    -- Booked only when an account was chosen.
    IF p_kind = 'advance' AND NULLIF(trim(p_account_name), '') IS NOT NULL THEN
        INSERT INTO public.transactions (business_id, transaction_date, type, category, amount, description, account_name)
        VALUES (v_business, COALESCE(p_entry_date, CURRENT_DATE), 'expense', 'Salaries', -abs(p_amount),
                'سلفة — ' || public.payroll_member_name(p_business_user_id)
                    || COALESCE(NULLIF(': ' || trim(p_reason), ': '), ''),
                p_account_name)
        RETURNING id INTO v_tx;
    END IF;

    INSERT INTO public.payroll_adjustments (business_id, business_user_id, period, kind, amount, reason, entry_date,
                                            transaction_id, apply_to_salary, created_by)
    VALUES (v_business, p_business_user_id, date_trunc('month', p_period)::date, p_kind, abs(p_amount),
            COALESCE(p_reason, ''), COALESCE(p_entry_date, CURRENT_DATE), v_tx,
            CASE WHEN p_kind = 'bonus' THEN true ELSE COALESCE(p_apply_to_salary, true) END,
            auth.jwt() ->> 'email')
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.payroll_delete_adjustment(p_id UUID, p_delete_transaction BOOLEAN DEFAULT false)
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
    IF p_delete_transaction AND a.transaction_id IS NOT NULL THEN
        DELETE FROM public.transactions WHERE id = a.transaction_id AND business_id = a.business_id;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.payroll_settle(
    p_business_user_id UUID, p_period DATE, p_paid_on DATE, p_account_name TEXT, p_notes TEXT,
    p_carry_over BOOLEAN DEFAULT false
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

    -- Only the entries that apply to this month's pay.
    SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'bonus'), 0),
           COALESCE(sum(amount) FILTER (WHERE kind = 'deduction'), 0),
           COALESCE(sum(amount) FILTER (WHERE kind = 'advance'), 0),
           COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'reason', reason, 'entry_date', entry_date)
                              ORDER BY entry_date, created_at), '[]'::jsonb)
      INTO v_bonus, v_ded, v_adv, v_items
      FROM public.payroll_adjustments
     WHERE business_user_id = p_business_user_id AND period = v_period AND apply_to_salary;

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

    IF v_net < 0 AND p_carry_over THEN
        INSERT INTO public.payroll_adjustments (business_id, business_user_id, period, kind, amount, reason, entry_date, created_by)
        VALUES (v_member.business_id, p_business_user_id, (v_period + interval '1 month')::date, 'advance', -v_net,
                'متبقي من مرتب ' || to_char(v_period, 'MM/YYYY'), COALESCE(p_paid_on, CURRENT_DATE), auth.jwt() ->> 'email')
        RETURNING id INTO v_carry;
        UPDATE public.payslips SET carryover_id = v_carry WHERE id = v_id;
    END IF;

    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.payroll_reopen(p_payslip_id UUID, p_delete_transaction BOOLEAN DEFAULT false)
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
    IF p_delete_transaction AND p.transaction_id IS NOT NULL THEN
        DELETE FROM public.transactions WHERE id = p.transaction_id AND business_id = p.business_id;
    END IF;
    -- The carried amount was this payslip's own doing, so it goes back with it.
    IF p.carryover_id IS NOT NULL THEN
        DELETE FROM public.payroll_adjustments WHERE id = p.carryover_id;
    END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.payroll_add_adjustment(UUID, DATE, TEXT, NUMERIC, TEXT, DATE, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_delete_adjustment(UUID, BOOLEAN)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_settle(UUID, DATE, DATE, TEXT, TEXT, BOOLEAN)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_reopen(UUID, BOOLEAN)                                          TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- Rollback: run 20261001_payroll.sql's function section again, then
--   ALTER TABLE public.payroll_adjustments DROP COLUMN IF EXISTS apply_to_salary;
-- ===========================================================================
