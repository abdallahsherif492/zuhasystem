-- Migration: make the database the single owner of stock movements
-- Created At: 2026-07-30
--
-- Stock (variants.stock_qty) was mutated from six different places in app code,
-- each inferring from an order's status transition whether to deduct or restock.
-- Any status change through a path that skipped the logic — the courier sync,
-- the CSV importer, a bulk action with the wrong status set — desynced stock
-- permanently and invisibly. Measured drift: 84 of 86 tracked variants, ~10.5k
-- units. The audit ledger that should have caught it had been silently failing
-- since May (an insert referencing a business_id column that did not exist).
--
-- Fix: one trigger on orders.status owns every movement, keyed off an explicit
-- orders.stock_deducted flag so it is idempotent and self-healing rather than
-- inferred per transition. The same trigger writes the ledger, so the log can
-- never again disagree with the counter. All the app-level stock code is
-- removed in the same change.

-- ===========================================================================
-- 1. Repair the ledger schema
-- ===========================================================================
ALTER TABLE public.inventory_transactions
    ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- Backfill the tenant from the variant's product. Every existing row is
-- recoverable this way.
UPDATE public.inventory_transactions t
SET business_id = p.business_id
FROM public.variants v
JOIN public.products p ON p.id = v.product_id
WHERE t.variant_id = v.id
  AND t.business_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_business ON public.inventory_transactions(business_id);

-- ===========================================================================
-- 2. The deducted flag
-- ===========================================================================
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS stock_deducted BOOLEAN NOT NULL DEFAULT false;

-- Which statuses mean the goods have left the shelf. Kept as one function so
-- app code and triggers can never define the set differently.
--   OUT  : Prepared, Shipped, Delivered, Collected, Hold To redeliver, Returning
--   IN   : everything else, incl. Waiting, Pending, Processing, Returned,
--          Cancelled, Unavailable
-- Returning stays OUT on purpose: it is in-transit, the courier usually retries
-- back to Shipped, and stock only physically returns on Returned.
CREATE OR REPLACE FUNCTION public.is_stock_out(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(btrim(coalesce(p_status, ''))) IN (
        'prepared', 'shipped', 'delivered', 'collected',
        'hold to redeliver', 'returning'
    );
$$;

-- Align the flag with reality so the trigger does not re-fire on the first
-- future transition. Existing stock_qty already reflects history.
UPDATE public.orders SET stock_deducted = public.is_stock_out(status);

-- ===========================================================================
-- 3. Opening balance: freeze today's numbers so ledger == counter
-- ===========================================================================
-- One balancing entry per variant equal to (current stock) minus (sum of all
-- existing ledger rows). This preserves the historical rows AND makes the
-- reconciliation view read zero everywhere from day one. It deliberately does
-- not correct today's levels — a physical recount later fixes those — it stops
-- new drift and makes any future gap a real, visible bug.
INSERT INTO public.inventory_transactions
    (business_id, variant_id, quantity_change, transaction_type, reference_id, note)
SELECT
    COALESCE(v.business_id, p.business_id),
    v.id,
    v.stock_qty - COALESCE(l.total, 0),
    'opening_balance',
    NULL,
    'Baseline set on migration; freezes current stock so the ledger reconciles.'
FROM public.variants v
JOIN public.products p ON p.id = v.product_id
LEFT JOIN (
    SELECT variant_id, SUM(quantity_change) AS total
    FROM public.inventory_transactions
    GROUP BY variant_id
) l ON l.variant_id = v.id
WHERE v.stock_qty - COALESCE(l.total, 0) <> 0;

-- ===========================================================================
-- 4. The one trigger that owns order-driven stock movement
-- ===========================================================================
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

    -- No change in whether stock is out → nothing to move.
    IF v_target_out = v_was_out THEN
        NEW.stock_deducted := v_was_out;
        RETURN NEW;
    END IF;

    IF v_target_out THEN
        -- Goods leaving the shelf: deduct every mapped line.
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
    ELSE
        -- Goods physically back on the shelf: restock every mapped line.
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
    END IF;

    RETURN NEW;
END;
$$;

-- Note on ordering: orders already carries trg_block_unmapped_leaving_waiting,
-- also BEFORE UPDATE OF status. PostgreSQL fires same-event BEFORE triggers in
-- alphabetical order, so "block..." runs before "sync...", i.e. an unmapped
-- order is rejected before any stock is touched. Either order would in fact be
-- safe — both run inside one transaction, so a raised exception rolls the stock
-- change back — but this way nothing is attempted needlessly.
DROP TRIGGER IF EXISTS trg_sync_order_stock ON public.orders;
CREATE TRIGGER trg_sync_order_stock
    BEFORE INSERT OR UPDATE OF status ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.sync_order_stock();

-- ===========================================================================
-- 5. Item-level edits on an already-deducted order
-- ===========================================================================
-- Adding, removing or re-quantifying a line on an order whose stock is already
-- out must adjust the counter by the delta only. Acts solely on real deltas, so
-- re-saving an unchanged order (the edit RPC re-upserts every line) is a no-op.
--
-- Composition with the status trigger is intentional and correct. Changing an
-- order to Shipped while also raising a line from 2 to 5 runs as: status trigger
-- deducts the 2 currently on the row, then this trigger deducts the delta of 3
-- — five in total, once.
--
-- Known gap, deliberately not handled: deleting an order whose stock is out
-- would cascade-delete its lines after the parent row is gone, so the lookup
-- below finds nothing and no restock happens. The app never deletes orders (they
-- are cancelled, which is a status change and handled above), so this cannot be
-- reached today.
CREATE OR REPLACE FUNCTION public.sync_order_item_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deducted BOOLEAN;
    v_biz      UUID;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT stock_deducted, business_id INTO v_deducted, v_biz
        FROM public.orders WHERE id = NEW.order_id;
        IF COALESCE(v_deducted, false) AND NEW.variant_id IS NOT NULL THEN
            UPDATE public.variants SET stock_qty = stock_qty - NEW.quantity WHERE id = NEW.variant_id;
            INSERT INTO public.inventory_transactions
                (business_id, variant_id, quantity_change, transaction_type, reference_id, note)
            VALUES (v_biz, NEW.variant_id, -NEW.quantity, 'sale', NEW.order_id,
                    'Auto: line added to shipped order');
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        SELECT stock_deducted, business_id INTO v_deducted, v_biz
        FROM public.orders WHERE id = OLD.order_id;
        IF COALESCE(v_deducted, false) AND OLD.variant_id IS NOT NULL THEN
            UPDATE public.variants SET stock_qty = stock_qty + OLD.quantity WHERE id = OLD.variant_id;
            INSERT INTO public.inventory_transactions
                (business_id, variant_id, quantity_change, transaction_type, reference_id, note)
            VALUES (v_biz, OLD.variant_id, OLD.quantity, 'return', OLD.order_id,
                    'Auto: line removed from shipped order');
        END IF;
        RETURN OLD;

    ELSE  -- UPDATE
        SELECT stock_deducted, business_id INTO v_deducted, v_biz
        FROM public.orders WHERE id = NEW.order_id;
        IF NOT COALESCE(v_deducted, false) THEN
            RETURN NEW;
        END IF;

        IF OLD.variant_id IS DISTINCT FROM NEW.variant_id THEN
            -- Moved to a different variant: return the old, take the new.
            IF OLD.variant_id IS NOT NULL THEN
                UPDATE public.variants SET stock_qty = stock_qty + OLD.quantity WHERE id = OLD.variant_id;
                INSERT INTO public.inventory_transactions
                    (business_id, variant_id, quantity_change, transaction_type, reference_id, note)
                VALUES (v_biz, OLD.variant_id, OLD.quantity, 'return', NEW.order_id, 'Auto: line variant changed');
            END IF;
            IF NEW.variant_id IS NOT NULL THEN
                UPDATE public.variants SET stock_qty = stock_qty - NEW.quantity WHERE id = NEW.variant_id;
                INSERT INTO public.inventory_transactions
                    (business_id, variant_id, quantity_change, transaction_type, reference_id, note)
                VALUES (v_biz, NEW.variant_id, -NEW.quantity, 'sale', NEW.order_id, 'Auto: line variant changed');
            END IF;
        ELSIF OLD.quantity IS DISTINCT FROM NEW.quantity AND NEW.variant_id IS NOT NULL THEN
            UPDATE public.variants SET stock_qty = stock_qty - (NEW.quantity - OLD.quantity) WHERE id = NEW.variant_id;
            INSERT INTO public.inventory_transactions
                (business_id, variant_id, quantity_change, transaction_type, reference_id, note)
            VALUES (v_biz, NEW.variant_id, -(NEW.quantity - OLD.quantity), 'adjust', NEW.order_id,
                    'Auto: line quantity changed on shipped order');
        END IF;
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_item_stock ON public.order_items;
CREATE TRIGGER trg_sync_order_item_stock
    AFTER INSERT OR UPDATE OR DELETE ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public.sync_order_item_stock();

-- ===========================================================================
-- 6. Damages leave stock (the guide already promises this)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.apply_damage_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.variant_id IS NOT NULL AND COALESCE(NEW.quantity, 0) <> 0 THEN
        UPDATE public.variants SET stock_qty = stock_qty - NEW.quantity WHERE id = NEW.variant_id;
        INSERT INTO public.inventory_transactions
            (business_id, variant_id, quantity_change, transaction_type, reference_id, note)
        VALUES (NEW.business_id, NEW.variant_id, -NEW.quantity, 'damage', NEW.id,
                COALESCE(NEW.notes, 'Damage recorded'));
    END IF;
    RETURN NEW;
END;
$$;

-- INSERT only: existing damage rows are left untouched, since staff may already
-- have adjusted stock by hand to compensate for them.
DROP TRIGGER IF EXISTS trg_apply_damage_stock ON public.inventory_damages;
CREATE TRIGGER trg_apply_damage_stock
    AFTER INSERT ON public.inventory_damages
    FOR EACH ROW EXECUTE FUNCTION public.apply_damage_stock();

-- ===========================================================================
-- 7. Reconciliation for the inventory page
-- ===========================================================================
-- Returns only variants whose on-hand counter disagrees with the ledger sum.
-- After this migration it should return nothing; anything that appears later is
-- a movement that bypassed the triggers — surfaced immediately instead of being
-- found by a physical recount weeks on.
CREATE OR REPLACE FUNCTION public.get_inventory_reconciliation(p_business_id UUID)
RETURNS TABLE (
    variant_id   UUID,
    product_name TEXT,
    variant_title TEXT,
    stock_qty    INTEGER,
    ledger_qty   BIGINT,
    difference   BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT v.id, p.name, v.title, v.stock_qty,
           COALESCE(SUM(t.quantity_change), 0) AS ledger_qty,
           v.stock_qty - COALESCE(SUM(t.quantity_change), 0) AS difference
    FROM public.variants v
    JOIN public.products p ON p.id = v.product_id
    LEFT JOIN public.inventory_transactions t ON t.variant_id = v.id
    WHERE p.business_id = p_business_id
      AND v.track_inventory
    GROUP BY v.id, p.name, v.title, v.stock_qty
    HAVING v.stock_qty <> COALESCE(SUM(t.quantity_change), 0)
    ORDER BY abs(v.stock_qty - COALESCE(SUM(t.quantity_change), 0)) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_reconciliation(UUID) TO authenticated;

-- ===========================================================================
-- Verify (expect zero rows)
-- ===========================================================================
--   SELECT v.id, v.stock_qty, COALESCE(SUM(t.quantity_change),0) AS ledger
--   FROM variants v LEFT JOIN inventory_transactions t ON t.variant_id = v.id
--   GROUP BY v.id, v.stock_qty
--   HAVING v.stock_qty <> COALESCE(SUM(t.quantity_change),0);

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP TRIGGER IF EXISTS trg_sync_order_stock ON public.orders;
-- DROP TRIGGER IF EXISTS trg_sync_order_item_stock ON public.order_items;
-- DROP TRIGGER IF EXISTS trg_apply_damage_stock ON public.inventory_damages;
-- (leave the columns and opening_balance rows; they are harmless)
