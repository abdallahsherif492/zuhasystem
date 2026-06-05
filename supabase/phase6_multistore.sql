-- Add max_businesses to user_permissions
ALTER TABLE public.user_permissions ADD COLUMN IF NOT EXISTS max_businesses INTEGER DEFAULT 1;

-- Update the handle_new_user trigger to include max_businesses
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_permissions (id, email, super_admin, max_businesses, permissions)
  VALUES (
    new.id, 
    new.email, 
    false,
    1,
    '{"/": true, "/payable": false, "/orders": false, "/inventory": false, "/products": false, "/customers": false, "/logistics": false, "/shipping": false, "/accounting": false, "/purchases": false, "/ads": false, "/insights": false}'::jsonb
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure all existing users have at least 1 max_businesses, and owners with more get bumped up to match
UPDATE public.user_permissions 
SET max_businesses = GREATEST(
  1, 
  COALESCE((SELECT COUNT(*) FROM public.business_users WHERE user_email = email AND role = 'owner'), 1)
)
WHERE max_businesses IS NULL OR max_businesses = 1;

-- Force schema cache reload
NOTIFY pgrst, 'reload schema';
