-- ==========================================
-- SYSTEM ADMIN AUDIT LOGS
-- ==========================================

-- 1. Create Audit Logs Table
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT NOT NULL,
    action TEXT NOT NULL, -- e.g., 'BANNED_BUSINESS', 'CHANGED_USER_ROLE', 'UPDATED_SETTINGS'
    entity_type TEXT NOT NULL, -- e.g., 'Business', 'User', 'Platform'
    entity_id TEXT, -- ID of the affected entity
    details JSONB, -- Optional extra data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
-- Only System Admins can insert logs (for now we assume frontend inserts them, but better security would be backend only. For rapid prototyping, we allow sys admins to insert)
CREATE POLICY "System Admins can insert audit logs" 
ON public.audit_logs FOR INSERT 
TO authenticated
WITH CHECK (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email') OR
    EXISTS (SELECT 1 FROM public.user_permissions WHERE email = auth.jwt() ->> 'email' AND super_admin = true)
);

-- Only System Admins can view audit logs
CREATE POLICY "System Admins can view audit logs" 
ON public.audit_logs FOR SELECT 
TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email') OR
    EXISTS (SELECT 1 FROM public.user_permissions WHERE email = auth.jwt() ->> 'email' AND super_admin = true)
);
