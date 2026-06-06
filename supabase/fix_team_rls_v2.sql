-- Fix Infinite Recursion in Business Users RLS

-- 1. Create a security definer function to securely get the user's business IDs without triggering RLS loops
CREATE OR REPLACE FUNCTION public.get_my_business_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT business_id FROM business_users WHERE user_email = auth.jwt() ->> 'email';
$$;

-- 2. Drop the recursive policies
DROP POLICY IF EXISTS "Allow users to link themselves to a business" ON public.business_users;
DROP POLICY IF EXISTS "Allow users to view their own links" ON public.business_users;
DROP POLICY IF EXISTS "Users can view business_users in their businesses" ON public.business_users;
DROP POLICY IF EXISTS "Allow inserting business_users" ON public.business_users;
DROP POLICY IF EXISTS "Allow updating business_users" ON public.business_users;
DROP POLICY IF EXISTS "Allow deleting business_users" ON public.business_users;

-- 3. Recreate policies using the safe function

-- SELECT: Users can see all team members in the businesses they belong to
CREATE POLICY "Users can view business_users in their businesses"
ON public.business_users FOR SELECT
TO authenticated
USING (
    business_id IN (SELECT public.get_my_business_ids())
    OR
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
);

-- INSERT: Owners and Admins can add new team members, OR user can add themselves during signup
CREATE POLICY "Allow inserting business_users"
ON public.business_users FOR INSERT
TO authenticated
WITH CHECK (
    user_email = auth.jwt() ->> 'email'
    OR
    (
        business_id IN (SELECT public.get_my_business_ids())
        -- Assuming application logic prevents staff from inviting, but we can rely on RLS allowing insertion if they belong to it, or we can restrict it more strictly:
    )
    OR
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
);

-- To perfectly restrict INSERT/UPDATE/DELETE to ONLY owners/admins without recursion:
CREATE OR REPLACE FUNCTION public.am_i_admin_of_business(b_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM business_users 
        WHERE business_id = b_id 
        AND user_email = auth.jwt() ->> 'email' 
        AND role IN ('owner', 'admin', 'platform admin', 'super admin')
    );
$$;

-- Refine INSERT policy:
DROP POLICY IF EXISTS "Allow inserting business_users" ON public.business_users;
CREATE POLICY "Allow inserting business_users"
ON public.business_users FOR INSERT
TO authenticated
WITH CHECK (
    user_email = auth.jwt() ->> 'email'
    OR public.am_i_admin_of_business(business_id)
    OR EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
);

-- UPDATE
CREATE POLICY "Allow updating business_users"
ON public.business_users FOR UPDATE
TO authenticated
USING (
    public.am_i_admin_of_business(business_id)
    OR EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
);

-- DELETE
CREATE POLICY "Allow deleting business_users"
ON public.business_users FOR DELETE
TO authenticated
USING (
    public.am_i_admin_of_business(business_id)
    OR EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
);

