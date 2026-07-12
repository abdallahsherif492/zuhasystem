-- Update get_expenses_breakdown to include b_id
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
    AND t.created_at >= from_date 
    AND t.created_at <= to_date
    AND t.business_id = b_id
  GROUP BY t.category, t.sub_category
  ORDER BY total_amount DESC;
END;
$$;

-- Update get_channel_performance to include b_id
CREATE OR REPLACE FUNCTION get_channel_performance(from_date TIMESTAMP WITH TIME ZONE, to_date TIMESTAMP WITH TIME ZONE, b_id UUID)
RETURNS TABLE (
  channel TEXT,
  total_orders BIGINT,
  delivered_orders BIGINT,
  total_revenue NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.channel,
    COUNT(*) as total_orders,
    COUNT(*) FILTER (WHERE o.status IN ('Delivered', 'Collected')) as delivered_orders,
    SUM(o.total_amount) as total_revenue
  FROM orders o
  WHERE 
    o.created_at >= from_date 
    AND o.created_at <= to_date
    AND o.business_id = b_id
    AND o.channel IS NOT NULL
  GROUP BY o.channel
  ORDER BY total_revenue DESC;
END;
$$;
