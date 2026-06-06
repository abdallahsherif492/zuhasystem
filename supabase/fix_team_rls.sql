-- Fix Business Users RLS policies to allow Owners/Admins to invite and manage team members

-- Drop existing ones (to avoid conflicts)
DROP POLICY IF EXISTS "Allow users to link themselves to a business" ON public.business_users;
DROP POLICY IF EXISTS "Allow users to view their own links" ON public.business_users;
DROP POLICY IF EXISTS "Users can view business_users in their businesses" ON public.business_users;
DROP POLICY IF EXISTS "Allow inserting business_users" ON public.business_users;
DROP POLICY IF EXISTS "Allow updating business_users" ON public.business_users;
DROP POLICY IF EXISTS "Allow deleting business_users" ON public.business_users;

-- 1. SELECT: Users can see all team members in the businesses they belong to
CREATE POLICY "Users can view business_users in their businesses"
ON public.business_users FOR SELECT
TO authenticated
USING (
    business_id IN (
        SELECT business_id FROM public.business_users WHERE user_email = auth.jwt() ->> 'email'
    )
    OR
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
);

-- 2. INSERT: Owners and Admins can add new team members, OR user can add themselves during signup
CREATE POLICY "Allow inserting business_users"
ON public.business_users FOR INSERT
TO authenticated
WITH CHECK (
    user_email = auth.jwt() ->> 'email'
    OR
    EXISTS (
        SELECT 1 FROM public.business_users bu 
        WHERE bu.business_id = business_users.business_id 
        AND bu.user_email = auth.jwt() ->> 'email' 
        AND bu.role IN ('owner', 'admin', 'super admin', 'platform admin')
    )
    OR
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
);

-- 3. UPDATE: Owners and Admins can update roles/permissions of team members
CREATE POLICY "Allow updating business_users"
ON public.business_users FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.business_users bu 
        WHERE bu.business_id = business_users.business_id 
        AND bu.user_email = auth.jwt() ->> 'email' 
        AND bu.role IN ('owner', 'admin', 'super admin', 'platform admin')
    )
    OR EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
);

-- 4. DELETE: Owners and Admins can delete team members
CREATE POLICY "Allow deleting business_users"
ON public.business_users FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.business_users bu 
        WHERE bu.business_id = business_users.business_id 
        AND bu.user_email = auth.jwt() ->> 'email' 
        AND bu.role IN ('owner', 'admin', 'super admin', 'platform admin')
    )
    OR EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
);
