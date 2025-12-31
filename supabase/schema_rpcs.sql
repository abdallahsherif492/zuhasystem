-- DASHBOARD SUMMARY RPC
-- Efficiently calculates basic dashboard stats
CREATE OR REPLACE FUNCTION get_dashboard_stats(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  total_sales NUMERIC,
  total_orders INTEGER,
  avg_order_value NUMERIC,
  stock_value NUMERIC,
  low_stock_count INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH sales_stats AS (
    SELECT 
      COALESCE(SUM(o.total_amount), 0) as sales,
      COUNT(o.id) as order_count,
      CASE WHEN COUNT(o.id) > 0 THEN COALESCE(SUM(o.total_amount), 0) / COUNT(o.id) ELSE 0 END as aov
    FROM orders o
    WHERE o.created_at >= from_date AND o.created_at <= to_date
  ),
  inventory_stats AS (
    SELECT 
      COALESCE(SUM(v.stock_qty * v.cost_price), 0) as inventory_val,
      COUNT(v.id) FILTER (WHERE v.track_inventory = TRUE AND v.stock_qty < 5) as low_stock
    FROM variants v
  )
  SELECT 
    s.sales,
    CAST(s.order_count AS INTEGER),
    s.aov,
    i.inventory_val,
    CAST(i.low_stock AS INTEGER)
  FROM sales_stats s, inventory_stats i;
END;
$$;


-- INSIGHTS KPIS RPC
-- Aggregates financial data from multiple tables (transactions, orders, ads)
CREATE OR REPLACE FUNCTION get_insights_kpis(
  from_date DATE,
  to_date DATE
)
RETURNS TABLE (
  transaction_revenue NUMERIC,
  total_expenses NUMERIC,
  ads_spend NUMERIC,
  net_profit NUMERIC,
  orders_count INTEGER,
  delivered_count INTEGER,
  collectable_value NUMERIC,
  won_rate NUMERIC,
  delivered_rate NUMERIC,
  roas NUMERIC,
  roi NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _revenue NUMERIC;
  _expenses NUMERIC;
  _ads NUMERIC;
  _orders_total INTEGER;
  _orders_delivered INTEGER;
  _orders_collected INTEGER;
  _orders_shipped INTEGER;
  _orders_returned INTEGER;
  _collectable NUMERIC;
BEGIN
  -- 1. Financials from Transactions & Ads
  SELECT COALESCE(SUM(amount), 0) INTO _revenue FROM transactions 
  WHERE type = 'revenue' AND transaction_date BETWEEN from_date AND to_date;

  SELECT COALESCE(SUM(amount), 0) INTO _expenses FROM transactions 
  WHERE type = 'expense' AND transaction_date BETWEEN from_date AND to_date;

  -- Get Ads Spend from dedicated table (more accurate if available)
  -- Or merge with transaction expenses if logic requires. 
  -- Let's sum from ads_expenses table for precision.
  SELECT COALESCE(SUM(amount), 0) INTO _ads FROM ads_expenses 
  WHERE ad_date BETWEEN from_date AND to_date;
  
  -- If Ads are also in transactions as expenses, we shouldn't double count total expenses.
  -- Assuming 'transactions' is the master ledger. 
  -- Let's use transactions for Total Expenses, and ads_expenses just for ROAS calculation.

  -- 2. Order Stats
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'Delivered'),
    COUNT(*) FILTER (WHERE status = 'Collected'),
    COUNT(*) FILTER (WHERE status = 'Shipped'),
    COUNT(*) FILTER (WHERE status = 'Returned'),
    COALESCE(SUM(total_amount - shipping_cost) FILTER (WHERE status = 'Delivered'), 0)
  INTO 
    _orders_total,
    _orders_delivered,
    _orders_collected,
    _orders_shipped,
    _orders_returned,
    _collectable
  FROM orders 
  WHERE created_at >= from_date::timestamp AND created_at <= (to_date || ' 23:59:59')::timestamp;

  -- 3. Calculate Derived Rates
  RETURN QUERY SELECT
    _revenue,
    _expenses,
    _ads,
    (_revenue - _expenses), -- Net Profit
    _orders_total,
    _orders_delivered,
    _collectable,
    CASE WHEN _orders_total > 0 THEN ((_orders_delivered + _orders_collected)::NUMERIC / _orders_total) * 100 ELSE 0 END, -- Won Rate
    CASE WHEN (_orders_shipped + _orders_delivered + _orders_collected) > 0 THEN ((_orders_delivered + _orders_collected)::NUMERIC / (_orders_shipped + _orders_delivered + _orders_collected)) * 100 ELSE 0 END, -- Delivery Rate
    CASE WHEN _ads > 0 THEN _revenue / _ads ELSE 0 END, -- ROAS (Rev/AdSpend)
    CASE WHEN _expenses > 0 THEN ((_revenue - _expenses) / _expenses) * 100 ELSE 0 END; -- ROI
END;
$$;


-- DAILY SALES CHART RPC
CREATE OR REPLACE FUNCTION get_daily_sales(
  from_date TIMESTAMP WITH TIME ZONE,
  to_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  day_date TEXT,
  total_sales NUMERIC,
  order_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day_k,
    SUM(total_amount) as sales,
    CAST(COUNT(*) AS INTEGER) as count
  FROM orders
  WHERE created_at >= from_date AND created_at <= to_date
  GROUP BY 1
  ORDER BY 1;
END;
$$;
