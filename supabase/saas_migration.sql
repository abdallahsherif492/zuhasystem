-- ==========================================
-- SAAS MULTI-TENANCY MIGRATION SCRIPT
-- ==========================================

-- 1. Create Core SaaS Tables
CREATE TABLE IF NOT EXISTS public.businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    logo_url TEXT,
    theme_config JSONB DEFAULT '{}'::jsonb,
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    subscription_status TEXT DEFAULT 'trial', -- trial, active, pending, expired
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.business_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id UUID, -- Will map to Supabase auth.users.id
    user_email TEXT NOT NULL,
    role TEXT DEFAULT 'Admin', -- Super Admin, Admin, Viewer
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    action_type TEXT NOT NULL, -- CREATE, UPDATE, DELETE
    entity_type TEXT NOT NULL, -- Order, Product, etc.
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Insert Default Data (System Admin & Zuha Business)
INSERT INTO public.system_admins (user_email) VALUES ('abdallahsherif492@gmail.com') ON CONFLICT DO NOTHING;

DO $$
DECLARE
    v_business_id UUID;
    v_count INT;
BEGIN
    SELECT count(*) INTO v_count FROM public.businesses WHERE name = 'Zuha';
    
    IF v_count = 0 THEN
        INSERT INTO public.businesses (name, subscription_status)
        VALUES ('Zuha', 'active')
        RETURNING id INTO v_business_id;

        INSERT INTO public.business_users (business_id, user_email, role)
        VALUES (v_business_id, 'abdallahsherif492@gmail.com', 'Super Admin');
    ELSE
        SELECT id INTO v_business_id FROM public.businesses WHERE name = 'Zuha' LIMIT 1;
    END IF;

    -- 3. Add business_id to all tables and link existing data to Zuha
    -- Using DO block to ignore errors if columns already exist

    BEGIN
        ALTER TABLE public.orders ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE DEFAULT v_business_id;
        ALTER TABLE public.orders ALTER COLUMN business_id DROP DEFAULT;
    EXCEPTION WHEN OTHERS THEN END;

    BEGIN
        ALTER TABLE public.order_items ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE DEFAULT v_business_id;
        ALTER TABLE public.order_items ALTER COLUMN business_id DROP DEFAULT;
    EXCEPTION WHEN OTHERS THEN END;

    BEGIN
        ALTER TABLE public.customers ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE DEFAULT v_business_id;
        ALTER TABLE public.customers ALTER COLUMN business_id DROP DEFAULT;
    EXCEPTION WHEN OTHERS THEN END;

    BEGIN
        ALTER TABLE public.products ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE DEFAULT v_business_id;
        ALTER TABLE public.products ALTER COLUMN business_id DROP DEFAULT;
    EXCEPTION WHEN OTHERS THEN END;

    BEGIN
        ALTER TABLE public.variants ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE DEFAULT v_business_id;
        ALTER TABLE public.variants ALTER COLUMN business_id DROP DEFAULT;
    EXCEPTION WHEN OTHERS THEN END;

    BEGIN
        ALTER TABLE public.transactions ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE DEFAULT v_business_id;
        ALTER TABLE public.transactions ALTER COLUMN business_id DROP DEFAULT;
    EXCEPTION WHEN OTHERS THEN END;

    BEGIN
        ALTER TABLE public.ads_expenses ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE DEFAULT v_business_id;
        ALTER TABLE public.ads_expenses ALTER COLUMN business_id DROP DEFAULT;
    EXCEPTION WHEN OTHERS THEN END;

    BEGIN
        ALTER TABLE public.shipping_companies ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE DEFAULT v_business_id;
        ALTER TABLE public.shipping_companies ALTER COLUMN business_id DROP DEFAULT;
    EXCEPTION WHEN OTHERS THEN END;

    BEGIN
        ALTER TABLE public.suppliers ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE DEFAULT v_business_id;
        ALTER TABLE public.suppliers ALTER COLUMN business_id DROP DEFAULT;
    EXCEPTION WHEN OTHERS THEN END;

    BEGIN
        ALTER TABLE public.supplier_invoices ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE DEFAULT v_business_id;
        ALTER TABLE public.supplier_invoices ALTER COLUMN business_id DROP DEFAULT;
    EXCEPTION WHEN OTHERS THEN END;

END $$;
