-- RBAC User Permissions Schema

CREATE TABLE IF NOT EXISTS public.user_permissions (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    super_admin BOOLEAN DEFAULT FALSE,
    permissions JSONB DEFAULT '{"/": true, "/payable": false, "/orders": false, "/inventory": false, "/products": false, "/customers": false, "/logistics": false, "/shipping": false, "/accounting": false, "/purchases": false, "/ads": false, "/insights": false}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own permissions
DROP POLICY IF EXISTS "Users can view own permissions" ON public.user_permissions;
CREATE POLICY "Users can view own permissions"
ON public.user_permissions
FOR SELECT
USING (id = auth.uid());

-- Helper function to check super admin status securely without triggering RLS loops
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_permissions 
    WHERE id = auth.uid() AND super_admin = true
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Policy: Super admins can do anything (Uses the function to avoid infinite recursion)
DROP POLICY IF EXISTS "Super admins can manage permissions" ON public.user_permissions;
CREATE POLICY "Super admins can manage permissions"
ON public.user_permissions
FOR ALL
USING (public.is_super_admin());

-- Trigger to auto-create permission row when new user signs up in auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_permissions (id, email, super_admin, permissions)
  VALUES (
    new.id, 
    new.email, 
    false,
    '{"/": true, "/payable": false, "/orders": false, "/inventory": false, "/products": false, "/customers": false, "/logistics": false, "/shipping": false, "/accounting": false, "/purchases": false, "/ads": false, "/insights": false}'::jsonb
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if trigger exists before dropping/creating
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ==========================================
-- BACKFILL EXISTING USERS
-- ==========================================
-- This inserts existing users into the table so they aren't locked out of the dashboard permanently.
INSERT INTO public.user_permissions (id, email, super_admin, permissions)
SELECT id, email, false, '{"/": true, "/payable": false, "/orders": false, "/inventory": false, "/products": false, "/customers": false, "/logistics": false, "/shipping": false, "/accounting": false, "/purchases": false, "/ads": false, "/insights": false}'::jsonb
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ==========================================
-- SUPER ADMIN SETUP
-- ==========================================
-- IMPORTANT: To make YOURSELF the super admin, you MUST edit the email below and run this update.
-- Replace 'Abdallah.sherif@example.com' with your actual login email.
UPDATE public.user_permissions 
SET super_admin = true,
    permissions = '{"/": true, "/payable": true, "/orders": true, "/inventory": true, "/products": true, "/customers": true, "/logistics": true, "/shipping": true, "/accounting": true, "/purchases": true, "/ads": true, "/insights": true}'::jsonb
WHERE email = 'YOUR_EMAIL@HERE.COM';
