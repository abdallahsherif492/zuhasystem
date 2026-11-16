-- ===========================================================================
-- Removing a team member whose salary was already settled
-- ===========================================================================
-- Removing a member deleted their bonuses, deductions and advances with them
-- (payroll_adjustments ON DELETE CASCADE). For a month already settled that
-- delete is refused by payroll_check_open ("مرتب الشهر ده اتسوّى"), so the
-- member could not be removed at all; and for an open month their advances
-- vanished, though the money was paid out.
--
-- Now a member's entries stay when they leave: business_user_id is emptied
-- (like payslips, which already did this) and member_email says whose they
-- were. The settled-month guard only stops changes to the money (month,
-- kind, amount, date), so emptying the link or filling the email goes through.
-- Requires 20261001-20261003 payroll. Safe to run more than once.

ALTER TABLE public.payroll_adjustments ADD COLUMN IF NOT EXISTS member_email TEXT;

-- 1. The guard: a settled month's money cannot change; anything else can.
CREATE OR REPLACE FUNCTION public.payroll_check_open()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.period, NEW.kind, NEW.amount, NEW.entry_date) IS NOT DISTINCT FROM (OLD.period, OLD.kind, OLD.amount, OLD.entry_date)
       AND (NEW.business_user_id IS NULL OR NEW.business_user_id = OLD.business_user_id) THEN
        RETURN NEW;
    END IF;
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

-- 2. Whose each entry is, kept on the entry itself.
CREATE OR REPLACE FUNCTION public.payroll_adjustment_member_email()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.member_email IS NULL AND NEW.business_user_id IS NOT NULL THEN
        SELECT lower(user_email) INTO NEW.member_email FROM public.business_users WHERE id = NEW.business_user_id;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_payroll_adjustment_member_email ON public.payroll_adjustments;
CREATE TRIGGER trg_payroll_adjustment_member_email
    BEFORE INSERT OR UPDATE OF business_user_id ON public.payroll_adjustments
    FOR EACH ROW EXECUTE FUNCTION public.payroll_adjustment_member_email();

UPDATE public.payroll_adjustments a
   SET member_email = lower(bu.user_email)
  FROM public.business_users bu
 WHERE bu.id = a.business_user_id AND a.member_email IS NULL;

-- 3. A member who leaves keeps their entries, unlinked.
ALTER TABLE public.payroll_adjustments ALTER COLUMN business_user_id DROP NOT NULL;

DO $$
DECLARE c TEXT;
BEGIN
    FOR c IN
        SELECT con.conname FROM pg_constraint con
          JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
         WHERE con.conrelid = 'public.payroll_adjustments'::regclass AND con.contype = 'f'
           AND att.attname = 'business_user_id'
    LOOP
        EXECUTE format('ALTER TABLE public.payroll_adjustments DROP CONSTRAINT %I', c);
    END LOOP;
END $$;

ALTER TABLE public.payroll_adjustments
    ADD CONSTRAINT payroll_adjustments_business_user_id_fkey
    FOREIGN KEY (business_user_id) REFERENCES public.business_users(id) ON DELETE SET NULL;
