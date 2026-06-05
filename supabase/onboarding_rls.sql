-- ==========================================
-- SAAS RLS POLICIES FOR ONBOARDING
-- ==========================================

-- Enable RLS
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid errors if run multiple times)
DROP POLICY IF EXISTS "Allow authenticated users to create businesses" ON public.businesses;
DROP POLICY IF EXISTS "Allow users to view their own businesses" ON public.businesses;
DROP POLICY IF EXISTS "Allow users to link themselves to a business" ON public.business_users;
DROP POLICY IF EXISTS "Allow users to view their own links" ON public.business_users;

-- 1. Businesses Table Policies
-- Any authenticated user can create a business
CREATE POLICY "Allow authenticated users to create businesses" 
ON public.businesses FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- A user can see a business if they are linked to it in business_users
CREATE POLICY "Allow users to view their own businesses" 
ON public.businesses FOR SELECT 
TO authenticated 
USING (
    id IN (
        SELECT business_id 
        FROM public.business_users 
        WHERE user_email = auth.jwt() ->> 'email'
    )
    OR 
    EXISTS (
        SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email'
    )
);

-- 2. Business Users Table Policies
-- Any authenticated user can insert a record linking THEMSELVES to a business
CREATE POLICY "Allow users to link themselves to a business" 
ON public.business_users FOR INSERT 
TO authenticated 
WITH CHECK (
    user_email = auth.jwt() ->> 'email'
);

-- Users can see business_users records for businesses they belong to
CREATE POLICY "Allow users to view their own links" 
ON public.business_users FOR SELECT 
TO authenticated 
USING (
    user_email = auth.jwt() ->> 'email'
    OR
    EXISTS (
        SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email'
    )
);
