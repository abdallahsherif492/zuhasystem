-- Migration: explain the difference, in both directions
-- Created At: 2026-08-29
--
-- The reconciliation panel reported only one direction — orders whose deposit
-- is missing from the treasury. On August the treasury actually holds MORE than
-- the orders claim (17,362 against 15,759) and the panel could not say why.
--
-- Decomposed, that +1,603 is not a single problem and none of it is missing
-- money:
--
--   +850  eleven deposits paid in August against orders created in July. The
--         order counts in July's figure and its money in August's, because the
--         two sides are dated by different columns — created_at for orders,
--         transaction_date for transactions. Real, correctly recorded, and it
--         will always appear at a month boundary.
--   +653  nine orders whose treasury total exceeds their paid_amount. A second
--         deposit was taken and booked while the order's own field was left at
--         the first. That one is worth looking at.
--
-- Every case gets a reason rather than being netted into one number, because
-- "the treasury is 1,603 higher" is not actionable and "nine orders were paid
-- twice and the order never recorded it" is.

CREATE OR REPLACE FUNCTION public.get_deposit_discrepancies(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    reason         TEXT,
    order_id       UUID,
    reference      TEXT,
    order_date     TIMESTAMPTZ,
    customer_name  TEXT,
    customer_phone TEXT,
    order_amount   NUMERIC,   -- what the order says was paid
    booked_amount  NUMERIC,   -- what the treasury holds against it
    delta          NUMERIC    -- always positive: the size of the discrepancy
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
    -- Orders created in the period, against everything booked to them in any
    -- period. Scoping the booking to the same window would report a deposit
    -- taken a day later as missing.
    WITH ord AS (
        SELECT o.id, o.created_at, o.paid_amount,
               o.customer_info ->> 'name'  AS cname,
               o.customer_info ->> 'phone' AS cphone,
               COALESCE((SELECT SUM(ABS(t.amount)) FROM public.transactions t
                          WHERE t.order_id = o.id
                            AND t.business_id = p_business_id
                            AND public.is_deposit_category(t.category)), 0) AS booked
        FROM public.orders o
        WHERE o.business_id = p_business_id
          AND o.created_at >= p_from AND o.created_at < p_to
          AND COALESCE(o.paid_amount, 0) > 0
          AND lower(btrim(coalesce(o.status, ''))) <> 'cancelled'
    )
    SELECT 'short'::TEXT, ord.id, left(ord.id::TEXT, 8), ord.created_at,
           ord.cname, ord.cphone, ord.paid_amount, ord.booked,
           ord.paid_amount - ord.booked
    FROM ord WHERE ord.booked < ord.paid_amount - 0.01

    UNION ALL

    SELECT 'over'::TEXT, ord.id, left(ord.id::TEXT, 8), ord.created_at,
           ord.cname, ord.cphone, ord.paid_amount, ord.booked,
           ord.booked - ord.paid_amount
    FROM ord WHERE ord.booked > ord.paid_amount + 0.01

    UNION ALL

    -- Money received in this period against an order created outside it. Not a
    -- fault — it is why the two totals differ at a boundary — but it has to be
    -- named or the difference looks unexplained.
    SELECT 'carried_in'::TEXT, o.id, left(o.id::TEXT, 8), o.created_at,
           o.customer_info ->> 'name', o.customer_info ->> 'phone',
           o.paid_amount, ABS(t.amount), ABS(t.amount)
    FROM public.transactions t
    JOIN public.orders o ON o.id = t.order_id
    WHERE t.business_id = p_business_id
      AND public.is_deposit_category(t.category)
      AND t.transaction_date >= p_from::DATE AND t.transaction_date < p_to::DATE
      AND (o.created_at < p_from OR o.created_at >= p_to)

    UNION ALL

    -- Treasury rows that point at no order at all.
    SELECT 'orphan'::TEXT, NULL::UUID, COALESCE(NULLIF(left(t.description, 40), ''), '—'),
           t.transaction_date::TIMESTAMPTZ, NULL, NULL,
           0::NUMERIC, ABS(t.amount), ABS(t.amount)
    FROM public.transactions t
    WHERE t.business_id = p_business_id
      AND public.is_deposit_category(t.category)
      AND t.order_id IS NULL
      AND t.transaction_date >= p_from::DATE AND t.transaction_date < p_to::DATE

    ORDER BY 9 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_deposit_discrepancies(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT reason, count(*), sum(delta)
--     FROM get_deposit_discrepancies('<business id>', '2026-08-01', '2026-09-01')
--    GROUP BY reason;
--   -- on August: 9 'over' totalling 653, 11 'carried_in' totalling 850,
--   -- 0 'short', 0 'orphan'.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.get_deposit_discrepancies(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
