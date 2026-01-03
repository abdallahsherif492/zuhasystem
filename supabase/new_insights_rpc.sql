CREATE OR REPLACE FUNCTION get_business_value_stats()
RETURNS TABLE (
    total_investment NUMERIC,
    pending_orders_value NUMERIC,
    treasury_abdallah NUMERIC,
    treasury_mohamed NUMERIC,
    total_stock_value NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        -- 1. Total Investment: Sum of 'investment' type transactions
        COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'investment'), 0) as total_investment,

        -- 2. Pending Orders Value: Pending, Processing, Shipped (Not Delivered/Cancelled/Returned)
        COALESCE((SELECT SUM(total_amount) FROM orders WHERE status IN ('Pending', 'Processing', 'Shipped')), 0) as pending_orders_value,

        -- 3. Treasury Balances
        COALESCE((SELECT SUM(amount) FROM transactions WHERE account_name = 'Abdallah Sherif'), 0) as treasury_abdallah,
        COALESCE((SELECT SUM(amount) FROM transactions WHERE account_name = 'Mohamed Adel'), 0) as treasury_mohamed,

        -- 4. Stock Value
        COALESCE((SELECT SUM(cost_price * stock_qty) FROM variants), 0) as total_stock_value;
END;
$$ LANGUAGE plpgsql;
