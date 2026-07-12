-- Update get_expenses_breakdown to include b_id and use transaction_date
CREATE OR REPLACE FUNCTION get_expenses_breakdown(from_date TIMESTAMP WITH TIME ZONE, to_date TIMESTAMP WITH TIME ZONE, b_id UUID)
RETURNS TABLE (
  category TEXT,
  sub_category TEXT,
  total_amount NUMERIC
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.category,
    COALESCE(t.sub_category, 'Unspecified') as sub_category,
    ABS(SUM(t.amount)) as total_amount
  FROM transactions t
  WHERE 
    t.type = 'expense' 
    AND t.transaction_date >= from_date 
    AND t.transaction_date <= to_date
    AND t.business_id = b_id
  GROUP BY t.category, t.sub_category
  ORDER BY total_amount DESC;
END;
$$;
