-- ===========================================================================
-- Moderator targets for the WhatsApp era, and the monthly bonus
-- ===========================================================================
-- Since the company number confirms on its own, a shift is asked for its
-- share of the work only a person can do (src/lib/hr/daily-targets.ts):
--   - calling the orders that need it (no WhatsApp, the confirmation never
--     reached them, or no answer after call_after_hours);
--   - replying to customers on WhatsApp (deduct_whatsapp when missed);
--   - orders from messages and Meta, and courier follow-ups, as before.
-- And a monthly bonus, booked in payroll at the start of the next month for
-- whoever met every target on bonus_days_pct% of their days and whose
-- confirmed orders were delivered at bonus_delivery_rate% or more.
-- Requires 20261113. Safe to run again.

ALTER TABLE public.moderator_target_settings
    ADD COLUMN IF NOT EXISTS call_after_hours    NUMERIC(5,2)  NOT NULL DEFAULT 3  CHECK (call_after_hours > 0),
    ADD COLUMN IF NOT EXISTS deduct_whatsapp     NUMERIC(10,2) NOT NULL DEFAULT 0  CHECK (deduct_whatsapp >= 0),
    ADD COLUMN IF NOT EXISTS bonus_amount        NUMERIC(10,2) NOT NULL DEFAULT 0  CHECK (bonus_amount >= 0),
    ADD COLUMN IF NOT EXISTS bonus_days_pct      NUMERIC(5,2)  NOT NULL DEFAULT 90 CHECK (bonus_days_pct BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS bonus_delivery_rate NUMERIC(5,2)  NOT NULL DEFAULT 82 CHECK (bonus_delivery_rate BETWEEN 0 AND 100);
