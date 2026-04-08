-- ==========================================
-- TREASURY BALANCES RPC
-- ==========================================
-- Safely aggregates all treasury balances by iterating over the entire
-- transactions table locally inside Postgres. Bypasses the 1000 row limits
-- applied on the client interface to ensure financial consistency.

DROP FUNCTION IF EXISTS public.get_treasury_balances();
CREATE OR REPLACE FUNCTION public.get_treasury_balances()
RETURNS TABLE (account_name TEXT, balance NUMERIC)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    t.account_name, 
    COALESCE(SUM(t.amount), 0) AS balance
  FROM public.transactions t
  GROUP BY t.account_name;
$$;
