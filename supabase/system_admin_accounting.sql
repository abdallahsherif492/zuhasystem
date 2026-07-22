-- ==========================================
-- SYSTEM ADMIN ACCOUNTING EXTENSION
-- ==========================================

-- 1. Create System Financial Accounts
CREATE TABLE IF NOT EXISTS public.system_financial_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.system_financial_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System Admins can manage system accounts" 
ON public.system_financial_accounts FOR ALL 
TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email') OR
    EXISTS (SELECT 1 FROM public.business_users WHERE user_email = auth.jwt() ->> 'email' AND role ILIKE '%super%')
);

-- 2. Modify revenue_transactions Table to be the Universal System Ledger
ALTER TABLE public.revenue_transactions ADD COLUMN IF NOT EXISTS account_name TEXT;
ALTER TABLE public.revenue_transactions ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General';
ALTER TABLE public.revenue_transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'paid';

-- 3. Create RPC for System Treasury Balances
CREATE OR REPLACE FUNCTION get_system_treasury_balances()
RETURNS TABLE (
    account_name TEXT,
    balance NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        rt.account_name,
        SUM(
            CASE 
                WHEN rt.type IN ('revenue', 'wallet_topup', 'package_purchase', 'transfer_in', 'investment') THEN rt.amount 
                WHEN rt.type IN ('expense', 'transfer_out') THEN -rt.amount 
                ELSE 0 
            END
        ) as balance
    FROM public.revenue_transactions rt
    WHERE rt.account_name IS NOT NULL
    AND rt.status = 'paid'
    GROUP BY rt.account_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
