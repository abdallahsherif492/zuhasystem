-- Update get_expenses_breakdown to remove sub_category and fix date comparison
CREATE OR REPLACE FUNCTION get_expenses_breakdown(from_date TIMESTAMP WITH TIME ZONE, to_date TIMESTAMP WITH TIME ZONE, b_id UUID)
RETURNS TABLE (
  category TEXT,
  total_amount NUMERIC
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.category,
    ABS(SUM(t.amount)) as total_amount
  FROM transactions t
  WHERE 
    t.type = 'expense' 
    AND t.transaction_date::DATE >= from_date::DATE 
    AND t.transaction_date::DATE <= to_date::DATE
    AND t.business_id = b_id
  GROUP BY t.category
  ORDER BY total_amount DESC;
END;
$$;
