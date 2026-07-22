-- ==========================================
-- BILLING & SUBSCRIPTIONS SYSTEM
-- ==========================================

-- 1. Create Packages Table
CREATE TABLE IF NOT EXISTS public.packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    duration_months INTEGER NOT NULL,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active packages" 
ON public.packages FOR SELECT 
TO public
USING (is_active = true);

CREATE POLICY "System Admins can manage packages" 
ON public.packages FOR ALL 
TO authenticated
USING (EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email'));

-- Insert some default packages
INSERT INTO public.packages (name, duration_months, price)
VALUES 
('1 Month Subscription', 1, 300.00),
('3 Months Subscription', 3, 800.00),
('1 Year Subscription', 12, 3000.00)
ON CONFLICT DO NOTHING;


-- 2. Modify Businesses Table
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12, 2) DEFAULT 0.00;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS active_package_id UUID REFERENCES public.packages(id);


-- 3. Payment Requests Table
CREATE TABLE IF NOT EXISTS public.payment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL,
    payment_method TEXT NOT NULL, -- 'instapay', 'e-wallet'
    sender_details TEXT NOT NULL,
    receipt_url TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

-- Business owners can view and insert their own requests
CREATE POLICY "Businesses can view their own payment requests" 
ON public.payment_requests FOR SELECT 
TO authenticated
USING (business_id IN (
    SELECT business_id FROM public.business_users WHERE user_id = auth.uid()
));

CREATE POLICY "Businesses can insert payment requests" 
ON public.payment_requests FOR INSERT 
TO authenticated
WITH CHECK (business_id IN (
    SELECT business_id FROM public.business_users WHERE user_id = auth.uid()
));

-- System Admins can manage payment requests
CREATE POLICY "System Admins can manage payment requests" 
ON public.payment_requests FOR ALL 
TO authenticated
USING (EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email'));


-- 4. Revenue Transactions Table (Accounting)
CREATE TABLE IF NOT EXISTS public.revenue_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
    payment_request_id UUID REFERENCES public.payment_requests(id) ON DELETE SET NULL,
    amount NUMERIC(10, 2) NOT NULL,
    type TEXT DEFAULT 'wallet_topup', -- 'wallet_topup', 'package_purchase', etc.
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.revenue_transactions ENABLE ROW LEVEL SECURITY;

-- Only System Admins can view and manage revenue transactions
CREATE POLICY "System Admins can view revenue transactions" 
ON public.revenue_transactions FOR SELECT 
TO authenticated
USING (EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email'));

CREATE POLICY "System Admins can insert revenue transactions" 
ON public.revenue_transactions FOR INSERT 
TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email'));


-- 5. Create storage bucket for receipts
INSERT INTO storage.buckets (id, name, public) VALUES ('payment_receipts', 'payment_receipts', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to payment_receipts bucket
CREATE POLICY "Allow authenticated uploads to payment_receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'payment_receipts');

CREATE POLICY "Allow public reads for payment_receipts"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'payment_receipts');
