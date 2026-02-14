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
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id as product_id,
    p.name as product_name,
    COUNT(DISTINCT o.id) as total_orders,
    COALESCE(SUM(oi.price_at_sale * oi.quantity), 0) as total_sales,
    COALESCE(SUM(oi.quantity), 0) as total_units,
    COUNT(DISTINCT CASE WHEN o.status = 'Delivered' THEN o.id END) as delivered_count,
    CASE 
      WHEN COUNT(DISTINCT o.id) > 0 THEN 
        ROUND((COUNT(DISTINCT CASE WHEN o.status = 'Delivered' THEN o.id END)::numeric / COUNT(DISTINCT o.id)::numeric) * 100, 2)
      ELSE 0 
    END as delivery_rate
  FROM products p
  JOIN variants v ON p.id = v.product_id
  JOIN order_items oi ON v.id = oi.variant_id
  JOIN orders o ON oi.order_id = o.id
  WHERE o.created_at >= from_date AND o.created_at <= to_date
  AND o.status != 'Cancelled' -- Exclude cancelled orders from "Total Orders"? usually yes for analysis
  GROUP BY p.id, p.name
  ORDER BY total_sales DESC;
END;
$$ LANGUAGE plpgsql;
