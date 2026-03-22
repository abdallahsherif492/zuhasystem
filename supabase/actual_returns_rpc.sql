-- Actual Returns RPC
CREATE OR REPLACE FUNCTION get_actual_returns_stats(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  delivered_revenue NUMERIC,
  delivered_cogs NUMERIC,
  operational_expenses NUMERIC,
  ads_expenses NUMERIC,
  total_shipping_cost NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Revenue of Delivered Orders
    COALESCE(SUM(total_amount), 0) as delivered_revenue,
    
    -- COGS of Delivered Orders
    COALESCE(SUM(total_cost), 0) as delivered_cogs,
    
    -- Operational Expenses from Transactions (type = 'expense') excluding 'Ads' if processed separately. Wait, we want all expenses for operational? Let's exclude ads to track it separately.
    (
      SELECT COALESCE(SUM(amount), 0) 
      FROM transactions 
      WHERE type = 'expense' 
      AND category != 'Ads' -- Excluding Ads assuming they are handled in ads_expenses or separate category
      AND transaction_date >= from_date::date AND transaction_date <= to_date::date
    ) as operational_expenses,
    
    -- Ads Expenses from ads_expenses table
    (
      SELECT COALESCE(SUM(amount), 0) 
      FROM ads_expenses 
      WHERE ad_date >= from_date::date AND ad_date <= to_date::date
    ) as ads_expenses,
    
    -- Shipping Cost (Charged to Customer) of Delivered Orders for reference
    COALESCE(SUM(shipping_cost), 0) as total_shipping_cost

  FROM orders
  WHERE status = 'Delivered' 
  AND created_at >= from_date AND created_at <= to_date;
END;
$$ LANGUAGE plpgsql;
