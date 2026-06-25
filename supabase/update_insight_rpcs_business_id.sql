-- 1. Ads Metrics
CREATE OR REPLACE FUNCTION get_insight_ads_stats(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE,
  b_id UUID
)
RETURNS TABLE (
  total_ads_spent NUMERIC,
  total_orders BIGINT,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE((SELECT SUM(amount) FROM ads_expenses WHERE ad_date >= from_date::date AND ad_date <= to_date::date AND business_id = b_id), 0) as total_ads_spent,
    COALESCE(COUNT(id), 0) as total_orders,
    COALESCE(SUM(total_amount), 0) as total_revenue
  FROM orders
  WHERE created_at >= from_date AND created_at <= to_date
  AND status != 'Cancelled'
  AND business_id = b_id;
END;
$$ LANGUAGE plpgsql;

-- 2. Orders Metrics
CREATE OR REPLACE FUNCTION get_insight_orders_stats(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE,
  b_id UUID
)
RETURNS TABLE (
  total_count BIGINT,
  total_revenue NUMERIC,
  total_cogs NUMERIC,
  total_shipping NUMERIC,
  won_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) as total_count,
    COALESCE(SUM(total_amount), 0) as total_revenue,
    COALESCE(SUM(total_cost), 0) as total_cogs,
    COALESCE(SUM(shipping_cost), 0) as total_shipping,
    COUNT(*) FILTER (WHERE status NOT IN ('Cancelled', 'Returned')) as won_count
  FROM orders
  WHERE created_at >= from_date AND created_at <= to_date
  AND business_id = b_id;
END;
$$ LANGUAGE plpgsql;

-- 3. Business (Accounting) Metrics
CREATE OR REPLACE FUNCTION get_insight_business_stats(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE,
  b_id UUID
)
RETURNS TABLE (
  total_revenue NUMERIC,
  total_expenses NUMERIC,
  ads_expenses NUMERIC,
  purchases_expenses NUMERIC,
  other_expenses NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN type = 'revenue' THEN amount ELSE 0 END), 0) as total_revenue,
    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expenses,
    COALESCE(SUM(CASE WHEN type = 'expense' AND category ILIKE 'Ads' THEN amount ELSE 0 END), 0) as ads_expenses,
    COALESCE(SUM(CASE WHEN type = 'expense' AND category ILIKE 'Purchases' THEN amount ELSE 0 END), 0) as purchases_expenses,
    COALESCE(SUM(CASE WHEN type = 'expense' AND category NOT ILIKE 'Ads' AND category NOT ILIKE 'Purchases' THEN amount ELSE 0 END), 0) as other_expenses
  FROM transactions
  WHERE transaction_date >= from_date::date AND transaction_date <= to_date::date
  AND business_id = b_id;
END;
$$ LANGUAGE plpgsql;

-- 4. Daily Ads Performance
CREATE OR REPLACE FUNCTION get_daily_ads_performance(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE,
  b_id UUID
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
    AND business_id = b_id
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
    AND business_id = b_id
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
