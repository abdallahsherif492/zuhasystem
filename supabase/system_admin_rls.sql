-- ==========================================
-- SAAS RLS POLICIES FOR SYSTEM ADMIN
-- ==========================================

-- Allow System Admins to UPDATE businesses
DROP POLICY IF EXISTS "System Admins can update businesses" ON public.businesses;
CREATE POLICY "System Admins can update businesses" 
ON public.businesses FOR UPDATE 
TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email'
    )
);

-- Note: We already added SELECT access for System Admins in onboarding_rls.sql
-- USING ( id IN (...) OR EXISTS ( SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email' ) );
