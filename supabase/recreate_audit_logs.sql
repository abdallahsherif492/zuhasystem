-- Drop the table if it already exists (maybe it was created before with different columns)
DROP TABLE IF EXISTS public.audit_logs CASCADE;

-- Recreate the table with the exact columns we need
CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Recreate RLS Policies with full System Admin / Super Admin checks
CREATE POLICY "System Admins can insert audit logs" 
ON public.audit_logs FOR INSERT 
TO authenticated
WITH CHECK (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email') OR
    EXISTS (SELECT 1 FROM public.user_permissions WHERE email = auth.jwt() ->> 'email' AND super_admin = true)
);

CREATE POLICY "System Admins can view audit logs" 
ON public.audit_logs FOR SELECT 
TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email') OR
    EXISTS (SELECT 1 FROM public.user_permissions WHERE email = auth.jwt() ->> 'email' AND super_admin = true)
);

-- Force schema reload
NOTIFY pgrst, 'reload schema';
