-- Migration: an order's courier cost follows the courier it is given
-- Created At: 2026-10-20
-- Requires: 20260822_backfill_courier_cost.sql (canonical_governorate)
--
-- actual_shipping_cost — what the courier charges us — was only ever worked
-- out when an order was created, from the business's default courier at that
-- moment:
--   * store orders (the EasyOrders webhook) got 0 when the business had no
--     default courier with a rate card yet;
--   * orders entered by hand got 65 (Cairo, Giza) or 75 (elsewhere), numbers
--     written into the order screens for when there is no courier;
--   * giving an order its courier afterwards — on the logistics page, marking
--     it Shipped, the shipping sync, sending it to Turbo — changed nothing.
-- So on Layla Home, whose Turbo card (100 Cairo, 105 Qaliubiya, ...) was set
-- up on 19 October, 19 orders on Turbo carry no courier cost and 7 carry the
-- 65/75 placeholders: profit on all of them is overstated, and Actual Returns
-- shows no courier cost. Other businesses have the same gap on fewer orders
-- (SlimFit 9, Zuha 59).
--
-- 1. From now on, whenever an order gets a courier or changes courier, its
--    cost becomes that courier's rate for the order's governorate (profit is
--    a generated column, so it follows by itself). An order edited with an explicit
--    cost in the same update keeps that cost; a courier with no rate for the
--    governorate leaves the order as it is.
-- 2. Orders that already have a courier with a rate, but no cost, get the
--    rate. Flagged as estimated, like the 20260822 backfill.
-- 3. Orders created before their business had any default courier, holding
--    the 65/75 placeholder, get their courier's real rate. On live data that
--    is the 7 Layla Home orders above and nothing else.

-- ===========================================================================
-- 1. The rate on a given courier's card
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.courier_rate_by_company(p_company_id UUID, p_gov TEXT)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    SELECT NULLIF(sc.rates ->> public.canonical_governorate(p_gov), '')::NUMERIC
      FROM public.shipping_companies sc
     WHERE sc.id = p_company_id AND sc.rates IS NOT NULL;
$$;

-- ===========================================================================
-- 2. Keep the cost with the courier
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.orders_courier_cost()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_rate NUMERIC;
BEGIN
    IF NEW.shipping_company_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Whoever set the cost in this same update meant it.
        IF NEW.actual_shipping_cost IS DISTINCT FROM OLD.actual_shipping_cost THEN
            RETURN NEW;
        END IF;
        -- Same courier and a cost already there: nothing to do.
        IF NEW.shipping_company_id IS NOT DISTINCT FROM OLD.shipping_company_id
           AND COALESCE(NEW.actual_shipping_cost, 0) > 0 THEN
            RETURN NEW;
        END IF;
    ELSIF COALESCE(NEW.actual_shipping_cost, 0) > 0 THEN
        -- A new order that arrives with a cost keeps it.
        RETURN NEW;
    END IF;

    v_rate := public.courier_rate_by_company(NEW.shipping_company_id, NEW.customer_info ->> 'governorate');
    IF v_rate IS NULL OR v_rate = COALESCE(NEW.actual_shipping_cost, 0) THEN
        RETURN NEW;
    END IF;

    -- profit is generated from the cost, so it follows by itself.
    NEW.actual_shipping_cost := v_rate;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_orders_courier_cost ON public.orders;
CREATE TRIGGER trg_orders_courier_cost
    BEFORE INSERT OR UPDATE OF shipping_company_id ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.orders_courier_cost();

-- ===========================================================================
-- 3. Orders on a courier with a rate, but no cost
-- ===========================================================================
-- Not Waiting, Cancelled or Unavailable: those never leave, so no fee.
UPDATE public.orders o
   SET actual_shipping_cost    = r.rate,
       shipping_cost_estimated = true
  FROM (SELECT o2.id, public.courier_rate_by_company(o2.shipping_company_id, o2.customer_info ->> 'governorate') AS rate
          FROM public.orders o2
         WHERE o2.shipping_company_id IS NOT NULL
           AND COALESCE(o2.actual_shipping_cost, 0) <= 0
           AND lower(btrim(COALESCE(o2.status, ''))) NOT IN ('waiting', 'cancelled', 'unavailable')) r
 WHERE r.id = o.id
   AND r.rate IS NOT NULL AND r.rate > 0;

-- ===========================================================================
-- 4. The 65/75 placeholder on orders from before any default courier
-- ===========================================================================
UPDATE public.orders o
   SET actual_shipping_cost    = r.rate,
       shipping_cost_estimated = true
  FROM (SELECT o2.id, public.courier_rate_by_company(o2.shipping_company_id, o2.customer_info ->> 'governorate') AS rate
          FROM public.orders o2
         WHERE o2.shipping_company_id IS NOT NULL
           AND o2.actual_shipping_cost = CASE WHEN public.canonical_governorate(o2.customer_info ->> 'governorate') IN ('Cairo', 'Giza')
                                              THEN 65 ELSE 75 END
           AND o2.created_at < (SELECT min(sc.created_at) FROM public.shipping_companies sc
                                 WHERE sc.business_id = o2.business_id AND sc.is_default IS TRUE)) r
 WHERE r.id = o.id
   AND r.rate IS NOT NULL AND r.rate > 0
   AND r.rate <> o.actual_shipping_cost;

-- ===========================================================================
-- Verify
-- ===========================================================================
--   -- Layla Home: every order on Turbo now carries Turbo's rate
--   SELECT o.customer_info->>'governorate', o.actual_shipping_cost, count(*)
--     FROM orders o WHERE o.business_id = 'c2dd1c5e-d4e0-4859-b8d6-7cb124c6e8c4'
--      AND o.shipping_company_id IS NOT NULL GROUP BY 1, 2 ORDER BY 1;
--
-- Rollback (the trigger; the corrected costs are left, they were wrong before):
--   DROP TRIGGER IF EXISTS trg_orders_courier_cost ON public.orders;
--   DROP FUNCTION IF EXISTS public.orders_courier_cost();
--   DROP FUNCTION IF EXISTS public.courier_rate_by_company(UUID, TEXT);
