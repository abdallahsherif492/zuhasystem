-- Migration: Set 1-Month Free Trial for new Business Profiles
-- Created At: 2026-07-26

-- 1. Update default values on businesses table
ALTER TABLE public.businesses
  ALTER COLUMN subscription_status SET DEFAULT 'trial';

-- 2. Create Trigger Function to automatically assign 1-Month Free Trial dates upon creation
CREATE OR REPLACE FUNCTION public.set_new_business_free_trial()
RETURNS TRIGGER AS $$
BEGIN
    -- Set default trial status if null
    IF NEW.subscription_status IS NULL THEN
        NEW.subscription_status := 'trial';
    END IF;

    -- Set trial_ends_at to 1 month from creation if null
    IF NEW.trial_ends_at IS NULL THEN
        NEW.trial_ends_at := (COALESCE(NEW.created_at, NOW()) + INTERVAL '1 month');
    END IF;

    -- Set subscription_end_date to 1 month from creation if null
    IF NEW.subscription_end_date IS NULL THEN
        NEW.subscription_end_date := (COALESCE(NEW.created_at, NOW()) + INTERVAL '1 month');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Drop existing trigger if present and attach
DROP TRIGGER IF EXISTS trigger_set_new_business_free_trial ON public.businesses;

CREATE TRIGGER trigger_set_new_business_free_trial
    BEFORE INSERT ON public.businesses
    FOR EACH ROW
    EXECUTE FUNCTION public.set_new_business_free_trial();

-- 4. Backfill existing businesses that don't have subscription_end_date set
UPDATE public.businesses
SET 
    subscription_status = COALESCE(subscription_status, 'trial'),
    subscription_end_date = COALESCE(subscription_end_date, created_at + INTERVAL '1 month', NOW() + INTERVAL '1 month'),
    trial_ends_at = COALESCE(trial_ends_at, created_at + INTERVAL '1 month', NOW() + INTERVAL '1 month')
WHERE subscription_end_date IS NULL OR trial_ends_at IS NULL;
