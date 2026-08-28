-- Migration: find the deposits that were booked more than once
-- Created At: 2026-09-01
--
-- The reconciliation panel already says the treasury holds more than the
-- orders claim, and 'over' says which orders. It never said why.
--
-- 24 orders hold more than their paid_amount, and they split four ways because
-- they need four different fixes. The largest group is the one that is hardest
-- to see by eye:
--
--   two_screens  6 orders, 1,160 EGP. The same order deposited twice through
--                two different screens. Platform Orders writes category
--                'orders_collection' and describes the order by its EasyOrders
--                id; the order create/edit screen writes category 'Deposits'
--                and describes it by the system id. Different category,
--                different description, different id — so scrolling the
--                accounting page they do not look like the same order at all,
--                and nobody notices. Order 69cbca50 was booked 710 on the 22nd
--                as a platform collection and 710 again on the 28th as a
--                deposit.
--   repeated     4 orders, 790 EGP. Same screen, same amount, more than once.
--                One order has 100 EGP posted five separate times on the same
--                day. That is the button being pressed again.
--   extra        6 orders, 295 EGP. Several different amounts on one screen
--                summing above what the order records — a second real payment
--                the order's own field was never updated for.
--   overstated   8 orders, 1,147 EGP. A single transaction larger than the
--                order says. A wrong figure, or the order edited afterwards.
--
-- The first two are money the treasury shows and never received. The last two
-- are bookkeeping that has fallen behind. Reporting one combined "1,953 over"
-- figure would hide which is which.
--
-- easyorders_id is returned alongside the reference because for a platform
-- order that is the string in the transaction's description, and searching
-- accounting for the system reference alone will not find it.
--
-- Grouped by transaction date, not order date: a duplicate posted a week after
-- the order would otherwise fall outside every window you look at. The whole
-- group is returned whenever any one of its transactions lands in the period,
-- so a pair is never shown as a single.

CREATE OR REPLACE FUNCTION public.get_duplicate_deposits(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    kind           TEXT,      -- 'two_screens' | 'repeated' | 'extra' | 'overstated'
    order_id       UUID,
    reference      TEXT,
    easyorders_id  TEXT,      -- the id the platform-order description carries
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
               COUNT(*)::INT                        AS n,
               SUM(d.amount)                        AS total,
               -- Did any single amount get booked more than once?
               BOOL_OR(d.dup)                       AS repeated,
               -- More than one category means more than one screen wrote it.
               COUNT(DISTINCT lower(btrim(COALESCE(d.category, ''))))::INT AS cats,
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
    SELECT CASE WHEN grp.n > 1 AND grp.cats > 1 THEN 'two_screens'
                WHEN grp.repeated                THEN 'repeated'
                WHEN grp.n > 1                   THEN 'extra'
                ELSE                                  'overstated' END,
           o.id,
           left(o.id::TEXT, 8),
           o.easyorders_id::TEXT,
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
    ORDER BY 11 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_duplicate_deposits(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT kind, count(*), sum(excess)
--     FROM get_duplicate_deposits('<business id>', '2026-01-01', '2027-01-01')
--    GROUP BY kind;
--   -- two_screens 6 / 1,160, repeated 4 / 790, extra 6 / 295,
--   -- overstated 8 / 1,147.
--
--   -- The two-screen case, both halves visible:
--   SELECT reference, easyorders_id, paid_amount, booked_total, txns
--     FROM get_duplicate_deposits('<business id>', '2026-08-01', '2026-09-01')
--    WHERE reference = '69cbca50';
--   -- 710 as 'orders_collection' on the 22nd, 710 as 'Deposits' on the 28th.
--
-- Not covered, and cannot be: 104 hand-entered deposits worth 13,464 EGP that
-- name no order at all — 85 of them have no description whatsoever. They are
-- already reported as 'orphan' by get_deposit_discrepancies.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.get_duplicate_deposits(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
