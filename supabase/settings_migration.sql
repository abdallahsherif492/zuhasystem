-- ==========================================
-- PLATFORM SETTINGS (System Admin V2)
-- ==========================================

CREATE TABLE IF NOT EXISTS public.platform_settings (
    id TEXT PRIMARY KEY DEFAULT 'global',
    maintenance_mode BOOLEAN DEFAULT false,
    maintenance_message TEXT DEFAULT 'We are currently performing scheduled maintenance. Please check back soon.',
    announcement_active BOOLEAN DEFAULT false,
    announcement_message TEXT DEFAULT '',
    announcement_type TEXT DEFAULT 'info', -- 'info', 'warning', 'error'
    default_trial_days INTEGER DEFAULT 14,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert the default settings row
INSERT INTO public.platform_settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read platform settings
CREATE POLICY "Public can view platform settings" 
ON public.platform_settings FOR SELECT 
TO public
USING (true);

-- Only System Admins can manage settings
CREATE POLICY "System Admins can manage platform settings" 
ON public.platform_settings FOR ALL 
TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email') OR
    EXISTS (SELECT 1 FROM public.user_permissions WHERE email = auth.jwt() ->> 'email' AND super_admin = true)
)
WITH CHECK (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email') OR
    EXISTS (SELECT 1 FROM public.user_permissions WHERE email = auth.jwt() ->> 'email' AND super_admin = true)
);
