-- 1. Drop the old flawed policies for Businesses
DROP POLICY IF EXISTS "Businesses can view their own payment requests" ON public.payment_requests;
DROP POLICY IF EXISTS "Businesses can insert payment requests" ON public.payment_requests;

-- Recreate with robust checks using BOTH user_id and user_email just to be safe
CREATE POLICY "Businesses can view their own payment requests" 
ON public.payment_requests FOR SELECT 
TO authenticated
USING (
    business_id IN (
        SELECT business_id FROM public.business_users 
        WHERE user_id = auth.uid() OR user_email = auth.jwt() ->> 'email'
    )
);

CREATE POLICY "Businesses can insert payment requests" 
ON public.payment_requests FOR INSERT 
TO authenticated
WITH CHECK (
    business_id IN (
        SELECT business_id FROM public.business_users 
        WHERE user_id = auth.uid() OR user_email = auth.jwt() ->> 'email'
    )
);

-- 2. Drop the old flawed policy for System Admins
DROP POLICY IF EXISTS "System Admins can manage payment requests" ON public.payment_requests;

-- Recreate to allow BOTH users in system_admins AND users with 'super' role in business_users
CREATE POLICY "System Admins can manage payment requests" 
ON public.payment_requests FOR ALL 
TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
    OR
    EXISTS (SELECT 1 FROM public.business_users WHERE user_email = auth.jwt() ->> 'email' AND role ILIKE '%super%')
);

-- Do the same for packages table to ensure System Admins can manage packages
DROP POLICY IF EXISTS "System Admins can manage packages" ON public.packages;

CREATE POLICY "System Admins can manage packages" 
ON public.packages FOR ALL 
TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
    OR
    EXISTS (SELECT 1 FROM public.business_users WHERE user_email = auth.jwt() ->> 'email' AND role ILIKE '%super%')
);

-- Do the same for revenue_transactions table
DROP POLICY IF EXISTS "System Admins can view revenue transactions" ON public.revenue_transactions;
DROP POLICY IF EXISTS "System Admins can insert revenue transactions" ON public.revenue_transactions;

CREATE POLICY "System Admins can view revenue transactions" 
ON public.revenue_transactions FOR SELECT 
TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
    OR
    EXISTS (SELECT 1 FROM public.business_users WHERE user_email = auth.jwt() ->> 'email' AND role ILIKE '%super%')
);

CREATE POLICY "System Admins can insert revenue transactions" 
ON public.revenue_transactions FOR INSERT 
TO authenticated
WITH CHECK (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
    OR
    EXISTS (SELECT 1 FROM public.business_users WHERE user_email = auth.jwt() ->> 'email' AND role ILIKE '%super%')
);
