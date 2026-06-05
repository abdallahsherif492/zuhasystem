-- Fix RLS for subscription_plans to support both system_admins and user_permissions

DROP POLICY IF EXISTS "System Admins can manage plans" ON public.subscription_plans;

CREATE POLICY "System Admins can manage plans" 
ON public.subscription_plans FOR ALL 
TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email') OR
    EXISTS (SELECT 1 FROM public.user_permissions WHERE email = auth.jwt() ->> 'email' AND super_admin = true)
)
WITH CHECK (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email') OR
    EXISTS (SELECT 1 FROM public.user_permissions WHERE email = auth.jwt() ->> 'email' AND super_admin = true)
);
