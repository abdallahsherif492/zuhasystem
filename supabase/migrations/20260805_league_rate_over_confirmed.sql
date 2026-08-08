-- Migration: delivery rate is Collected out of Confirmed
-- Created At: 2026-08-05
--
-- The rate was Collected against Returned — of the orders that reached a
-- conclusion, how many landed. That answers a courier question. The one being
-- asked of a moderator is different: of everything you confirmed, how much of
-- it actually turned into a collected order. Orders that stalled, were never
-- shipped, or are still sitting somewhere are part of that answer, and the old
-- denominator excluded all of them.
--
-- So the denominator is now every confirmed order — the same population the
-- orders meter counts — and nothing drops out of it.
--
-- ---------------------------------------------------------------------------
-- This file is deliberately self-contained.
--
-- It first shipped assuming 20260804 had already run, and it had not. PL/pgSQL
-- resolves function calls at call time, not at CREATE time, so the migration
-- applied cleanly and the dashboard then failed with 42883 —
-- is_confirmed_order(text) does not exist. Splitting a dependency across two
-- files only works if both are applied, in order; these are applied by hand.
-- Every helper the league needs is therefore defined below, all idempotent, so
-- running this one file is enough no matter what came before it.
-- ---------------------------------------------------------------------------

-- Confirmed: the same line the dashboard's Confirmed Orders tile draws.
CREATE OR REPLACE FUNCTION public.is_confirmed_order(p_status TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(btrim(coalesce(p_status,''))) NOT IN ('waiting', 'cancelled');
$$;

-- Success is Collected alone. Delivered is not where this business finishes,
-- so an order sitting in it still counts against the rate until it lands.
CREATE OR REPLACE FUNCTION public.is_delivery_success(p_status TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(btrim(coalesce(p_status,''))) = 'collected';
$$;

CREATE OR REPLACE FUNCTION public.is_delivery_failure(p_status TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(btrim(coalesce(p_status,''))) = 'returned';
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
        -- Collected out of every confirmed order, not out of the settled ones.
        ROUND(
            100.0 * COUNT(*) FILTER (WHERE public.is_delivery_success(s.status))
            / NULLIF(COUNT(*), 0)
        , 2)
    FROM scoped s
    LEFT JOIN item_counts ic ON ic.order_id = s.id
    GROUP BY s.closed_by
    ORDER BY (s.closed_by IS NULL), COUNT(*) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_moderator_league(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- returned_count is still returned so the standings can show it, but it no
-- longer takes any part in the rate.
