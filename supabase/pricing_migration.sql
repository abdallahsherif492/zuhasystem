-- ==========================================
-- DYNAMIC PRICING (SUBSCRIPTION PLANS)
-- ==========================================

CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    price_monthly NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    price_yearly NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    currency TEXT DEFAULT 'EGP',
    features JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    is_popular BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- Everyone can read active plans (for the landing page)
CREATE POLICY "Public can view active plans" 
ON public.subscription_plans FOR SELECT 
TO public
USING (is_active = true);

-- System Admins can read all plans (active or inactive)
CREATE POLICY "System Admins can view all plans" 
ON public.subscription_plans FOR SELECT 
TO authenticated
USING (EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email'));

-- System Admins can manage plans
CREATE POLICY "System Admins can manage plans" 
ON public.subscription_plans FOR ALL 
TO authenticated
USING (EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email'));

-- Add plan_id to businesses table
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES public.subscription_plans(id);

-- Insert default Seed Data for the Landing Page
INSERT INTO public.subscription_plans (name, description, price_monthly, price_yearly, is_popular, features)
VALUES 
(
    'Starter',
    'Perfect for new businesses getting started.',
    250.00,
    2500.00,
    false,
    '["Up to 500 products", "Basic analytics", "Standard support", "1 Store location"]'::jsonb
),
(
    'Professional',
    'Everything you need to grow your business.',
    500.00,
    5000.00,
    true,
    '["Unlimited products", "Advanced analytics", "Priority support", "Up to 3 locations", "Staff accounts (5)"]'::jsonb
),
(
    'Enterprise',
    'Advanced features for large scale operations.',
    1200.00,
    12000.00,
    false,
    '["Unlimited everything", "Custom reports", "24/7 Phone support", "Unlimited locations", "Unlimited staff", "API Access"]'::jsonb
);
