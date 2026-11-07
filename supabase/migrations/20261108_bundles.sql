-- ===========================================================================
-- Bundles
-- ===========================================================================
-- A bundle is products sold together at a price set for each of them, e.g.
-- "Winter set" = a throw blanket at 400 + two cushions at 150 each. It can
-- have variants (one per colour, say), each with its own SKU and its own
-- products.
--
-- On an order a bundle is not a line of its own: it is written as the products
-- in it, each at the price the bundle gives it, and each line remembers the
-- bundle it came from (order_items.bundle_variant_id). Stock, cost, profit,
-- the waybill and every report keep reading real products and need nothing new.
--
-- EasyOrders has no bundles: a bundle there is one product with one SKU. The
-- webhook looks that SKU up here and writes the bundle's products in its place,
-- which is why a bundle's SKU may not also be a product's SKU.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. How SKUs are compared: the webhook's rule, letters and digits only,
--    any case ("WS-1", "ws1" and "WS 1" are the same code).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sku_key(p_sku TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT lower(regexp_replace(COALESCE(p_sku, ''), '[^a-zA-Z0-9]', '', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bundles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT,
    -- Off: hidden from the order pages. EasyOrders orders for it still map.
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bundles_business ON public.bundles (business_id);

CREATE TABLE IF NOT EXISTS public.bundle_variants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    bundle_id   UUID NOT NULL REFERENCES public.bundles(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT 'Default',
    sku         TEXT,
    sort        INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bundle_variants_bundle ON public.bundle_variants (bundle_id);
-- One bundle per SKU in a business.
CREATE UNIQUE INDEX IF NOT EXISTS bundle_variants_sku_unique
    ON public.bundle_variants (business_id, public.sku_key(sku))
    WHERE public.sku_key(sku) <> '';

CREATE TABLE IF NOT EXISTS public.bundle_variant_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id       UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    bundle_variant_id UUID NOT NULL REFERENCES public.bundle_variants(id) ON DELETE CASCADE,
    -- RESTRICT: a product inside a bundle is not deleted from under it, or the
    -- bundle would quietly sell for less.
    variant_id        UUID NOT NULL REFERENCES public.variants(id) ON DELETE RESTRICT,
    quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    -- Price of one piece inside the bundle.
    price             NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    sort              INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bundle_variant_items_variant ON public.bundle_variant_items (bundle_variant_id);
CREATE INDEX IF NOT EXISTS idx_bundle_variant_items_product ON public.bundle_variant_items (variant_id);

-- Which bundle an order line came from. Deleting the bundle keeps the line.
ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS bundle_variant_id UUID REFERENCES public.bundle_variants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_bundle_variant
    ON public.order_items (bundle_variant_id) WHERE bundle_variant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Integrity
-- ---------------------------------------------------------------------------
-- A bundle variant belongs to its bundle's business, and its SKU is not a
-- product's SKU (the webhook could not tell which one was ordered).
CREATE OR REPLACE FUNCTION public.bundle_variants_check()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    SELECT business_id INTO NEW.business_id FROM public.bundles WHERE id = NEW.bundle_id;
    NEW.sku := NULLIF(trim(COALESCE(NEW.sku, '')), '');
    NEW.title := COALESCE(NULLIF(trim(COALESCE(NEW.title, '')), ''), 'Default');
    IF public.sku_key(NEW.sku) <> '' AND EXISTS (
        SELECT 1 FROM public.variants v
        WHERE v.business_id = NEW.business_id AND public.sku_key(v.sku) = public.sku_key(NEW.sku)
    ) THEN
        RAISE EXCEPTION 'SKU % is already a product''s SKU', NEW.sku
            USING ERRCODE = '23505', HINT = 'bundle_sku_is_product';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_bundle_variants_check ON public.bundle_variants;
CREATE TRIGGER trg_bundle_variants_check
    BEFORE INSERT OR UPDATE ON public.bundle_variants
    FOR EACH ROW EXECUTE FUNCTION public.bundle_variants_check();

-- A bundle's product is one of the same business's products.
CREATE OR REPLACE FUNCTION public.bundle_variant_items_check()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    SELECT business_id INTO NEW.business_id FROM public.bundle_variants WHERE id = NEW.bundle_variant_id;
    IF NOT EXISTS (SELECT 1 FROM public.variants WHERE id = NEW.variant_id AND business_id = NEW.business_id) THEN
        RAISE EXCEPTION 'product % is not in this business', NEW.variant_id;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_bundle_variant_items_check ON public.bundle_variant_items;
CREATE TRIGGER trg_bundle_variant_items_check
    BEFORE INSERT OR UPDATE ON public.bundle_variant_items
    FOR EACH ROW EXECUTE FUNCTION public.bundle_variant_items_check();

-- And the other way: a product cannot take a bundle's SKU.
CREATE OR REPLACE FUNCTION public.variants_sku_not_bundle()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF public.sku_key(NEW.sku) <> ''
       AND (TG_OP = 'INSERT' OR public.sku_key(NEW.sku) IS DISTINCT FROM public.sku_key(OLD.sku))
       AND EXISTS (
           SELECT 1 FROM public.bundle_variants b
           WHERE b.business_id = NEW.business_id AND public.sku_key(b.sku) = public.sku_key(NEW.sku)
       ) THEN
        RAISE EXCEPTION 'SKU % is already a bundle''s SKU', NEW.sku
            USING ERRCODE = '23505', HINT = 'product_sku_is_bundle';
    END IF;
    RETURN NEW;
END;
$$;
-- Named to run after trg_variants_inherit_business (triggers fire by name),
-- so business_id is already filled in.
DROP TRIGGER IF EXISTS trg_variants_z_sku_not_bundle ON public.variants;
CREATE TRIGGER trg_variants_z_sku_not_bundle
    BEFORE INSERT OR UPDATE OF sku ON public.variants
    FOR EACH ROW EXECUTE FUNCTION public.variants_sku_not_bundle();

-- ---------------------------------------------------------------------------
-- 4. Access: members of the business, like products
-- ---------------------------------------------------------------------------
ALTER TABLE public.bundles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_variants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_variant_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['bundles', 'bundle_variants', 'bundle_variant_items'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_member', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL
                 USING (business_id IN (SELECT public.get_my_business_ids()) OR public.am_i_admin_of_business(business_id))
                 WITH CHECK (business_id IN (SELECT public.get_my_business_ids()) OR public.am_i_admin_of_business(business_id))',
            t || '_member', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Saving a bundle: the bundle, its variants and their products in one go
-- ---------------------------------------------------------------------------
-- p_bundle: {id?, name, description?, active?, variants: [{id?, title, sku?,
--            items: [{variant_id, quantity, price}]}]}
-- Variants left out are deleted (their past order lines keep their products).
-- Runs as the caller, so the policies above decide what may be written.
CREATE OR REPLACE FUNCTION public.save_bundle(p_business_id UUID, p_bundle JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_id    UUID := NULLIF(p_bundle->>'id', '')::UUID;
    v_name  TEXT := NULLIF(trim(COALESCE(p_bundle->>'name', '')), '');
    v_desc  TEXT := NULLIF(trim(COALESCE(p_bundle->>'description', '')), '');
    v_active BOOLEAN := COALESCE((p_bundle->>'active')::BOOLEAN, true);
    v       JSONB;
    it      JSONB;
    v_vid   UUID;
    v_keep  UUID[] := '{}';
    v_n     INTEGER := 0;
    v_m     INTEGER;
BEGIN
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'a bundle needs a name' USING HINT = 'bundle_no_name';
    END IF;
    IF jsonb_array_length(COALESCE(p_bundle->'variants', '[]'::JSONB)) = 0 THEN
        RAISE EXCEPTION 'a bundle needs at least one variant' USING HINT = 'bundle_no_variant';
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO public.bundles (business_id, name, description, active)
        VALUES (p_business_id, v_name, v_desc, v_active)
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.bundles
           SET name = v_name, description = v_desc, active = v_active, updated_at = now()
         WHERE id = v_id AND business_id = p_business_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'bundle not found' USING HINT = 'bundle_not_found';
        END IF;
    END IF;

    -- Variants kept, by id; those no longer sent go first, so a SKU can move
    -- from a deleted variant to a new one in the same save.
    SELECT COALESCE(array_agg(NULLIF(x->>'id', '')::UUID) FILTER (WHERE NULLIF(x->>'id', '') IS NOT NULL), '{}')
      INTO v_keep
      FROM jsonb_array_elements(p_bundle->'variants') x;
    DELETE FROM public.bundle_variants WHERE bundle_id = v_id AND NOT (id = ANY (v_keep));

    FOR v IN SELECT * FROM jsonb_array_elements(p_bundle->'variants') LOOP
        v_n := v_n + 1;
        IF jsonb_array_length(COALESCE(v->'items', '[]'::JSONB)) = 0 THEN
            RAISE EXCEPTION 'variant % has no products', COALESCE(v->>'title', '') USING HINT = 'bundle_variant_empty';
        END IF;
        v_vid := NULLIF(v->>'id', '')::UUID;
        IF v_vid IS NULL THEN
            INSERT INTO public.bundle_variants (business_id, bundle_id, title, sku, sort)
            VALUES (p_business_id, v_id, v->>'title', v->>'sku', v_n)
            RETURNING id INTO v_vid;
        ELSE
            UPDATE public.bundle_variants
               SET title = v->>'title', sku = v->>'sku', sort = v_n
             WHERE id = v_vid AND bundle_id = v_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'bundle variant not found' USING HINT = 'bundle_not_found';
            END IF;
        END IF;

        DELETE FROM public.bundle_variant_items WHERE bundle_variant_id = v_vid;
        v_m := 0;
        FOR it IN SELECT * FROM jsonb_array_elements(v->'items') LOOP
            v_m := v_m + 1;
            INSERT INTO public.bundle_variant_items (business_id, bundle_variant_id, variant_id, quantity, price, sort)
            VALUES (p_business_id, v_vid, (it->>'variant_id')::UUID,
                    GREATEST(1, COALESCE((it->>'quantity')::INTEGER, 1)),
                    GREATEST(0, COALESCE((it->>'price')::NUMERIC, 0)), v_m);
        END LOOP;
    END LOOP;

    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_bundle(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_bundle(UUID, JSONB) TO authenticated;

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.save_bundle(UUID, JSONB);
-- DROP TRIGGER IF EXISTS trg_variants_z_sku_not_bundle ON public.variants;
-- DROP FUNCTION IF EXISTS public.variants_sku_not_bundle();
-- ALTER TABLE public.order_items DROP COLUMN IF EXISTS bundle_variant_id;
-- DROP TABLE IF EXISTS public.bundle_variant_items;
-- DROP TABLE IF EXISTS public.bundle_variants;
-- DROP TABLE IF EXISTS public.bundles;
-- DROP FUNCTION IF EXISTS public.bundle_variants_check();
-- DROP FUNCTION IF EXISTS public.bundle_variant_items_check();
-- DROP FUNCTION IF EXISTS public.sku_key(TEXT);
