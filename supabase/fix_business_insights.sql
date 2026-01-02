-- Fix Business Metrics RPC to handle Case Sensitivity and correct Net Profit logic purely in SQL if desired, but we handle logic in frontend mostly.
-- Key fix: Case insensitive matching for categories.

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
    -- Expenses are stored as negative numbers
    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expenses,
    -- Match 'Ads' or 'ads'
    COALESCE(SUM(CASE WHEN type = 'expense' AND category ILIKE 'Ads' THEN amount ELSE 0 END), 0) as ads_expenses,
    -- Match 'Purchases' or 'purchases'
    COALESCE(SUM(CASE WHEN type = 'expense' AND category ILIKE 'Purchases' THEN amount ELSE 0 END), 0) as purchases_expenses,
    -- Match everything else
    COALESCE(SUM(CASE WHEN type = 'expense' AND category NOT ILIKE 'Ads' AND category NOT ILIKE 'Purchases' THEN amount ELSE 0 END), 0) as other_expenses
  FROM transactions
  WHERE transaction_date >= from_date::date AND transaction_date <= to_date::date;
END;
$$ LANGUAGE plpgsql;
