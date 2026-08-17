-- Migration: suppliers become accounts with a running balance
-- Created At: 2026-08-17
--
-- Payables were a list of invoices, each carrying a paid_amount that got
-- incremented in place. Three things that costs:
--
--   * There is no payment history. Paying an invoice three times leaves one
--     number; who paid, when, from which treasury, and how much each time are
--     all gone the moment the field is overwritten.
--   * There is no supplier balance. "What do we owe Ahmed" means summing
--     invoices in your head, and a payment that covers two invoices has
--     nowhere to go.
--   * Editing an invoice amount silently changes history with nothing to
--     compare against.
--
-- A supplier is now an account and every movement is a row: an invoice is what
-- we owe them, a payment is what we settled. The balance is the difference.
-- Nothing is ever overwritten to record a payment.

-- ===========================================================================
-- 1. The ledger
-- ===========================================================================
-- amount is always positive and the direction comes from entry_type. Storing
-- signed amounts invites a row that means the opposite of what it looks like.
CREATE TABLE IF NOT EXISTS public.supplier_ledger (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    supplier_id    UUID NOT NULL REFERENCES public.suppliers(id)  ON DELETE CASCADE,

    entry_type     TEXT NOT NULL CHECK (entry_type IN ('invoice', 'payment')),
    entry_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),

    description    TEXT,
    reference      TEXT,          -- invoice number, transfer reference
    account_name   TEXT,          -- treasury a payment left from
    transaction_id UUID,          -- the transactions row this created, if any

    -- Which old invoice this came from, so the backfill can be re-run safely
    -- and so a migrated figure can still be traced back.
    source_invoice_id UUID,

    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier
    ON public.supplier_ledger (business_id, supplier_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_business_date
    ON public.supplier_ledger (business_id, entry_date DESC);

ALTER TABLE public.supplier_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read supplier ledger" ON public.supplier_ledger;
CREATE POLICY "Members read supplier ledger"
ON public.supplier_ledger FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = supplier_ledger.business_id
      AND bu.user_email = auth.jwt() ->> 'email'
));

DROP POLICY IF EXISTS "Members write supplier ledger" ON public.supplier_ledger;
CREATE POLICY "Members write supplier ledger"
ON public.supplier_ledger FOR ALL TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = supplier_ledger.business_id
      AND bu.user_email = auth.jwt() ->> 'email'
))
WITH CHECK (EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = supplier_ledger.business_id
      AND bu.user_email = auth.jwt() ->> 'email'
));

-- ===========================================================================
-- 2. Carry the existing invoices over
-- ===========================================================================
-- Today: 13 invoices, 272,086 invoiced, 196,751 paid, 75,335 outstanding. The
-- balance after this block must be exactly 75,335 — verification at the bottom.
--
-- Guarded by source_invoice_id so re-running cannot double anything.
INSERT INTO public.supplier_ledger (
    business_id, supplier_id, entry_type, entry_date, amount,
    description, reference, source_invoice_id, created_by, created_at
)
SELECT
    si.business_id, si.supplier_id, 'invoice',
    COALESCE(si.invoice_date, si.created_at::DATE),
    si.total_amount,
    NULLIF(si.notes, ''),
    NULLIF(si.invoice_number, ''),
    si.id,
    'Migrated',
    si.created_at
FROM public.supplier_invoices si
WHERE COALESCE(si.total_amount, 0) > 0
  AND NOT EXISTS (
      SELECT 1 FROM public.supplier_ledger l
      WHERE l.source_invoice_id = si.id AND l.entry_type = 'invoice'
  );

-- The old schema only ever kept a running total, so the individual payments —
-- their dates, their treasuries — were never recorded and cannot be recovered.
-- Each invoice's paid_amount therefore becomes one opening payment, dated to
-- the invoice, and says so plainly rather than inventing a date.
INSERT INTO public.supplier_ledger (
    business_id, supplier_id, entry_type, entry_date, amount,
    description, reference, source_invoice_id, created_by, created_at
)
SELECT
    si.business_id, si.supplier_id, 'payment',
    COALESCE(si.invoice_date, si.created_at::DATE),
    si.paid_amount,
    'Opening balance carried over from the old invoice record. The previous '
    || 'system stored only a running total, so the individual payment dates '
    || 'and treasuries were never kept.',
    NULLIF(si.invoice_number, ''),
    si.id,
    'Migrated',
    si.created_at
FROM public.supplier_invoices si
WHERE COALESCE(si.paid_amount, 0) > 0
  AND NOT EXISTS (
      SELECT 1 FROM public.supplier_ledger l
      WHERE l.source_invoice_id = si.id AND l.entry_type = 'payment'
  );

-- ===========================================================================
-- 3. Balances
-- ===========================================================================
-- Aggregated in SQL so every screen reads one definition. SECURITY DEFINER, so
-- it checks membership before returning another tenant's numbers.
CREATE OR REPLACE FUNCTION public.get_supplier_balances(p_business_id UUID)
RETURNS TABLE (
    supplier_id     UUID,
    supplier_name   TEXT,
    phone           TEXT,
    invoiced_total  NUMERIC,
    paid_total      NUMERIC,
    balance         NUMERIC,
    entry_count     BIGINT,
    last_entry_date DATE
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
    SELECT
        s.id,
        s.name,
        s.phone,
        COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'invoice'), 0),
        COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'payment'), 0),
        COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'invoice'), 0)
      - COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'payment'), 0),
        COUNT(l.id),
        MAX(l.entry_date)
    FROM public.suppliers s
    -- LEFT JOIN so a supplier with no movements still appears at zero rather
    -- than vanishing from the list.
    LEFT JOIN public.supplier_ledger l
           ON l.supplier_id = s.id AND l.business_id = p_business_id
    WHERE s.business_id = p_business_id
    GROUP BY s.id, s.name, s.phone
    ORDER BY 6 DESC, s.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_supplier_balances(UUID) TO authenticated;

-- One number for the insights page.
CREATE OR REPLACE FUNCTION public.get_total_payables(p_business_id UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(SUM(
               CASE WHEN entry_type = 'invoice' THEN amount ELSE -amount END
           ), 0)
    FROM public.supplier_ledger
    WHERE business_id = p_business_id
      AND EXISTS (
          SELECT 1 FROM public.business_users bu
          WHERE bu.business_id = p_business_id
            AND bu.user_email = auth.jwt() ->> 'email'
      );
$$;

GRANT EXECUTE ON FUNCTION public.get_total_payables(UUID) TO authenticated;

-- ===========================================================================
-- 4. Every movement lands in the actions log
-- ===========================================================================
-- Its own function rather than the generic log_row_change, because a supplier
-- movement deserves a name a person can read — "Invoice #345645 — Ahmed
-- Trading" beats "ledger 8f2a1c". The field-level diff is kept, so editing an
-- amount records what it was and what it became.
CREATE OR REPLACE FUNCTION public.log_supplier_ledger_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row     JSONB;
    v_old     JSONB;
    v_changes JSONB;
    v_name    TEXT;
    v_sup     TEXT;
    v_email   TEXT;
    v_action  TEXT;
BEGIN
    BEGIN
        IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD); ELSE v_row := to_jsonb(NEW); END IF;
        IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;

        v_action := CASE TG_OP
                        WHEN 'INSERT' THEN 'create'
                        WHEN 'DELETE' THEN 'delete'
                        ELSE 'edit'
                    END;

        IF TG_OP = 'UPDATE' THEN
            SELECT jsonb_agg(jsonb_build_object(
                       'field', k, 'old_value', v_old -> k, 'new_value', v_row -> k))
              INTO v_changes
              FROM jsonb_object_keys(v_row) AS t(k)
             WHERE (v_old -> k) IS DISTINCT FROM (v_row -> k)
               AND k NOT IN ('updated_at', 'created_at');
            IF v_changes IS NULL THEN RETURN NEW; END IF;
        ELSE
            -- On create and delete, show the figures that matter rather than
            -- an empty diff.
            v_changes := jsonb_build_array(
                jsonb_build_object('field', 'Amount',
                                   'old_value', NULL,
                                   'new_value', (v_row ->> 'amount') || ' EGP'),
                jsonb_build_object('field', 'Type',
                                   'old_value', NULL,
                                   'new_value', v_row ->> 'entry_type')
            );
        END IF;

        SELECT name INTO v_sup FROM public.suppliers
         WHERE id = (v_row ->> 'supplier_id')::UUID;

        v_name := CASE WHEN v_row ->> 'entry_type' = 'invoice'
                       THEN 'Invoice' ELSE 'Payment' END
               || COALESCE(' #' || NULLIF(v_row ->> 'reference', ''), '')
               || COALESCE(' — ' || v_sup, '');

        BEGIN
            v_email := NULLIF(auth.jwt() ->> 'email', '');
        EXCEPTION WHEN OTHERS THEN
            v_email := NULL;
        END;

        INSERT INTO public.actions_log (
            business_id, user_email, action_type, entity_type,
            entity_id, entity_name, changes, metadata, created_at
        ) VALUES (
            (v_row ->> 'business_id')::UUID,
            COALESCE(v_email, NULLIF(v_row ->> 'created_by', ''), 'System'),
            v_action,
            'payable',
            v_row ->> 'id',
            v_name,
            v_changes,
            jsonb_build_object('source', 'trigger', 'table', 'supplier_ledger',
                               'entry_type', v_row ->> 'entry_type'),
            now()
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'log_supplier_ledger_change failed: %', SQLERRM;
    END;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_supplier_ledger ON public.supplier_ledger;
CREATE TRIGGER trg_audit_supplier_ledger
AFTER INSERT OR UPDATE OR DELETE ON public.supplier_ledger
FOR EACH ROW EXECUTE FUNCTION public.log_supplier_ledger_change();

-- The backfill above ran before this trigger existed, on purpose: 24 rows of
-- "migrated" noise at the top of the actions log would bury the real history.
-- (13 invoice entries + 11 payment entries; two invoices have never been paid.)

-- ===========================================================================
-- 5. The old table
-- ===========================================================================
-- supplier_invoices is left in place, untouched and no longer written to. It
-- is the only copy of what the figures looked like before the move, and
-- source_invoice_id points back into it. Drop it once the balances have been
-- checked against reality for a month.

-- ===========================================================================
-- Verify — run these after applying
-- ===========================================================================
--   SELECT SUM(CASE WHEN entry_type='invoice' THEN amount ELSE -amount END)
--     FROM supplier_ledger;                       -- must be 75335.00
--   SELECT SUM(amount) FROM supplier_ledger WHERE entry_type='invoice';  -- 272086
--   SELECT SUM(amount) FROM supplier_ledger WHERE entry_type='payment';  -- 196751
--   SELECT * FROM get_supplier_balances('<business id>');

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP TRIGGER IF EXISTS trg_audit_supplier_ledger ON public.supplier_ledger;
-- DROP FUNCTION IF EXISTS public.log_supplier_ledger_change();
-- DROP FUNCTION IF EXISTS public.get_supplier_balances(UUID);
-- DROP FUNCTION IF EXISTS public.get_total_payables(UUID);
-- DROP TABLE IF EXISTS public.supplier_ledger;
-- -- supplier_invoices was never modified, so the old page works again as-is.
