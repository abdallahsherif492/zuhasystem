-- RPC to get Product Analysis Metrics
-- Returns: Product Name, Total Orders, Total Sales, Total Units, Delivery Rate
CREATE OR REPLACE FUNCTION get_products_analysis_metrics(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  total_orders BIGINT,
  total_sales NUMERIC,
  total_units NUMERIC,
  delivered_count BIGINT,
  delivery_rate NUMERIC
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH relevant_orders AS (
    SELECT id, status
    FROM orders 
    WHERE created_at >= from_date AND created_at <= to_date
    AND status != 'Cancelled'
  ),
  product_stats AS (
    SELECT 
      v.product_id,
      COUNT(DISTINCT ro.id) as order_count,
      SUM(oi.quantity) as units,
      SUM(oi.price_at_sale * oi.quantity) as revenue,
      COUNT(DISTINCT CASE WHEN ro.status = 'Delivered' THEN ro.id END) as delivered
    FROM relevant_orders ro
    JOIN order_items oi ON ro.id = oi.order_id
    JOIN variants v ON oi.variant_id = v.id
    GROUP BY v.product_id
  )
  SELECT
    p.id as product_id,
    p.name as product_name,
    COALESCE(ps.order_count, 0) as total_orders,
    COALESCE(ps.revenue, 0) as total_sales,
    COALESCE(ps.units, 0) as total_units,
    COALESCE(ps.delivered, 0) as delivered_count,
    CASE 
      WHEN COALESCE(ps.order_count, 0) > 0 THEN 
        ROUND((COALESCE(ps.delivered, 0)::numeric / ps.order_count::numeric) * 100, 2)
      ELSE 0 
    END as delivery_rate
  FROM products p
  LEFT JOIN product_stats ps ON p.id = ps.product_id
  ORDER BY total_sales DESC NULLS LAST;
END;
$$;
