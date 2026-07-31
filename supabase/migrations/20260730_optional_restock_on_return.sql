-- Migration: let the operator decide whether a return goes back to stock
-- Created At: 2026-07-30
--
-- Requires 20260730_inventory_ledger.sql (the trigger this modifies).
--
-- Marking an order Returned currently always puts its units back on the shelf.
-- That is right when the parcel comes back intact, and wrong when it comes back
-- damaged, short, or never arrives at all — cases where the goods are gone but
-- the order still has to be closed as Returned. Without a choice, staff had to
-- correct the count by hand afterwards, which is exactly the manual adjustment
-- the ledger work was meant to eliminate.
--
-- The flag is on the order rather than a setting, because it is a per-parcel
-- fact, not a policy.

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS restock_on_return BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.orders.restock_on_return IS
    'False when a returned parcel did not physically come back to the shelf (damaged/lost). The stock trigger then leaves the units deducted.';

-- Same trigger as the ledger migration, with one branch added.
CREATE OR REPLACE FUNCTION public.sync_order_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_out BOOLEAN;
    v_was_out    BOOLEAN;
    rec          RECORD;
BEGIN
    v_target_out := public.is_stock_out(NEW.status);
    v_was_out    := CASE WHEN TG_OP = 'INSERT' THEN false
                         ELSE COALESCE(OLD.stock_deducted, false) END;

    IF v_target_out = v_was_out THEN
        NEW.stock_deducted := v_was_out;
        RETURN NEW;
    END IF;

    IF v_target_out THEN
        FOR rec IN
            SELECT variant_id, quantity FROM public.order_items
            WHERE order_id = NEW.id AND variant_id IS NOT NULL
        LOOP
            UPDATE public.variants SET stock_qty = stock_qty - rec.quantity
            WHERE id = rec.variant_id;
            INSERT INTO public.inventory_transactions
                (business_id, variant_id, quantity_change, transaction_type, reference_id, note)
            VALUES (NEW.business_id, rec.variant_id, -rec.quantity, 'sale', NEW.id,
                    'Auto: status → ' || NEW.status);
        END LOOP;
        NEW.stock_deducted := true;
        RETURN NEW;
    END IF;

    -- Coming back into a stock-in status. The operator can say the goods did
    -- not physically return; then nothing moves and the units stay counted as
    -- out, which is the truth — they are gone. stock_deducted therefore stays
    -- true, so the invariant "does this order still hold stock out?" survives
    -- and the reconciliation view keeps balancing.
    IF NOT COALESCE(NEW.restock_on_return, true) THEN
        NEW.stock_deducted := true;
        RETURN NEW;
    END IF;

    FOR rec IN
        SELECT variant_id, quantity FROM public.order_items
        WHERE order_id = NEW.id AND variant_id IS NOT NULL
    LOOP
        UPDATE public.variants SET stock_qty = stock_qty + rec.quantity
        WHERE id = rec.variant_id;
        INSERT INTO public.inventory_transactions
            (business_id, variant_id, quantity_change, transaction_type, reference_id, note)
        VALUES (NEW.business_id, rec.variant_id, rec.quantity, 'return', NEW.id,
                'Auto: status → ' || NEW.status);
    END LOOP;
    NEW.stock_deducted := false;

    RETURN NEW;
END;
$$;

-- Rollback: re-run the function body from 20260730_inventory_ledger.sql and
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS restock_on_return;
