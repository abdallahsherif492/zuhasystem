-- Migration: payroll — edit an entry after adding it
-- Created At: 2026-10-03
-- Requires: 20261001_payroll.sql, 20261002_payroll_optional.sql
--
-- A bonus, deduction or advance can be corrected — kind, amount, reason,
-- date — instead of deleted and added again. Like adding, the month follows
-- the date: an entry dated in September is on September's pay.
--
-- An advance that was recorded in accounting keeps its expense as it was,
-- unless the edit asks for the expense to follow (p_update_transaction).

-- A settled month is closed in both directions: an entry cannot be edited
-- out of it or into it. The first version only looked at the new row, so an
-- entry could be moved out of a month that had already been paid.
CREATE OR REPLACE FUNCTION public.payroll_check_open()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
        SELECT 1 FROM public.payslips p
         WHERE p.business_user_id = OLD.business_user_id AND p.period = OLD.period) THEN
        RAISE EXCEPTION 'مرتب الشهر ده اتسوّى. افتح التسوية الأول عشان تعدّل.' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
        SELECT 1 FROM public.payslips p
         WHERE p.business_user_id = NEW.business_user_id AND p.period = NEW.period) THEN
        RAISE EXCEPTION 'مرتب الشهر ده اتسوّى. افتح التسوية الأول عشان تعدّل.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION public.payroll_update_adjustment(
    p_id UUID, p_kind TEXT, p_amount NUMERIC, p_reason TEXT, p_entry_date DATE,
    p_apply_to_salary BOOLEAN, p_update_transaction BOOLEAN DEFAULT false
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.payroll_adjustments;
BEGIN
    SELECT * INTO a FROM public.payroll_adjustments WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحركة دي مش موجودة.' USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT public.is_business_manager(a.business_id) THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_kind NOT IN ('bonus', 'deduction', 'advance') OR COALESCE(p_amount, 0) <= 0 THEN
        RAISE EXCEPTION 'بيانات الحركة مش مظبوطة.' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.payroll_adjustments
       SET kind            = p_kind,
           amount          = abs(p_amount),
           reason          = COALESCE(p_reason, ''),
           entry_date      = COALESCE(p_entry_date, a.entry_date),
           period          = date_trunc('month', COALESCE(p_entry_date, a.entry_date))::date,
           apply_to_salary = CASE WHEN p_kind = 'bonus' THEN true ELSE COALESCE(p_apply_to_salary, a.apply_to_salary) END
     WHERE id = p_id;

    IF p_update_transaction AND a.transaction_id IS NOT NULL THEN
        UPDATE public.transactions
           SET amount           = -abs(p_amount),
               transaction_date = COALESCE(p_entry_date, a.entry_date),
               description      = 'سلفة — ' || public.payroll_member_name(a.business_user_id)
                                  || COALESCE(NULLIF(': ' || trim(p_reason), ': '), '')
         WHERE id = a.transaction_id AND business_id = a.business_id;
    END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.payroll_update_adjustment(UUID, TEXT, NUMERIC, TEXT, DATE, BOOLEAN, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Rollback:
--   DROP FUNCTION IF EXISTS public.payroll_update_adjustment(UUID, TEXT, NUMERIC, TEXT, DATE, BOOLEAN, BOOLEAN);
--   (payroll_check_open from 20261001_payroll.sql can be re-run to restore the old trigger body)
