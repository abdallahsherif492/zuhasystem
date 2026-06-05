-- ==========================================
-- PHASE 5: TEAM MANAGEMENT & ISOLATION
-- ==========================================

-- 1. Create User Shifts Table
CREATE TABLE IF NOT EXISTS public.user_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    clock_in TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    clock_out TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.user_shifts ENABLE ROW LEVEL SECURITY;

-- Staff can view shifts for their business
DROP POLICY IF EXISTS "Users can view shifts for their business" ON public.user_shifts;
CREATE POLICY "Users can view shifts for their business" 
ON public.user_shifts FOR SELECT 
TO authenticated
USING (
    business_id IN (
        SELECT business_id FROM public.business_users WHERE user_email = auth.jwt() ->> 'email'
    )
);

-- Staff can clock in (insert)
DROP POLICY IF EXISTS "Users can insert their own shifts" ON public.user_shifts;
CREATE POLICY "Users can insert their own shifts" 
ON public.user_shifts FOR INSERT 
TO authenticated
WITH CHECK (
    user_email = auth.jwt() ->> 'email' AND
    business_id IN (
        SELECT business_id FROM public.business_users WHERE user_email = auth.jwt() ->> 'email'
    )
);

-- Staff can clock out (update)
DROP POLICY IF EXISTS "Users can update their own shifts" ON public.user_shifts;
CREATE POLICY "Users can update their own shifts" 
ON public.user_shifts FOR UPDATE 
TO authenticated
USING (
    user_email = auth.jwt() ->> 'email'
)
WITH CHECK (
    user_email = auth.jwt() ->> 'email'
);


-- ==========================================
-- 2. REFACTOR RPCs FOR DATA ISOLATION
-- ==========================================

-- We will drop the old RPCs that did not filter by business_id
DROP FUNCTION IF EXISTS get_dashboard_stats(TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE);
DROP FUNCTION IF EXISTS get_daily_sales(TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE);
DROP FUNCTION IF EXISTS get_top_products(TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, INTEGER);

-- RECREATE WITH p_business_id
CREATE OR REPLACE FUNCTION get_dashboard_stats(
  from_date TIMESTAMP WITH TIME ZONE, 
  to_date TIMESTAMP WITH TIME ZONE,
  p_business_id UUID
)
RETURNS TABLE (
  total_sales NUMERIC,
  total_orders INTEGER,
  stock_value NUMERIC,
  low_stock_count INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER -- Use Invoker so RLS applies natively, but we still filter by business_id for multi-store owners
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE((SELECT SUM(total_amount) FROM orders WHERE created_at >= from_date AND created_at <= to_date AND business_id = p_business_id), 0) as total_sales,
    COALESCE((SELECT COUNT(*)::INTEGER FROM orders WHERE created_at >= from_date AND created_at <= to_date AND business_id = p_business_id), 0) as total_orders,
    COALESCE((SELECT SUM(stock_qty * cost_price) FROM variants WHERE business_id = p_business_id), 0) as stock_value,
    COALESCE((SELECT COUNT(*)::INTEGER FROM variants WHERE track_inventory = true AND stock_qty < 5 AND business_id = p_business_id), 0) as low_stock_count;
END;
$$;

CREATE OR REPLACE FUNCTION get_daily_sales(
  from_date TIMESTAMP WITH TIME ZONE, 
  to_date TIMESTAMP WITH TIME ZONE,
  p_business_id UUID
)
RETURNS TABLE (
  day_date DATE,
  total_sales NUMERIC,
  order_count INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE(created_at) as day_date,
    SUM(total_amount) as total_sales,
    COUNT(*)::INTEGER as order_count
  FROM orders
  WHERE created_at >= from_date AND created_at <= to_date AND business_id = p_business_id
  GROUP BY DATE(created_at)
  ORDER BY day_date ASC;
END;
$$;

CREATE OR REPLACE FUNCTION get_top_products(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE,
  p_business_id UUID,
  limit_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  variant_id UUID,
  product_name TEXT,
  total_sold INTEGER,
  total_revenue NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER
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
  WHERE o.created_at >= from_date AND o.created_at <= to_date AND o.business_id = p_business_id
  GROUP BY oi.variant_id, v.title, p.name
  ORDER BY total_sold DESC
  LIMIT limit_count;
END;
$$;

-- Force schema reload
NOTIFY pgrst, 'reload schema';
