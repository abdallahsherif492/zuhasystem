-- Drop the old flawed policies
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
