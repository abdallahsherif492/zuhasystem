-- RPC to get Daily Ads Performance (Spend, Revenue, CPO, ROAS)
CREATE OR REPLACE FUNCTION get_daily_ads_performance(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  day_date DATE,
  daily_ads_spent NUMERIC,
  daily_orders BIGINT,
  daily_revenue NUMERIC,
  daily_cpo NUMERIC,
  daily_roas NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(from_date::date, to_date::date, '1 day'::interval)::date as day
  ),
  daily_ads AS (
    SELECT 
      ad_date, 
      SUM(amount) as amount 
    FROM ads_expenses 
    WHERE ad_date >= from_date::date AND ad_date <= to_date::date
    GROUP BY ad_date
  ),
  daily_orders AS (
    SELECT 
      created_at::date as order_date, 
      COUNT(id) as order_count, 
      SUM(total_amount) as revenue 
    FROM orders 
    WHERE created_at >= from_date AND created_at <= to_date
    AND status != 'Cancelled'
    GROUP BY created_at::date
  )
  SELECT
    ds.day,
    COALESCE(da.amount, 0) as daily_ads_spent,
    COALESCE(d_ord.order_count, 0) as daily_orders,
    COALESCE(d_ord.revenue, 0) as daily_revenue,
    CASE 
        WHEN COALESCE(d_ord.order_count, 0) > 0 THEN COALESCE(da.amount, 0) / d_ord.order_count 
        ELSE 0 
    END as daily_cpo,
    CASE 
        WHEN COALESCE(da.amount, 0) > 0 THEN COALESCE(d_ord.revenue, 0) / da.amount 
        ELSE 0 
    END as daily_roas
  FROM date_series ds
  LEFT JOIN daily_ads da ON ds.day = da.ad_date
  LEFT JOIN daily_orders d_ord ON ds.day = d_ord.order_date
  ORDER BY ds.day;
END;
$$ LANGUAGE plpgsql;
