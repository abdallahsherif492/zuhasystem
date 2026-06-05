DO $$
DECLARE
    v_business_id UUID;
BEGIN
    -- Get the first business ID as a fallback for existing data
    SELECT id INTO v_business_id FROM public.businesses ORDER BY created_at ASC LIMIT 1;

    -- Add to orders
    BEGIN
        ALTER TABLE public.orders ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
        IF v_business_id IS NOT NULL THEN
            UPDATE public.orders SET business_id = v_business_id WHERE business_id IS NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN 
        RAISE NOTICE 'Error adding business_id to orders: %', SQLERRM;
    END;

    -- Add to order_items
    BEGIN
        ALTER TABLE public.order_items ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
        IF v_business_id IS NOT NULL THEN
            UPDATE public.order_items SET business_id = v_business_id WHERE business_id IS NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN 
        RAISE NOTICE 'Error adding business_id to order_items: %', SQLERRM;
    END;

    -- Add to customers
    BEGIN
        ALTER TABLE public.customers ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
        IF v_business_id IS NOT NULL THEN
            UPDATE public.customers SET business_id = v_business_id WHERE business_id IS NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN 
        RAISE NOTICE 'Error adding business_id to customers: %', SQLERRM;
    END;

    -- Add to products
    BEGIN
        ALTER TABLE public.products ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
        IF v_business_id IS NOT NULL THEN
            UPDATE public.products SET business_id = v_business_id WHERE business_id IS NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN 
        RAISE NOTICE 'Error adding business_id to products: %', SQLERRM;
    END;

    -- Add to variants
    BEGIN
        ALTER TABLE public.variants ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
        IF v_business_id IS NOT NULL THEN
            UPDATE public.variants SET business_id = v_business_id WHERE business_id IS NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN 
        RAISE NOTICE 'Error adding business_id to variants: %', SQLERRM;
    END;

    -- Add to transactions
    BEGIN
        ALTER TABLE public.transactions ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
        IF v_business_id IS NOT NULL THEN
            UPDATE public.transactions SET business_id = v_business_id WHERE business_id IS NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN 
        RAISE NOTICE 'Error adding business_id to transactions: %', SQLERRM;
    END;

    -- Add to ads_expenses
    BEGIN
        ALTER TABLE public.ads_expenses ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
        IF v_business_id IS NOT NULL THEN
            UPDATE public.ads_expenses SET business_id = v_business_id WHERE business_id IS NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN 
        RAISE NOTICE 'Error adding business_id to ads_expenses: %', SQLERRM;
    END;

    -- Add to shipping_companies
    BEGIN
        ALTER TABLE public.shipping_companies ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
        IF v_business_id IS NOT NULL THEN
            UPDATE public.shipping_companies SET business_id = v_business_id WHERE business_id IS NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN 
        RAISE NOTICE 'Error adding business_id to shipping_companies: %', SQLERRM;
    END;

    -- Add to suppliers
    BEGIN
        ALTER TABLE public.suppliers ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
        IF v_business_id IS NOT NULL THEN
            UPDATE public.suppliers SET business_id = v_business_id WHERE business_id IS NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN 
        RAISE NOTICE 'Error adding business_id to suppliers: %', SQLERRM;
    END;

    -- Add to supplier_invoices
    BEGIN
        ALTER TABLE public.supplier_invoices ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
        IF v_business_id IS NOT NULL THEN
            UPDATE public.supplier_invoices SET business_id = v_business_id WHERE business_id IS NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN 
        RAISE NOTICE 'Error adding business_id to supplier_invoices: %', SQLERRM;
    END;

END $$;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
