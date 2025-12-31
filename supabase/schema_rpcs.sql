
-- TOP PRODUCTS RPC (Updated)
-- Now joins with products table to show "Product Name - Variant"
CREATE OR REPLACE FUNCTION get_top_products(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE,
  limit_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  variant_id UUID,
  product_name TEXT,
  total_sold INTEGER,
  total_revenue NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    oi.variant_id,
    (p.name || ' (' || v.title || ')') as product_name,
    CAST(SUM(oi.quantity) AS INTEGER) as total_sold,
    SUM(oi.price_at_sale * oi.quantity) as total_revenue
  FROM order_items oi
  JOIN orders o ON oi.order_id = o.id
  JOIN variants v ON oi.variant_id = v.id
  JOIN products p ON v.product_id = p.id
  WHERE o.created_at >= from_date AND o.created_at <= to_date
  GROUP BY oi.variant_id, v.title, p.name
  ORDER BY total_sold DESC
  LIMIT limit_count;
END;
$$;
