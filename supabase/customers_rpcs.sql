CREATE OR REPLACE FUNCTION get_customers_with_stats()
RETURNS TABLE (
    id UUID,
    name TEXT,
    phone TEXT,
    email TEXT,
    governorate TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    total_orders BIGINT,
    ordered_products UUID[]
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id,
        c.name,
        c.phone,
        c.email,
        c.governorate,
        c.created_at,
        COUNT(DISTINCT o.id)::BIGINT AS total_orders,
        ARRAY_AGG(DISTINCT oi.variant_id) FILTER (WHERE oi.variant_id IS NOT NULL) AS ordered_products
    FROM 
        customers c
    LEFT JOIN 
        orders o ON c.id = o.customer_id
    LEFT JOIN 
        order_items oi ON o.id = oi.order_id
    GROUP BY 
        c.id, c.name, c.phone, c.email, c.governorate, c.created_at;
END;
$$;
