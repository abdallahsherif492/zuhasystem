-- Migration: the numbers behind the dashboard and the league, per day
-- Created At: 2026-09-05
--
-- Both screens showed totals. A total tells you where you ended up and nothing
-- about how you got there: 1,443 returns across 10,209 orders is a fact, but
-- whether the return rate is climbing or a single bad week dragged it down is
-- the part you can act on, and neither screen could answer it.
--
-- Four functions, all aggregating in SQL. The browser must never pull 10,000
-- orders to count them — that path already cost this project real bugs when a
-- paged fetch silently dropped rows.
--
-- On the definitions, which have to be the same everywhere or the screens
-- argue with each other:
--   confirmed = anything that is not Waiting and not Cancelled. It is the
--               moderator's output: the customer said yes.
--   delivered = Collected only. Delivered is not where this business finishes;
--               an order sitting in it still counts against the rate.
--   returned  = Returned.
--   delivery rate = delivered / (delivered + returned), so parcels still in
--               transit neither help nor hurt until they land.
--
-- Every rate is computed on the cohort of orders created that day, not on what
-- happened that day. A parcel placed Monday and returned Friday belongs to
-- Monday, because Monday is the day whose decisions produced it.

-- ===========================================================================
-- 1. The daily funnel
-- ===========================================================================
-- One row per day in the range, including days with nothing, so a chart shows
-- a gap as a gap instead of closing it up and implying continuity.
CREATE OR REPLACE FUNCTION public.get_daily_funnel(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    day               DATE,
    orders_count      BIGINT,
    confirmed_count   BIGINT,
    cancelled_count   BIGINT,
    waiting_count     BIGINT,
    delivered_count   BIGINT,
    returned_count    BIGINT,
    in_transit_count  BIGINT,
    items_count       BIGINT,
    sales_value       NUMERIC,
    confirmed_value   NUMERIC,
    delivered_value   NUMERIC,
    confirm_rate      NUMERIC,
    delivery_rate     NUMERIC,
    items_per_order   NUMERIC,
    avg_order_value   NUMERIC
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
    WITH days AS (
        SELECT generate_series(p_from::DATE, (p_to - INTERVAL '1 day')::DATE,
                               INTERVAL '1 day')::DATE AS d
    ),
    scoped AS (
        SELECT o.id, o.status, o.total_amount, o.created_at::DATE AS d
        FROM public.orders o
        WHERE o.business_id = p_business_id
          AND o.created_at >= p_from
          AND o.created_at <  p_to
    ),
    -- Summed per order before joining, or total_amount multiplies by the
    -- number of lines on the order.
    items AS (
        SELECT oi.order_id, COALESCE(SUM(oi.quantity), 0) AS qty
        FROM public.order_items oi
        JOIN scoped s ON s.id = oi.order_id
        GROUP BY oi.order_id
    ),
    agg AS (
        SELECT s.d,
               COUNT(*)                                                       AS n,
               COUNT(*) FILTER (WHERE public.is_confirmed_order(s.status))     AS conf,
               COUNT(*) FILTER (WHERE lower(btrim(COALESCE(s.status,''))) = 'cancelled') AS canc,
               COUNT(*) FILTER (WHERE lower(btrim(COALESCE(s.status,''))) = 'waiting')   AS wait,
               COUNT(*) FILTER (WHERE public.is_delivery_success(s.status))    AS deliv,
               COUNT(*) FILTER (WHERE public.is_delivery_failure(s.status))    AS ret,
               COALESCE(SUM(i.qty), 0)                                        AS qty,
               COALESCE(SUM(s.total_amount), 0)                               AS val,
               COALESCE(SUM(s.total_amount) FILTER (
                   WHERE public.is_confirmed_order(s.status)), 0)             AS conf_val,
               COALESCE(SUM(s.total_amount) FILTER (
                   WHERE public.is_delivery_success(s.status)), 0)            AS deliv_val
        FROM scoped s
        LEFT JOIN items i ON i.order_id = s.id
        GROUP BY s.d
    )
    SELECT days.d,
           COALESCE(a.n, 0)::BIGINT,
           COALESCE(a.conf, 0)::BIGINT,
           COALESCE(a.canc, 0)::BIGINT,
           COALESCE(a.wait, 0)::BIGINT,
           COALESCE(a.deliv, 0)::BIGINT,
           COALESCE(a.ret, 0)::BIGINT,
           GREATEST(COALESCE(a.conf, 0) - COALESCE(a.deliv, 0) - COALESCE(a.ret, 0), 0)::BIGINT,
           COALESCE(a.qty, 0)::BIGINT,
           ROUND(COALESCE(a.val, 0), 2),
           ROUND(COALESCE(a.conf_val, 0), 2),
           ROUND(COALESCE(a.deliv_val, 0), 2),
           ROUND(100.0 * a.conf / NULLIF(a.n, 0), 2),
           ROUND(100.0 * a.deliv / NULLIF(a.deliv + a.ret, 0), 2),
           ROUND(a.qty::NUMERIC / NULLIF(a.conf, 0), 2),
           ROUND(a.conf_val / NULLIF(a.conf, 0), 2)
    FROM days
    LEFT JOIN agg a ON a.d = days.d
    ORDER BY days.d;
END;
$$;

-- ===========================================================================
-- 2. Governorates
-- ===========================================================================
-- Where the orders come from, and — the part that actually matters — where
-- they come back from. A governorate can be second by volume and last by
-- delivery rate, and only one of those two facts changes what you do.
CREATE OR REPLACE FUNCTION public.get_governorate_performance(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    governorate      TEXT,
    orders_count     BIGINT,
    confirmed_count  BIGINT,
    delivered_count  BIGINT,
    returned_count   BIGINT,
    delivery_rate    NUMERIC,
    sales_value      NUMERIC,
    delivered_value  NUMERIC,
    avg_order_value  NUMERIC,
    shipping_cost    NUMERIC,
    profit           NUMERIC
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
    SELECT COALESCE(NULLIF(btrim(o.customer_info ->> 'governorate'), ''), 'غير محددة'),
           COUNT(*)::BIGINT,
           COUNT(*) FILTER (WHERE public.is_confirmed_order(o.status))::BIGINT,
           COUNT(*) FILTER (WHERE public.is_delivery_success(o.status))::BIGINT,
           COUNT(*) FILTER (WHERE public.is_delivery_failure(o.status))::BIGINT,
           ROUND(100.0 * COUNT(*) FILTER (WHERE public.is_delivery_success(o.status))
                 / NULLIF(COUNT(*) FILTER (WHERE public.is_delivery_success(o.status)
                                              OR public.is_delivery_failure(o.status)), 0), 2),
           ROUND(COALESCE(SUM(o.total_amount) FILTER (
               WHERE public.is_confirmed_order(o.status)), 0), 2),
           ROUND(COALESCE(SUM(o.total_amount) FILTER (
               WHERE public.is_delivery_success(o.status)), 0), 2),
           ROUND(COALESCE(SUM(o.total_amount) FILTER (
               WHERE public.is_confirmed_order(o.status)), 0)
                 / NULLIF(COUNT(*) FILTER (WHERE public.is_confirmed_order(o.status)), 0), 2),
           -- Shipping is paid on every parcel that moved, delivered or not.
           ROUND(COALESCE(SUM(o.actual_shipping_cost) FILTER (
               WHERE public.is_delivery_success(o.status)
                  OR public.is_delivery_failure(o.status)), 0), 2),
           -- Only a delivered order earns. A return keeps its shipping cost.
           ROUND(
               COALESCE(SUM(o.total_amount - COALESCE(o.total_cost,0)
                            - COALESCE(o.actual_shipping_cost,0)) FILTER (
                   WHERE public.is_delivery_success(o.status)), 0)
               - COALESCE(SUM(o.actual_shipping_cost) FILTER (
                   WHERE public.is_delivery_failure(o.status)), 0)
           , 2)
    FROM public.orders o
    WHERE o.business_id = p_business_id
      AND o.created_at >= p_from
      AND o.created_at <  p_to
    GROUP BY 1
    HAVING COUNT(*) > 0
    ORDER BY 2 DESC;
END;
$$;

-- ===========================================================================
-- 3. Products
-- ===========================================================================
-- Ranked by units on confirmed orders, with the return rate beside them,
-- because the best seller and the most returned product are often the same
-- one and a units-only list hides that completely.
CREATE OR REPLACE FUNCTION public.get_product_performance(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ,
    p_limit       INT DEFAULT 15
)
RETURNS TABLE (
    product_id       UUID,
    product_name     TEXT,
    units            BIGINT,
    orders_count     BIGINT,
    revenue          NUMERIC,
    delivered_units  BIGINT,
    returned_units   BIGINT,
    return_rate      NUMERIC,
    avg_price        NUMERIC
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
    WITH lines AS (
        SELECT p.id AS pid, p.name AS pname, oi.order_id,
               oi.quantity AS qty,
               oi.quantity * COALESCE(oi.price_at_sale, 0) AS line_value,
               o.status
        FROM public.order_items oi
        JOIN public.orders   o ON o.id = oi.order_id
        JOIN public.variants v ON v.id = oi.variant_id
        JOIN public.products p ON p.id = v.product_id
        WHERE o.business_id = p_business_id
          AND o.created_at >= p_from
          AND o.created_at <  p_to
          AND public.is_confirmed_order(o.status)
    )
    SELECT l.pid, l.pname,
           COALESCE(SUM(l.qty), 0)::BIGINT,
           COUNT(DISTINCT l.order_id)::BIGINT,
           ROUND(COALESCE(SUM(l.line_value), 0), 2),
           COALESCE(SUM(l.qty) FILTER (WHERE public.is_delivery_success(l.status)), 0)::BIGINT,
           COALESCE(SUM(l.qty) FILTER (WHERE public.is_delivery_failure(l.status)), 0)::BIGINT,
           ROUND(100.0 * COALESCE(SUM(l.qty) FILTER (WHERE public.is_delivery_failure(l.status)), 0)
                 / NULLIF(COALESCE(SUM(l.qty) FILTER (
                       WHERE public.is_delivery_success(l.status)
                          OR public.is_delivery_failure(l.status)), 0), 0), 2),
           ROUND(COALESCE(SUM(l.line_value), 0) / NULLIF(COALESCE(SUM(l.qty), 0), 0), 2)
    FROM lines l
    GROUP BY l.pid, l.pname
    ORDER BY 3 DESC
    LIMIT GREATEST(p_limit, 1);
END;
$$;

-- ===========================================================================
-- 4. The league, day by day
-- ===========================================================================
-- The standings say who is ahead. This says whether they got there steadily or
-- on one good week, and it is what a moderator's own chart is drawn from.
CREATE OR REPLACE FUNCTION public.get_moderator_daily(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    day              DATE,
    closed_by        TEXT,
    orders_count     BIGINT,
    items_count      BIGINT,
    delivered_count  BIGINT,
    returned_count   BIGINT,
    sales_value      NUMERIC
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
        SELECT o.id, o.closed_by, o.status, o.total_amount, o.created_at::DATE AS d
        FROM public.orders o
        WHERE o.business_id = p_business_id
          AND o.closed_by IS NOT NULL
          AND o.created_at >= p_from
          AND o.created_at <  p_to
          AND lower(btrim(COALESCE(o.status,''))) <> 'cancelled'
    ),
    items AS (
        SELECT oi.order_id, COALESCE(SUM(oi.quantity), 0) AS qty
        FROM public.order_items oi
        JOIN scoped s ON s.id = oi.order_id
        GROUP BY oi.order_id
    )
    SELECT s.d, s.closed_by,
           COUNT(*)::BIGINT,
           COALESCE(SUM(i.qty), 0)::BIGINT,
           COUNT(*) FILTER (WHERE public.is_delivery_success(s.status))::BIGINT,
           COUNT(*) FILTER (WHERE public.is_delivery_failure(s.status))::BIGINT,
           ROUND(COALESCE(SUM(s.total_amount), 0), 2)
    FROM scoped s
    LEFT JOIN items i ON i.order_id = s.id
    GROUP BY s.d, s.closed_by
    ORDER BY s.d, s.closed_by;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_funnel(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_governorate_performance(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_performance(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_moderator_daily(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT sum(orders_count), sum(confirmed_count), sum(delivered_count)
--     FROM get_daily_funnel('<id>', '2026-08-01', '2026-09-01');
--   -- must equal the same counts taken straight off orders for August.
--
--   SELECT sum(orders_count) FROM get_governorate_performance('<id>', ...);
--   -- must equal the funnel's total: every order has a governorate bucket,
--   -- blank ones included under 'غير محددة'.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.get_daily_funnel(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
-- DROP FUNCTION IF EXISTS public.get_governorate_performance(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
-- DROP FUNCTION IF EXISTS public.get_product_performance(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT);
-- DROP FUNCTION IF EXISTS public.get_moderator_daily(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
