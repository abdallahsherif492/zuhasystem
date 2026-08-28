-- Migration: tie deposits to their orders, and reconcile the two
-- Created At: 2026-08-27
--
-- An order records paid_amount; the treasury records a Deposits transaction.
-- Nothing connected them except a customer-facing sentence in the description
-- ("Order #<uuid> - Name - Phone"), so nobody could answer the one question
-- that matters: is every deposit written on an order actually in the books?
--
-- It is not. Across 2026, 1,434 orders carry a deposit and only 1,292 deposit
-- transactions exist — a gap of 12,049 EGP, and it is widening: August alone
-- accounts for 6,077 of it. The cause is now fixed (the deposit dialog could be
-- dismissed with Skip, Escape or a click outside, and its insert was never
-- error-checked) but the history is still unreconciled, and without a real link
-- it stays that way.

-- ===========================================================================
-- 1. A real link
-- ===========================================================================
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS order_id UUID;

COMMENT ON COLUMN public.transactions.order_id IS
    'The order this transaction settles, when it settles one. Null for general revenue and expenses.';

CREATE INDEX IF NOT EXISTS idx_transactions_order
    ON public.transactions (business_id, order_id)
    WHERE order_id IS NOT NULL;

-- Recover the link for existing rows from the only place it was ever written.
-- Matched on the first 8 hex characters, which is the reference the rest of the
-- app prints; the description carries either the full uuid (older rows) or the
-- short form (newer), and this handles both.
UPDATE public.transactions t
   SET order_id = o.id
  FROM public.orders o
 WHERE t.order_id IS NULL
   AND t.description IS NOT NULL
   AND o.business_id = t.business_id
   AND substring(t.description from 'Order #([0-9a-fA-F]{8})') = left(o.id::TEXT, 8);

-- ===========================================================================
-- 2. Is anything missing?
-- ===========================================================================
-- Deposits are written under two spellings ('Deposits' and 'Deposit') by
-- different screens, so the check normalises rather than matching a literal.
CREATE OR REPLACE FUNCTION public.is_deposit_category(p_category TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(btrim(coalesce(p_category, ''))) IN ('deposit', 'deposits');
$$;

CREATE OR REPLACE FUNCTION public.get_deposit_reconciliation(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    orders_with_deposit   BIGINT,
    orders_deposit_value  NUMERIC,
    matched_orders        BIGINT,
    matched_value         NUMERIC,
    unmatched_orders      BIGINT,
    unmatched_value       NUMERIC,
    txn_count             BIGINT,
    txn_value             NUMERIC,
    orphan_txn_count      BIGINT,
    orphan_txn_value      NUMERIC
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
    WITH ord AS (
        SELECT o.id, o.paid_amount,
               COALESCE((SELECT SUM(ABS(t.amount)) FROM public.transactions t
                          WHERE t.order_id = o.id
                            AND t.business_id = p_business_id
                            AND public.is_deposit_category(t.category)), 0) AS booked
        FROM public.orders o
        WHERE o.business_id = p_business_id
          AND o.created_at >= p_from AND o.created_at < p_to
          AND COALESCE(o.paid_amount, 0) > 0
          AND lower(btrim(coalesce(o.status, ''))) <> 'cancelled'
    ),
    txn AS (
        SELECT t.id, ABS(t.amount) AS amount, t.order_id
        FROM public.transactions t
        WHERE t.business_id = p_business_id
          AND public.is_deposit_category(t.category)
          AND t.transaction_date >= p_from::DATE AND t.transaction_date < p_to::DATE
    )
    SELECT
        (SELECT COUNT(*) FROM ord),
        (SELECT COALESCE(SUM(paid_amount), 0) FROM ord),
        -- "Matched" means the treasury holds at least the amount the order
        -- claims. A part-booked deposit is still a hole, so it counts as
        -- unmatched rather than being rounded away.
        (SELECT COUNT(*) FROM ord WHERE booked >= paid_amount - 0.01),
        (SELECT COALESCE(SUM(paid_amount), 0) FROM ord WHERE booked >= paid_amount - 0.01),
        (SELECT COUNT(*) FROM ord WHERE booked < paid_amount - 0.01),
        (SELECT COALESCE(SUM(paid_amount - booked), 0) FROM ord WHERE booked < paid_amount - 0.01),
        (SELECT COUNT(*) FROM txn),
        (SELECT COALESCE(SUM(amount), 0) FROM txn),
        -- Money in the treasury that points at no order at all.
        (SELECT COUNT(*) FROM txn WHERE order_id IS NULL),
        (SELECT COALESCE(SUM(amount), 0) FROM txn WHERE order_id IS NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_deposit_reconciliation(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- The actual orders behind the gap, so it can be worked rather than just seen.
CREATE OR REPLACE FUNCTION public.get_unbooked_deposits(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    order_id       UUID,
    reference      TEXT,
    created_at     TIMESTAMPTZ,
    customer_name  TEXT,
    customer_phone TEXT,
    paid_amount    NUMERIC,
    booked_amount  NUMERIC,
    missing_amount NUMERIC,
    payment_status TEXT
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
    SELECT o.id,
           left(o.id::TEXT, 8),
           o.created_at,
           o.customer_info ->> 'name',
           o.customer_info ->> 'phone',
           o.paid_amount,
           booked.amt,
           o.paid_amount - booked.amt,
           o.payment_status
    FROM public.orders o
    CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(ABS(t.amount)), 0) AS amt
        FROM public.transactions t
        WHERE t.order_id = o.id
          AND t.business_id = p_business_id
          AND public.is_deposit_category(t.category)
    ) booked
    WHERE o.business_id = p_business_id
      AND o.created_at >= p_from AND o.created_at < p_to
      AND COALESCE(o.paid_amount, 0) > 0
      AND lower(btrim(coalesce(o.status, ''))) <> 'cancelled'
      AND booked.amt < o.paid_amount - 0.01
    ORDER BY (o.paid_amount - booked.amt) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unbooked_deposits(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT count(*) FROM transactions WHERE order_id IS NOT NULL;  -- backfilled
--   SELECT * FROM get_deposit_reconciliation('<business id>', '2026-01-01', '2026-09-01');
--   SELECT * FROM get_unbooked_deposits('<business id>', '2026-08-01', '2026-09-01');

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.get_unbooked_deposits(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
-- DROP FUNCTION IF EXISTS public.get_deposit_reconciliation(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
-- DROP FUNCTION IF EXISTS public.is_deposit_category(TEXT);
-- ALTER TABLE public.transactions DROP COLUMN IF EXISTS order_id;
