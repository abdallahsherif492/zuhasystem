-- Migration: more ways a shipping follow-up call can end
-- Created At: 2026-10-07
-- Requires: 20260825_shipping_issues.sql
--
-- The shipping issues page now sorts orders by how far following them up has
-- got — nobody has called, the last call did not reach the customer, the
-- customer was reached — and a call that did not get through must say why.
-- "No answer", "phone off", "wrong number" and "other" were the only reasons;
-- these are the others moderators actually write in the note:
--
--   call_later        asked to be called at another time
--   whatsapp_pending  sent a WhatsApp, waiting for the reply
--   customer_away     travelling / not there right now
--   address_issue     the address is wrong or incomplete
--
-- Existing outcomes are unchanged.

ALTER TABLE public.shipping_followups DROP CONSTRAINT IF EXISTS shipping_followups_outcome_check;
ALTER TABLE public.shipping_followups ADD CONSTRAINT shipping_followups_outcome_check CHECK (outcome IN (
    'reached_rescheduled', 'reached_confirmed', 'courier_contacted',
    'no_answer', 'phone_off', 'wrong_number', 'customer_refused',
    'call_later', 'whatsapp_pending', 'customer_away', 'address_issue',
    'other'));

-- Rollback (only once no row uses the new outcomes):
--   ALTER TABLE public.shipping_followups DROP CONSTRAINT shipping_followups_outcome_check;
--   ALTER TABLE public.shipping_followups ADD CONSTRAINT shipping_followups_outcome_check CHECK (outcome IN (
--       'reached_rescheduled','reached_confirmed','no_answer','phone_off','wrong_number',
--       'customer_refused','courier_contacted','other'));
