-- ==========================================
-- SYSTEM ADMIN ACCOUNTING & BILLING
-- ==========================================

-- 1. Extend Platform Settings for InstaPay Details
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS instapay_number TEXT DEFAULT '';
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS instapay_name TEXT DEFAULT '';

-- 2. Create Platform Transactions Table
CREATE TABLE IF NOT EXISTS public.platform_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('expense', 'revenue')),
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'paid', -- 'pending', 'approved', 'rejected', 'paid'
    category TEXT NOT NULL, 
    business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
    plan_id UUID REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
    proof_url TEXT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Enable RLS
ALTER TABLE public.platform_transactions ENABLE ROW LEVEL SECURITY;

-- Tenants can insert revenue (payment requests) for their own business
CREATE POLICY "Tenants can submit payment requests" 
ON public.platform_transactions FOR INSERT 
TO authenticated
WITH CHECK (
    type = 'revenue' 
    AND status = 'pending'
    AND business_id IN (
        SELECT business_id FROM public.business_users WHERE user_email = auth.jwt() ->> 'email'
    )
);

-- Tenants can view their own payment requests
CREATE POLICY "Tenants can view their payment requests" 
ON public.platform_transactions FOR SELECT 
TO authenticated
USING (
    business_id IN (
        SELECT business_id FROM public.business_users WHERE user_email = auth.jwt() ->> 'email'
    )
);

-- System Admins can do anything
CREATE POLICY "System Admins can manage all transactions" 
ON public.platform_transactions FOR ALL 
TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email') OR
    EXISTS (SELECT 1 FROM public.user_permissions WHERE email = auth.jwt() ->> 'email' AND super_admin = true)
)
WITH CHECK (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email') OR
    EXISTS (SELECT 1 FROM public.user_permissions WHERE email = auth.jwt() ->> 'email' AND super_admin = true)
);

-- 4. Storage Bucket for Payment Proofs
-- Create bucket if it doesn't exist (assuming postgres role has permissions, usually done via Supabase dashboard but let's try SQL)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('payment_proofs', 'payment_proofs', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS (Only authenticated can insert)
CREATE POLICY "Authenticated users can upload proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'payment_proofs');

CREATE POLICY "Anyone can view proofs"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'payment_proofs');
