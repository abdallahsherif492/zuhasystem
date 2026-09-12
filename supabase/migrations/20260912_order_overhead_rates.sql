-- Migration: each order's share of the month's costs
-- Created At: 2026-09-12
--
-- The orders list showed orders.profit, a generated column defined as
-- total_amount - total_cost - actual_shipping_cost. That is a gross margin on
-- goods and delivery, and it was being read as the profit of the order. Summed
-- over June–August it came to 879,933 EGP; the real net for the same orders,
-- after ads, salaries, rent and returns, was 21,495. It also printed a profit
-- on every returned order, whose revenue never arrived.
--
-- The honest figure needs the costs that are not attached to any one order.
-- This returns them per month, with the month's confirmed orders to divide them
-- by — the same denominator the expenses page uses for its cost per order, so
-- the two screens agree. The app applies the share per order and treats each
-- status for what it is: delivered orders earn, returned orders cost, orders
-- still moving are shown as a projection, cancelled ones carry nothing.
--
-- Checked against the monthly P&L before shipping: for June, July and August
-- the per-order figures add up to the month's net, with the only difference
-- being the handful of orders still in transit, shown as projections.
--
-- A month that has not closed has not had its salaries and rent booked yet, so
-- is_complete lets the app price those orders at the trailing rate instead of
-- a partial month that would make everything look profitable.
--
-- Damages are read net of recoveries from v_damage_ledger (20260910).

CREATE OR REPLACE FUNCTION public.get_order_overhead_rates(p_business_id UUID)
RETURNS TABLE (
    month           DATE,
    confirmed_count BIGINT,
    ads_total       NUMERIC,
    opex_total      NUMERIC,
    damages_total   NUMERIC,
    overhead_total  NUMERIC,
    per_order       NUMERIC,
    is_complete     BOOLEAN
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
        SELECT date_trunc('month', o.created_at)::DATE AS m,
               COUNT(*) FILTER (WHERE public.is_confirmed_order(o.status)) AS c
        FROM public.orders o
        WHERE o.business_id = p_business_id
        GROUP BY 1
    ),
    ex AS (
        -- Purchases are stock and already sit inside each order's total_cost;
        -- counting them here as well would charge every product twice.
        SELECT date_trunc('month', t.transaction_date)::DATE AS m,
               COALESCE(SUM(ABS(t.amount)) FILTER (
                   WHERE lower(btrim(COALESCE(t.category, ''))) = 'ads'), 0) AS a,
               COALESCE(SUM(ABS(t.amount)) FILTER (
                   WHERE lower(btrim(COALESCE(t.category, ''))) NOT IN ('ads', 'purchases')), 0) AS x
        FROM public.transactions t
        WHERE t.business_id = p_business_id
          AND lower(btrim(COALESCE(t.type, ''))) = 'expense'
        GROUP BY 1
    ),
    dm AS (
        SELECT date_trunc('month', d.date)::DATE AS m, COALESCE(SUM(d.loss), 0) AS l
        FROM public.v_damage_ledger d
        WHERE d.business_id = p_business_id
        GROUP BY 1
    )
    SELECT ord.m,
           ord.c,
           ROUND(COALESCE(ex.a, 0), 2),
           ROUND(COALESCE(ex.x, 0), 2),
           ROUND(COALESCE(dm.l, 0), 2),
           ROUND(COALESCE(ex.a, 0) + COALESCE(ex.x, 0) + COALESCE(dm.l, 0), 2),
           ROUND((COALESCE(ex.a, 0) + COALESCE(ex.x, 0) + COALESCE(dm.l, 0))
                 / NULLIF(ord.c, 0), 2),
           ord.m < date_trunc('month', now())::DATE
    FROM ord
    LEFT JOIN ex ON ex.m = ord.m
    LEFT JOIN dm ON dm.m = ord.m
    ORDER BY ord.m;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_order_overhead_rates(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT month, confirmed_count, overhead_total, per_order, is_complete
--     FROM get_order_overhead_rates('<business id>') WHERE month >= '2026-06-01';
--   -- June ≈ 166, July ≈ 130, August ≈ 129 per confirmed order; September
--   -- is_complete = false, and the app prices it at the June–August average.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.get_order_overhead_rates(UUID);
