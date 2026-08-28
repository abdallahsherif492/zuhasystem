-- Migration: how much of what we sold has actually been paid for
-- Created At: 2026-08-26
--
-- The revenues page shows money that arrived. It could not answer the question
-- immediately behind that: of the orders placed in this period, how many are
-- paid, part-paid, and not paid at all — and how much money is sitting in the
-- gap.
--
-- Aggregated in SQL. The page already pages through transactions for its charts
-- and there are ~9,800 orders; pulling them into the browser to produce three
-- rows would be the slowest thing on the screen.
--
-- Cancelled orders are excluded: an order that never shipped is not an unpaid
-- debt, and counting it as one makes the outstanding figure meaningless.
CREATE OR REPLACE FUNCTION public.get_payment_status_breakdown(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    payment_status TEXT,
    orders_count   BIGINT,
    total_value    NUMERIC,
    paid_value     NUMERIC,
    outstanding    NUMERIC
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
        -- Normalised: the column holds 'Paid', 'Partially Paid', 'Not Paid'
        -- and, on older rows, nothing at all. A null is not a fourth category,
        -- it is an unpaid order nobody set a status on.
        CASE lower(btrim(coalesce(o.payment_status, '')))
            WHEN 'paid'           THEN 'Paid'
            WHEN 'partially paid' THEN 'Partially Paid'
            WHEN 'partial'        THEN 'Partially Paid'
            ELSE 'Not Paid'
        END,
        COUNT(*)::BIGINT,
        ROUND(COALESCE(SUM(o.total_amount), 0), 2),
        ROUND(COALESCE(SUM(o.paid_amount), 0), 2),
        -- Never negative: an overpaid order would otherwise quietly cancel out
        -- someone else's genuine debt in the total.
        ROUND(COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0) - COALESCE(o.paid_amount, 0), 0)), 0), 2)
    FROM public.orders o
    WHERE o.business_id = p_business_id
      AND o.created_at >= p_from
      AND o.created_at <  p_to
      AND lower(btrim(coalesce(o.status, ''))) <> 'cancelled'
    GROUP BY 1
    ORDER BY 2 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_payment_status_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT * FROM get_payment_status_breakdown(
--     '<business id>', '2026-01-01', '2026-09-01');
--   -- three rows at most; sum(orders_count) must equal the count of
--   -- non-cancelled orders created in the range.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.get_payment_status_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
