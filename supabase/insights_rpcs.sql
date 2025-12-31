
-- 1. Ads Metrics (Ads Spent from ads_expenses table)
CREATE OR REPLACE FUNCTION get_insight_ads_stats(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  total_ads_spent NUMERIC,
  total_orders BIGINT,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE((SELECT SUM(amount) FROM ads_expenses WHERE ad_date >= from_date::date AND ad_date <= to_date::date), 0) as total_ads_spent,
    COALESCE(COUNT(id), 0) as total_orders,
    COALESCE(SUM(total_amount), 0) as total_revenue
  FROM orders
  WHERE created_at >= from_date AND created_at <= to_date
  AND status != 'Cancelled'; -- Assuming we only count valid orders for this match
END;
$$ LANGUAGE plpgsql;


-- 2. Orders Metrics
-- Returns: count, revenue, cogs, shipping_sum, valid_count
CREATE OR REPLACE FUNCTION get_insight_orders_stats(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE
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
    COUNT(*) FILTER (WHERE status NOT IN ('Cancelled', 'Returned')) as won_count -- Adjust 'Won' definition
  FROM orders
  WHERE created_at >= from_date AND created_at <= to_date;
END;
$$ LANGUAGE plpgsql;


-- 3. Business (Accounting) Metrics
CREATE OR REPLACE FUNCTION get_insight_business_stats(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE
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
    COALESCE(SUM(CASE WHEN type = 'expense' AND category = 'ads' THEN amount ELSE 0 END), 0) as ads_expenses,
    COALESCE(SUM(CASE WHEN type = 'expense' AND category = 'purchases' THEN amount ELSE 0 END), 0) as purchases_expenses,
    COALESCE(SUM(CASE WHEN type = 'expense' AND category NOT IN ('ads', 'purchases') THEN amount ELSE 0 END), 0) as other_expenses
  FROM transactions
  WHERE transaction_date >= from_date::date AND transaction_date <= to_date::date;
END;
$$ LANGUAGE plpgsql;
