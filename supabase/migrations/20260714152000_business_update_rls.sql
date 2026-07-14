-- Create policy to allow authorized roles to update business details
CREATE POLICY "Authorized users can update their businesses"
ON public.businesses
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.business_users
    WHERE business_users.business_id = businesses.id
    AND business_users.user_email = auth.jwt()->>'email'
    AND business_users.role IN ('owner', 'admin', 'Super Admin', 'super admin', 'super_admin', 'platform admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.business_users
    WHERE business_users.business_id = businesses.id
    AND business_users.user_email = auth.jwt()->>'email'
    AND business_users.role IN ('owner', 'admin', 'Super Admin', 'super admin', 'super_admin', 'platform admin')
  )
);
