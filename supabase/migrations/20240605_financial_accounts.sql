-- 1. Create financial_accounts table
CREATE TABLE IF NOT EXISTS public.financial_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Treasury',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(business_id, name)
);

-- 2. Enable RLS
ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage financial accounts for their business" ON public.financial_accounts
    FOR ALL USING (business_id IN (SELECT business_id FROM public.business_users WHERE user_email = auth.jwt() ->> 'email'));

-- 3. Migrate existing accounts from transactions
INSERT INTO public.financial_accounts (business_id, name)
SELECT DISTINCT business_id, account_name 
FROM public.transactions
WHERE account_name IS NOT NULL
ON CONFLICT (business_id, name) DO NOTHING;

-- 4. Update the RPC to use p_business_id
DROP FUNCTION IF EXISTS public.get_treasury_balances();
CREATE OR REPLACE FUNCTION public.get_treasury_balances(p_business_id UUID)
RETURNS TABLE (account_name TEXT, balance NUMERIC)
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT 
    t.account_name, 
    COALESCE(SUM(t.amount), 0) AS balance
  FROM public.transactions t
  WHERE t.business_id = p_business_id
  GROUP BY t.account_name;
$$;
