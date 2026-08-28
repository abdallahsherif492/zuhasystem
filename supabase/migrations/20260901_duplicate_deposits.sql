-- Migration: find deposits that were booked more than once
-- Created At: 2026-09-01
--
-- The reconciliation panel already reports that the treasury holds more than
-- the orders claim, and 'over' tells you which orders. What it does not say is
-- why, and the why turns out to be mostly one thing: the same deposit posted
-- twice.
--
-- Across the whole history, 24 orders hold more in the treasury than their
-- paid_amount, and they split three ways because they need three different
-- fixes:
--
--   repeated    9 orders, 1,750 EGP. The identical amount booked two or more
--               times. One order has 100 EGP posted five separate times inside
--               35 minutes, another has 710 posted on the 22nd and again on
--               the 28th. Nobody mistypes the same number five times — that is
--               the deposit prompt being submitted more than once, and it
--               inflates the treasury with money that never arrived.
--   extra       7 orders, 495 EGP. Several bookings of different amounts
--               adding up to more than the order records. A second real
--               payment that the order's own field was never updated for.
--   overstated  8 orders, 1,147 EGP. A single transaction larger than the
--               order says. Someone typed the wrong figure, or edited the
--               order afterwards.
--
-- Only the first is money that does not exist. Lumping all three together
-- would hide that.
--
-- Reported by transaction date, not order date: a duplicate posted a week
-- after the order would otherwise fall outside every window you look at. The
-- whole group is returned whenever any one of its transactions lands in the
-- period, so you always see both sides of a pair.

CREATE OR REPLACE FUNCTION public.get_duplicate_deposits(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    kind           TEXT,      -- 'repeated' | 'extra' | 'overstated'
    order_id       UUID,
    reference      TEXT,
    order_date     TIMESTAMPTZ,
    customer_name  TEXT,
    customer_phone TEXT,
    order_status   TEXT,
    paid_amount    NUMERIC,   -- what the order records
    booked_total   NUMERIC,   -- what the treasury holds against it
    excess         NUMERIC,   -- booked_total - paid_amount, always positive
    txn_count      INT,
    txns           JSONB      -- every deposit row, so the pair is visible
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
    WITH dep AS (
        -- Every deposit ever booked against an order, not just the ones inside
        -- the window: a pair is only recognisable as a pair when both halves
        -- are in hand.
        SELECT t.id, t.order_id, t.transaction_date, ABS(t.amount) AS amount,
               t.account_name, t.description, t.category, t.created_at
        FROM public.transactions t
        WHERE t.business_id = p_business_id
          AND t.order_id IS NOT NULL
          AND public.is_deposit_category(t.category)
    ),
    grp AS (
        SELECT d.order_id,
               COUNT(*)::INT      AS n,
               SUM(d.amount)      AS total,
               -- Did any single amount get booked more than once?
               BOOL_OR(d.dup)     AS repeated,
               BOOL_OR(d.transaction_date >= p_from::DATE
                   AND d.transaction_date < p_to::DATE) AS in_window,
               JSONB_AGG(JSONB_BUILD_OBJECT(
                   'id',      d.id,
                   'date',    d.transaction_date,
                   'amount',  d.amount,
                   'account', d.account_name,
                   'category', d.category,
                   'description', d.description,
                   'created_at', d.created_at
               ) ORDER BY d.transaction_date, d.created_at) AS rows
        FROM (
            SELECT d.*,
                   COUNT(*) OVER (PARTITION BY d.order_id, d.amount) > 1 AS dup
            FROM dep d
        ) d
        GROUP BY d.order_id
    )
    SELECT CASE WHEN grp.repeated THEN 'repeated'
                WHEN grp.n > 1     THEN 'extra'
                ELSE                    'overstated' END,
           o.id,
           left(o.id::TEXT, 8),
           o.created_at,
           o.customer_info ->> 'name',
           o.customer_info ->> 'phone',
           o.status,
           COALESCE(o.paid_amount, 0),
           grp.total,
           grp.total - COALESCE(o.paid_amount, 0),
           grp.n,
           grp.rows
    FROM grp
    JOIN public.orders o ON o.id = grp.order_id
    WHERE grp.in_window
      -- Two instalments that together match the order are not a duplicate;
      -- only money the order never claimed to have received is.
      AND grp.total > COALESCE(o.paid_amount, 0) + 0.01
    ORDER BY 10 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_duplicate_deposits(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT kind, count(*), sum(excess)
--     FROM get_duplicate_deposits('<business id>', '2026-01-01', '2027-01-01')
--    GROUP BY kind;
--   -- repeated 9 / 1,750, extra 7 / 495, overstated 8 / 1,147.
--   -- On August alone: repeated 4 / 860, extra 0, overstated 7 / 553.
--
--   -- The five-times order:
--   SELECT reference, txn_count, paid_amount, booked_total, txns
--     FROM get_duplicate_deposits('<business id>', '2026-07-01', '2026-08-01')
--    WHERE reference = '8149dde7';

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.get_duplicate_deposits(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
