-- ==========================================
-- SUBSCRIPTION AUTOMATION & AUTO-RENEW
-- ==========================================

-- 1. Enable pg_cron extension (Must be run by a superuser)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Add Auto-Renew columns to businesses
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS auto_renew_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS auto_renew_package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL;

-- 3. Create Stored Procedure for Processing Renewals
CREATE OR REPLACE FUNCTION public.process_auto_renewals()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_business RECORD;
    v_package RECORD;
    v_new_end_date TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Find businesses that need renewal (expires in less than 24 hours or already expired)
    -- AND have auto-renew enabled AND a package selected
    FOR v_business IN 
        SELECT b.id, b.wallet_balance, b.subscription_end_date, b.auto_renew_package_id 
        FROM public.businesses b
        WHERE b.auto_renew_enabled = true 
          AND b.auto_renew_package_id IS NOT NULL
          AND (b.subscription_end_date IS NULL OR b.subscription_end_date <= NOW() + INTERVAL '1 day')
    LOOP
        -- Get the package details
        SELECT * INTO v_package FROM public.packages WHERE id = v_business.auto_renew_package_id AND is_active = true;
        
        -- If package exists and business has enough balance
        IF FOUND AND v_business.wallet_balance >= v_package.price THEN
            
            -- Calculate new end date (extend from current end date if active, or from now if expired)
            IF v_business.subscription_end_date IS NOT NULL AND v_business.subscription_end_date > NOW() THEN
                v_new_end_date := v_business.subscription_end_date + (v_package.duration_months || ' months')::interval;
            ELSE
                v_new_end_date := NOW() + (v_package.duration_months || ' months')::interval;
            END IF;

            -- 1. Deduct balance and update subscription date
            UPDATE public.businesses 
            SET 
                wallet_balance = wallet_balance - v_package.price,
                subscription_end_date = v_new_end_date,
                subscription_status = 'active'
            WHERE id = v_business.id;

            -- 2. Record the transaction in system ledger (revenue_transactions)
            INSERT INTO public.revenue_transactions (
                business_id, 
                amount, 
                type, 
                description,
                category,
                status
            ) VALUES (
                v_business.id,
                v_package.price,
                'package_purchase',
                'Auto-renewal: ' || v_package.name,
                'Subscription',
                'paid'
            );

        END IF;
    END LOOP;
END;
$$;

-- 4. Schedule the cron job to run every hour
-- Unschedule if exists first to avoid duplicates
SELECT cron.unschedule('process_auto_renewals_job');

SELECT cron.schedule(
    'process_auto_renewals_job',
    '0 * * * *', -- Run every hour at minute 0
    'SELECT public.process_auto_renewals();'
);
