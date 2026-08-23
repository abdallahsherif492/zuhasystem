-- Migration: fill in the missing courier cost, and mark it as an estimate
-- Created At: 2026-08-22
--
-- actual_shipping_cost is only ever written by the manual create-order and
-- edit-order screens. Orders arriving from EasyOrders — which is most of them
-- — never get one, so the courier's fee is simply absent from the books for
-- them. On live data that is 4,388 collected orders carrying no shipping cost
-- at all, about 336,100 EGP that was really paid and never recorded. Reported
-- profit for 2026 is overstated by roughly that much.
--
-- Backfilling from the current rate card is defensible here, and was checked
-- before being written rather than assumed: across the 3,097 collected orders
-- that DO carry a recorded cost, the default company's rate card matches what
-- was actually paid in every single one, for all fourteen governorates with
-- meaningful volume. Zero disagreements. The card has evidently not moved.
--
-- What it is NOT is a measurement, so it is not passed off as one. Every row
-- this touches is flagged, which keeps three things possible: telling estimate
-- from fact later, correcting them if a real invoice turns up, and undoing the
-- whole thing with one statement.

-- ===========================================================================
-- 1. Keep estimates distinguishable from measurements
-- ===========================================================================
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS shipping_cost_estimated BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.shipping_cost_estimated IS
    'True when actual_shipping_cost was derived from the courier rate card rather than recorded from a real invoice.';

-- ===========================================================================
-- 2. One spelling per governorate
-- ===========================================================================
-- The app has a canonical list (the platform-orders dropdown and the rate card
-- agree: Sharkia, Gharbiya, Qaliubiya, Kafr Al Sheikh, Assiut, Fayoum). The
-- EasyOrders webhook translates Arabic into a DIFFERENT set — Al Sharqia,
-- Gharbia, Qalyubia, Kafr El Sheikh, Asyut, Faiyum — so those orders match no
-- rate card entry and cannot be filtered by governorate either. 190 orders are
-- sitting on the wrong spelling.
CREATE OR REPLACE FUNCTION public.canonical_governorate(p_gov TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE btrim(coalesce(p_gov, ''))
        WHEN 'Al Sharqia'     THEN 'Sharkia'
        WHEN 'Gharbia'        THEN 'Gharbiya'
        WHEN 'Qalyubia'       THEN 'Qaliubiya'
        WHEN 'Kafr El Sheikh' THEN 'Kafr Al Sheikh'
        WHEN 'Asyut'          THEN 'Assiut'
        WHEN 'Faiyum'         THEN 'Fayoum'
        WHEN 'بور سعيد'       THEN 'Port Said'
        WHEN 'القاهره'        THEN 'Cairo'
        WHEN 'القاهرة'        THEN 'Cairo'
        -- Hurghada is a city; its governorate is Red Sea.
        WHEN 'الغردقة'        THEN 'Red Sea'
        ELSE btrim(coalesce(p_gov, ''))
    END;
$$;

-- Rewrite the stored value so the governorate filter and the rate lookup both
-- work from here on. Narrow by design: only the exact aliases above change.
UPDATE public.orders o
SET customer_info = jsonb_set(
        o.customer_info,
        '{governorate}',
        to_jsonb(public.canonical_governorate(o.customer_info ->> 'governorate'))
    )
WHERE o.customer_info ? 'governorate'
  AND public.canonical_governorate(o.customer_info ->> 'governorate')
      IS DISTINCT FROM (o.customer_info ->> 'governorate');

-- ===========================================================================
-- 3. Look up a rate
-- ===========================================================================
-- Reads the business's default courier's card. Returns NULL rather than a
-- guess when there is no entry — a made-up number is worse than a visible gap.
CREATE OR REPLACE FUNCTION public.courier_rate_for(p_business_id UUID, p_gov TEXT)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    SELECT NULLIF(sc.rates ->> public.canonical_governorate(p_gov), '')::NUMERIC
    FROM public.shipping_companies sc
    WHERE sc.business_id = p_business_id
      AND sc.is_default IS TRUE
      AND sc.rates IS NOT NULL
    LIMIT 1;
$$;

-- ===========================================================================
-- 4. Backfill
-- ===========================================================================
-- Only orders the courier actually collected. Pending, Waiting, Processing,
-- Prepared and Cancelled never left the building, so there is no fee to book —
-- filling those would invent a cost that was never incurred.
UPDATE public.orders o
SET actual_shipping_cost   = public.courier_rate_for(o.business_id, o.customer_info ->> 'governorate'),
    shipping_cost_estimated = true
WHERE COALESCE(o.actual_shipping_cost, 0) <= 0
  AND lower(btrim(coalesce(o.status, ''))) IN
      ('shipped', 'delivered', 'collected', 'returning', 'hold to redeliver', 'returned')
  AND public.courier_rate_for(o.business_id, o.customer_info ->> 'governorate') IS NOT NULL;

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT shipping_cost_estimated, count(*), sum(actual_shipping_cost)
--     FROM orders WHERE actual_shipping_cost > 0 GROUP BY 1;
--
--   -- collected orders still with no cost (blank or unknown governorate):
--   SELECT customer_info->>'governorate', count(*) FROM orders
--    WHERE status = 'Collected' AND COALESCE(actual_shipping_cost,0) <= 0
--    GROUP BY 1 ORDER BY 2 DESC;

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- UPDATE public.orders
--    SET actual_shipping_cost = NULL, shipping_cost_estimated = false
--  WHERE shipping_cost_estimated;
-- -- The governorate spellings are deliberately NOT rolled back: they were
-- -- wrong before and correcting them is not part of the estimate.
