DROP FUNCTION IF EXISTS get_insight_orders_stats(text, text);
DROP FUNCTION IF EXISTS get_insight_orders_stats(timestamp with time zone, timestamp with time zone);

CREATE OR REPLACE FUNCTION get_insight_orders_stats(from_date TIMESTAMP WITH TIME ZONE, to_date TIMESTAMP WITH TIME ZONE, b_id UUID)
RETURNS TABLE (
  total_count BIGINT
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_count
  FROM orders o
  WHERE 
    o.created_at >= from_date 
    AND o.created_at <= to_date
    AND o.business_id = b_id;
END;
$$;

DROP FUNCTION IF EXISTS get_channel_performance(timestamp with time zone, timestamp with time zone);

CREATE OR REPLACE FUNCTION get_channel_performance(from_date TIMESTAMP WITH TIME ZONE, to_date TIMESTAMP WITH TIME ZONE, b_id UUID)
RETURNS TABLE (
  channel TEXT,
  total_sales NUMERIC,
  order_count BIGINT
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(o.source, 'Direct') as channel,
    SUM(o.total_price) as total_sales,
    COUNT(o.id) as order_count
  FROM orders o
  WHERE 
    o.created_at >= from_date 
    AND o.created_at <= to_date
    AND o.business_id = b_id
  GROUP BY o.source
  ORDER BY total_sales DESC;
END;
$$;
