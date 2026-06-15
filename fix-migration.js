const fs = require('fs');
let content = fs.readFileSync('supabase/shipping_costs_migration.sql', 'utf8');

// Update the SQL to drop and recreate profit
const newSql = `-- 1. Add is_default to shipping_companies
ALTER TABLE IF EXISTS public.shipping_companies
ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;

-- 2. Add actual_shipping_cost to orders and update generated profit
ALTER TABLE IF EXISTS public.orders
ADD COLUMN IF NOT EXISTS actual_shipping_cost NUMERIC DEFAULT 0;

ALTER TABLE IF EXISTS public.orders DROP COLUMN IF EXISTS profit;
ALTER TABLE IF EXISTS public.orders ADD COLUMN profit NUMERIC GENERATED ALWAYS AS (total_amount - total_cost - COALESCE(actual_shipping_cost, 0)) STORED;

-- 3. Backfill actual_shipping_cost for orders between May 1, 2026 and June 15, 2026
-- The 'profit' column will automatically recalculate!
DO $$
DECLARE
    ord_record RECORD;
    gov TEXT;
    shipping_co_id UUID;
    shipping_co_rates JSONB;
    act_ship_cost NUMERIC;
BEGIN
    FOR ord_record IN
        SELECT id, customer_info, shipping_company_id, business_id
        FROM public.orders
        WHERE created_at >= '2026-05-01 00:00:00'
          AND created_at <= '2026-06-15 23:59:59'
    LOOP
        act_ship_cost := 0;
        gov := ord_record.customer_info->>'governorate';
        shipping_co_id := ord_record.shipping_company_id;

        IF shipping_co_id IS NOT NULL AND gov IS NOT NULL THEN
            SELECT rates INTO shipping_co_rates
            FROM public.shipping_companies
            WHERE id = shipping_co_id AND business_id = ord_record.business_id;

            IF shipping_co_rates IS NOT NULL AND shipping_co_rates ? gov THEN
                act_ship_cost := (shipping_co_rates->>gov)::NUMERIC;
            ELSE
                IF gov IN ('Cairo', 'Giza', 'New Cairo', 'القاهرة', 'الجيزة') THEN
                    act_ship_cost := 65;
                ELSE
                    act_ship_cost := 75;
                END IF;
            END IF;
        ELSE
            IF gov IN ('Cairo', 'Giza', 'New Cairo', 'القاهرة', 'الجيزة') THEN
                act_ship_cost := 65;
            ELSE
                act_ship_cost := 75;
            END IF;
        END IF;

        UPDATE public.orders
        SET actual_shipping_cost = act_ship_cost
        WHERE id = ord_record.id;
    END LOOP;
END $$;

-- 4. Update get_insight_orders_stats RPC to use actual_shipping_cost
CREATE OR REPLACE FUNCTION get_insight_orders_stats(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  total_count BIGINT,
  total_revenue NUMERIC,
  total_cogs NUMERIC,
  total_shipping NUMERIC,
  won_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) as total_count,
    COALESCE(SUM(total_amount), 0) as total_revenue,
    COALESCE(SUM(total_cost), 0) as total_cogs,
    COALESCE(SUM(actual_shipping_cost), 0) as total_shipping,
    COUNT(*) FILTER (WHERE status NOT IN ('Cancelled', 'Returned')) as won_count
  FROM orders
  WHERE created_at >= from_date AND created_at <= to_date;
END;
$$ LANGUAGE plpgsql;
`;

fs.writeFileSync('supabase/shipping_costs_migration.sql', newSql);
