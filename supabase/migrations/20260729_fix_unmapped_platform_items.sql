-- Migration: repair orphaned order items and stop unmapped orders escaping
-- Created At: 2026-07-29
--
-- Symptom: platform orders reaching Pending (and beyond) still showing
-- "unknown product", which makes picking impossible.
--
-- Three separate causes chained together:
--
--  1. The EasyOrders webhook inserted order_items without business_id — 942
--     rows. Shopify's webhook always set it; EasyOrders never did.
--
--  2. Client updates are scoped by business_id. Against a NULL row that
--     matches nothing, and PostgREST reports a filtered UPDATE that changed
--     no rows as success. So mapping a product returned "saved", the UI
--     updated optimistically, and the database still held variant_id NULL.
--
--  3. The "all items mapped" check lives only in the Platform Orders screen.
--     Any other route out of Waiting — bulk status change in Logistics, the
--     shipping CSV importer — never asked, so an unmapped order could leave
--     Waiting without anyone noticing.
--
-- (1) and (2) are fixed in application code. This migration repairs the data
-- and closes (3) at the database, which is the only place every route passes
-- through.

-- ---------------------------------------------------------------------------
-- 1. Backfill the missing tenant on existing rows
-- ---------------------------------------------------------------------------
-- Every orphan has a parent to inherit from; none are unrecoverable.
UPDATE public.order_items oi
SET business_id = o.business_id
FROM public.orders o
WHERE oi.order_id = o.id
  AND oi.business_id IS NULL
  AND o.business_id IS NOT NULL;

UPDATE public.variants v
SET business_id = p.business_id
FROM public.products p
WHERE v.product_id = p.id
  AND v.business_id IS NULL
  AND p.business_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Keep the tenant filled in from now on, whatever the writer forgets
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_items_inherit_business()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.business_id IS NULL AND NEW.order_id IS NOT NULL THEN
        SELECT business_id INTO NEW.business_id
        FROM public.orders WHERE id = NEW.order_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_items_inherit_business ON public.order_items;
CREATE TRIGGER trg_order_items_inherit_business
    BEFORE INSERT OR UPDATE ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public.order_items_inherit_business();

CREATE OR REPLACE FUNCTION public.variants_inherit_business()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.business_id IS NULL AND NEW.product_id IS NOT NULL THEN
        SELECT business_id INTO NEW.business_id
        FROM public.products WHERE id = NEW.product_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_variants_inherit_business ON public.variants;
CREATE TRIGGER trg_variants_inherit_business
    BEFORE INSERT OR UPDATE ON public.variants
    FOR EACH ROW EXECUTE FUNCTION public.variants_inherit_business();

-- ---------------------------------------------------------------------------
-- 3. An order may not leave Waiting while any line is unmapped
-- ---------------------------------------------------------------------------
-- This enforces the existing process rather than changing it: platform orders
-- still arrive as Waiting and are still mapped by hand on the Platform Orders
-- screen. It only makes the rule apply on every route out, instead of the one
-- screen that happened to check.
--
-- Cancelling stays allowed — a junk order should be dismissable without
-- someone first having to map products that will never be picked.
CREATE OR REPLACE FUNCTION public.block_unmapped_leaving_waiting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_unmapped INTEGER;
BEGIN
    IF lower(coalesce(OLD.status, '')) <> 'waiting' THEN
        RETURN NEW;
    END IF;
    IF lower(coalesce(NEW.status, '')) IN ('waiting', 'cancelled', 'canceled') THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO v_unmapped
    FROM public.order_items
    WHERE order_id = NEW.id AND variant_id IS NULL;

    IF v_unmapped > 0 THEN
        RAISE EXCEPTION
            'لسه في % منتج غير محدد في الأوردر ده. اربط كل المنتجات الأول قبل ما تحركه.', v_unmapped
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_unmapped_leaving_waiting ON public.orders;
CREATE TRIGGER trg_block_unmapped_leaving_waiting
    BEFORE UPDATE OF status ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.block_unmapped_leaving_waiting();

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- Expect 0, 0:
--   SELECT count(*) FROM order_items WHERE business_id IS NULL;
--   SELECT count(*) FROM variants    WHERE business_id IS NULL;
--
-- Orders already past Waiting keep their unmapped lines — the trigger only
-- guards the transition. List them so they can be corrected by hand:
--   SELECT o.id, o.status, i.unmapped_name
--   FROM orders o JOIN order_items i ON i.order_id = o.id
--   WHERE i.variant_id IS NULL AND lower(o.status) NOT IN ('waiting','cancelled');

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- DROP TRIGGER IF EXISTS trg_block_unmapped_leaving_waiting ON public.orders;
-- DROP TRIGGER IF EXISTS trg_order_items_inherit_business ON public.order_items;
-- DROP TRIGGER IF EXISTS trg_variants_inherit_business ON public.variants;
