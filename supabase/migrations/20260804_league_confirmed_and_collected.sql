-- Migration: count confirmed orders, and rate delivery on Collected
-- Created At: 2026-08-04
--
-- Two corrections to how the league measures things.
--
-- 1. The order count included orders still sitting in Waiting. Those have not
--    been confirmed with anyone yet, so counting them towards a confirmation
--    target inflates it with work that has not happened. The dashboard's
--    "Confirmed Orders" tile already draws the line — everything except
--    Waiting and Cancelled — and the league now uses the same rule so the two
--    numbers on the same screen cannot say different things.
--
-- 2. Delivery rate counted Delivered and Collected together. Collected is the
--    status this business actually finishes on; Delivered is used on a handful
--    of orders and is not the end of the journey. Success is now Collected
--    alone.

-- ===========================================================================
-- 1. Success means Collected
-- ===========================================================================
-- Delivered is deliberately neither a success nor a failure now: it is not the
-- terminal state here, so an order sitting in it is still in flight and drops
-- out of the ratio entirely rather than being counted as won.
CREATE OR REPLACE FUNCTION public.is_delivery_success(p_status TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(btrim(coalesce(p_status,''))) = 'collected';
$$;

-- Unchanged, restated so this file reads as the whole rule.
CREATE OR REPLACE FUNCTION public.is_delivery_failure(p_status TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(btrim(coalesce(p_status,''))) = 'returned';
$$;

-- ===========================================================================
-- 2. Confirmed orders only
-- ===========================================================================
-- Matches src/app/(dashboard)/dashboard/page.tsx — an order counts once it is
-- neither Waiting nor Cancelled.
CREATE OR REPLACE FUNCTION public.is_confirmed_order(p_status TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(btrim(coalesce(p_status,''))) NOT IN ('waiting', 'cancelled');
$$;

CREATE OR REPLACE FUNCTION public.get_moderator_league(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    closed_by        TEXT,
    orders_count     BIGINT,
    items_count      BIGINT,
    items_per_order  NUMERIC,
    sales_value      NUMERIC,
    delivered_count  BIGINT,
    returned_count   BIGINT,
    delivery_rate    NUMERIC
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
    WITH scoped AS (
        SELECT o.id, o.closed_by, o.status, o.total_amount
        FROM public.orders o
        WHERE o.business_id = p_business_id
          AND o.created_at >= p_from
          AND o.created_at <  p_to
          AND public.is_confirmed_order(o.status)
    ),
    -- Summed per order first. Joining items straight onto orders would
    -- multiply total_amount by the number of lines — on real data that
    -- overstated sales by 37%.
    item_counts AS (
        SELECT oi.order_id, COALESCE(SUM(oi.quantity), 0) AS qty
        FROM public.order_items oi
        JOIN scoped s ON s.id = oi.order_id
        GROUP BY oi.order_id
    )
    SELECT
        s.closed_by,
        COUNT(*)::BIGINT,
        COALESCE(SUM(ic.qty), 0)::BIGINT,
        ROUND(COALESCE(SUM(ic.qty), 0)::NUMERIC / NULLIF(COUNT(*), 0), 2),
        ROUND(COALESCE(SUM(s.total_amount), 0)::NUMERIC, 2),
        (COUNT(*) FILTER (WHERE public.is_delivery_success(s.status)))::BIGINT,
        (COUNT(*) FILTER (WHERE public.is_delivery_failure(s.status)))::BIGINT,
        ROUND(
            100.0 * COUNT(*) FILTER (WHERE public.is_delivery_success(s.status))
            / NULLIF(COUNT(*) FILTER (
                WHERE public.is_delivery_success(s.status)
                   OR public.is_delivery_failure(s.status)
              ), 0)
        , 2)
    FROM scoped s
    LEFT JOIN item_counts ic ON ic.order_id = s.id
    GROUP BY s.closed_by
    ORDER BY (s.closed_by IS NULL), COUNT(*) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_moderator_league(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ===========================================================================
-- Note on is_delivery_success
-- ===========================================================================
-- is_cod_collected() in 20260730_cod_settlements.sql still treats Delivered and
-- Collected alike, and is left alone on purpose: that one decides when money is
-- owed by a courier, which is a different question from whether a moderator's
-- order landed. Changing it here would quietly move the settlement figures.
