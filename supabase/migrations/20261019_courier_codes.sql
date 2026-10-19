-- Migration: the courier's own shipment number on an order
-- Created At: 2026-10-19
-- Requires: nothing new
--
-- Orders can now be sent to a courier from the system (Turbo first). The
-- courier answers with its shipment code — the number on its waybill and the
-- key its status feed is keyed by — so the order keeps it:
--
--   courier_code     the courier's shipment code
--   courier_sent_at  when the order was sent to the courier from here
--
-- An order with a code is not sent twice, and the status sync matches the
-- courier's statuses back to orders by this code.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS courier_code TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS courier_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_courier_code
    ON public.orders (business_id, courier_code)
    WHERE courier_code IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Rollback:
--   DROP INDEX IF EXISTS public.idx_orders_courier_code;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS courier_sent_at;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS courier_code;
