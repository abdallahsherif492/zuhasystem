DROP POLICY IF EXISTS "System Admins can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "System Admins can view audit logs" ON public.audit_logs;

CREATE POLICY "System Admins can insert audit logs" 
ON public.audit_logs FOR INSERT 
TO authenticated
WITH CHECK (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
);

CREATE POLICY "System Admins can view audit logs" 
ON public.audit_logs FOR SELECT 
TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
);
