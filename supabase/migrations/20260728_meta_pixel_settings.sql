-- Migration: Meta Pixel integration settings + 30-day default trial
-- Created At: 2026-07-28

-- 1. Meta Pixel configuration on the global platform settings row.
--    `meta_pixel_enabled` is the master switch: the pixel never loads while it
--    is false, regardless of whether an ID is stored.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS meta_pixel_enabled BOOLEAN DEFAULT false;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS meta_pixel_id TEXT DEFAULT '';

-- 2. The free trial is one month (see set_new_business_free_trial trigger),
--    so align the advertised/default trial length with it.
ALTER TABLE public.platform_settings
  ALTER COLUMN default_trial_days SET DEFAULT 30;

UPDATE public.platform_settings
SET default_trial_days = 30
WHERE id = 'global' AND (default_trial_days IS NULL OR default_trial_days = 14);

-- Note: the existing "Public can view platform settings" SELECT policy already
-- lets anonymous visitors on /landing and /register read these columns, which
-- is what the client-side pixel loader needs. Writes stay restricted to
-- System Admins via the existing management policy.
