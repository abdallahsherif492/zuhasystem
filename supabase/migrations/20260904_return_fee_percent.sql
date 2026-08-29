-- Migration: a return costs a share of the shipping, not a flat fee
-- Created At: 2026-09-04
--
-- shipping_companies.return_fee assumed a courier charges one fixed amount for
-- bringing a parcel back. Telegraf's own account statement says otherwise. Over
-- 764 returns it charged 48,035 EGP, and against the outbound rate for the same
-- parcel the ratio is not scattered — it is 0.80, median and mean alike:
--
--   0.8 -> 360 returns    0.9 -> 213    0.7 -> 128    0.6 -> 36
--
-- A flat number cannot express that. A return to Aswan costs more to bring back
-- than one from Nasr City, for the same reason the delivery did. So a percent
-- of the parcel's own shipping cost is added, and the two are additive: a
-- courier that charges a fixed handling fee plus a share of the freight can say
-- so, and one that charges only one of them leaves the other at zero.
--
-- Nothing changes until a value is entered. Every courier is at zero on both
-- fields today, which is why returns currently contribute nothing to what a
-- courier owes — and why the settlement screen said Telegraf owed 210,642 when
-- their own statement said 80,647. Return fees were 57,369 of that gap.

ALTER TABLE public.shipping_companies
    ADD COLUMN IF NOT EXISTS return_fee_percent NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.shipping_companies.return_fee_percent IS
    'Share of the parcel''s own shipping cost the courier charges to bring it '
    'back, as a percentage. Added to return_fee. Telegraf measured at 80.';

COMMENT ON COLUMN public.shipping_companies.return_fee IS
    'Flat amount charged per return, on top of return_fee_percent.';

-- The payout definition, with the return side widened. Everything else is
-- unchanged — this view is what every settlement screen reads, so it is
-- restated in full rather than patched.
CREATE OR REPLACE VIEW public.v_courier_payouts AS
SELECT
    o.id                AS order_id,
    o.business_id,
    o.shipping_company_id,
    sc.name             AS company_name,
    o.status,
    o.created_at,
    o.settlement_id,
    o.customer_info,
    o.total_amount,
    o.paid_amount,
    o.actual_shipping_cost,
    GREATEST(COALESCE(o.total_amount,0) - COALESCE(o.paid_amount,0), 0) AS collected_amount,
    CASE
        WHEN public.is_cod_collected(o.status) THEN
            ROUND(
                GREATEST(COALESCE(o.total_amount,0) - COALESCE(o.paid_amount,0), 0)
                - COALESCE(o.actual_shipping_cost,0)
                - (GREATEST(COALESCE(o.total_amount,0) - COALESCE(o.paid_amount,0), 0)
                   * COALESCE(sc.cod_fee_percent,0) / 100.0)
            , 2)
        WHEN public.is_cod_returned(o.status) THEN
            -- Flat fee plus a share of what the outbound leg cost. Both default
            -- to zero, so a courier that charges neither still nets nothing.
            -ROUND(
                COALESCE(sc.return_fee,0)
                + COALESCE(o.actual_shipping_cost,0)
                  * COALESCE(sc.return_fee_percent,0) / 100.0
            , 2)
        ELSE 0
    END AS expected_payout
FROM public.orders o
JOIN public.shipping_companies sc ON sc.id = o.shipping_company_id
WHERE o.shipping_company_id IS NOT NULL
  AND (public.is_cod_collected(o.status) OR public.is_cod_returned(o.status));

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- Verify
-- ===========================================================================
--   UPDATE shipping_companies SET return_fee_percent = 80 WHERE name = 'Telegraf';
--
--   SELECT sum(expected_payout) FROM v_courier_payouts
--    WHERE company_name = 'Telegraf' AND status = 'Returned';
--   -- about -65,000 against the 1,041 returns the system holds for Telegraf;
--   -- the statement's own figure over its 765 lines is -48,035, the difference
--   -- being the returns from before the statement's window.
--
--   -- And the number that matters: what the settlement screen then says
--   -- Telegraf owes should fall by roughly that amount.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- ALTER TABLE public.shipping_companies DROP COLUMN IF EXISTS return_fee_percent;
-- (and re-run 20260730_cod_settlements.sql to restore the view)
