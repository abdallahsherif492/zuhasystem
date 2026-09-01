-- Migration: two wrong numbers in the daily funnel
-- Created At: 2026-09-06
--
-- 1. Items per order was inflated by about a third.
--
--    The items CTE summed quantities for every order placed that day, and the
--    ratio divided that by the confirmed count alone. So the units on orders
--    the customer cancelled, and on orders nobody has called yet, were credited
--    to the orders that were confirmed. On August it read 2.215 against a real
--    1.625 — 4,131 units over all orders where only 3,031 are on confirmed ones.
--
--    That is not a rounding difference. It sits directly on top of the
--    cross-sell target the moderators are paid against, and it flattered it by
--    36%.
--
-- 2. The dashboard and the league disagreed about the delivery rate, on the
--    same screen, under the same word.
--
--    The league reports Collected out of every confirmed order, which is what
--    was asked for: an order still in transit counts against you until it
--    lands. The funnel reported Collected out of settled parcels only. On
--    August that is 69.3% against 81.9%, and both were labelled نسبة التسليم.
--
--    Both are worth knowing — one says how the month is actually going, the
--    other says how the courier performs on parcels that have finished — so
--    both are returned now, named apart, and the headline is the league's so
--    the two screens can no longer contradict each other.
--
-- Also added: the confirmation rate over decided orders. Counting Waiting in
-- the denominator makes today always look terrible, because an order placed an
-- hour ago has not been called yet. August is 70.2% of everything placed and
-- 73.3% of everything actually decided; the daily chart needs the second or
-- its last few points are noise.

DROP FUNCTION IF EXISTS public.get_daily_funnel(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE FUNCTION public.get_daily_funnel(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    day                  DATE,
    orders_count         BIGINT,
    confirmed_count      BIGINT,
    cancelled_count      BIGINT,
    waiting_count        BIGINT,
    delivered_count      BIGINT,
    returned_count       BIGINT,
    in_transit_count     BIGINT,
    items_count          BIGINT,   -- on confirmed orders only
    all_items_count      BIGINT,   -- every order placed, for reference
    sales_value          NUMERIC,
    confirmed_value      NUMERIC,
    delivered_value      NUMERIC,
    confirm_rate         NUMERIC,  -- of everything placed
    confirm_rate_decided NUMERIC,  -- of everything actually decided
    delivery_rate        NUMERIC,  -- Collected / confirmed, as the league counts
    settled_rate         NUMERIC,  -- Collected / (Collected + Returned)
    items_per_order      NUMERIC,
    avg_order_value      NUMERIC
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
               -- The ratio's numerator has to come from the same orders as its
               -- denominator. Units on a cancelled order are not cross-selling.
               COALESCE(SUM(i.qty) FILTER (
                   WHERE public.is_confirmed_order(s.status)), 0)             AS conf_qty,
               COALESCE(SUM(i.qty), 0)                                        AS all_qty,
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
           COALESCE(a.conf_qty, 0)::BIGINT,
           COALESCE(a.all_qty, 0)::BIGINT,
           ROUND(COALESCE(a.val, 0), 2),
           ROUND(COALESCE(a.conf_val, 0), 2),
           ROUND(COALESCE(a.deliv_val, 0), 2),
           ROUND(100.0 * a.conf / NULLIF(a.n, 0), 2),
           ROUND(100.0 * a.conf / NULLIF(a.conf + a.canc, 0), 2),
           ROUND(100.0 * a.deliv / NULLIF(a.conf, 0), 2),
           ROUND(100.0 * a.deliv / NULLIF(a.deliv + a.ret, 0), 2),
           ROUND(a.conf_qty::NUMERIC / NULLIF(a.conf, 0), 2),
           ROUND(a.conf_val / NULLIF(a.conf, 0), 2)
    FROM days
    LEFT JOIN agg a ON a.d = days.d
    ORDER BY days.d;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_funnel(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT sum(items_count), sum(all_items_count), sum(confirmed_count)
--     FROM get_daily_funnel('<id>', '2026-08-01', '2026-09-01');
--   -- 3,031 and 4,131 over 1,864 confirmed, so items per order is 1.63.
--
--   SELECT sum(delivered_count), sum(returned_count), sum(confirmed_count)
--     FROM get_daily_funnel('<id>', '2026-08-01', '2026-09-01');
--   -- 1,292 / 285 / 1,864: delivery_rate 69.3, settled_rate 81.9.
--   -- The 69.3 must equal what the Moderators League shows for August.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- Re-run 20260905_advanced_analytics.sql, which defines the previous shape.
