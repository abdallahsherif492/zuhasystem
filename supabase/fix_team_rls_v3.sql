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
        AND LOWER(TRIM(role)) IN ('owner', 'admin', 'platform admin', 'super admin')
    );
$$;
