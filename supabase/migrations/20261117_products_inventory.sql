-- ===========================================================================
-- Products and stock: save in one go, adjust stock that actually works
-- ===========================================================================
-- 1. Reducing stock and "set to" never worked: the database holds two
--    decrement_stock functions (with and without is_open) and PostgREST
--    refuses to pick one ("Could not choose the best candidate function").
--    adjust_stock replaces the page's three calls with one that adds, reduces
--    or sets against the number in the database at that moment, and records
--    the movement. The two-argument decrement_stock is dropped; the other one
--    takes the same two arguments.
-- 2. Saving a product wrote back the stock shown when the form opened, so
--    any order that moved stock in between was quietly undone; removing a
--    variant that had orders failed after the name and prices were already
--    saved. save_product does it all or nothing, never touches existing stock,
--    and archives a variant with history instead of failing to delete it.
-- 3. A product with orders can't be deleted. It can be archived: hidden from
--    the order pages and the catalogue, its history intact.
-- Safe to run more than once.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.variants ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.decrement_stock(UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.is_member_of(p_business_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(auth.role(), '') = 'service_role'
        OR EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = p_business_id
                      AND lower(bu.user_email) = lower(auth.jwt() ->> 'email'))
        OR public.am_i_admin_of_business(p_business_id);
$$;

-- ---------------------------------------------------------------------------
-- Stock: add, reduce or set
-- ---------------------------------------------------------------------------
-- p_mode: 'add' | 'reduce' | 'set'. p_cost, when given with add or set, is
-- the new unit cost. Returns {old, new, change}.
CREATE OR REPLACE FUNCTION public.adjust_stock(
    p_variant_id UUID,
    p_mode       TEXT,
    p_qty        INTEGER,
    p_cost       NUMERIC DEFAULT NULL,
    p_reason     TEXT DEFAULT NULL,
    p_note       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v   public.variants;
    v_new INTEGER;
    v_type TEXT;
BEGIN
    SELECT * INTO v FROM public.variants WHERE id = p_variant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'المنتج ده مش موجود.'; END IF;
    IF NOT public.is_member_of(v.business_id) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_qty IS NULL OR p_qty < 0 OR (p_mode <> 'set' AND p_qty = 0) THEN
        RAISE EXCEPTION 'الكمية لازم تكون أكبر من صفر.' USING HINT = 'bad_qty';
    END IF;

    v_new := CASE p_mode
                 WHEN 'add'    THEN COALESCE(v.stock_qty, 0) + p_qty
                 WHEN 'reduce' THEN COALESCE(v.stock_qty, 0) - p_qty
                 WHEN 'set'    THEN p_qty
             END;
    IF v_new IS NULL THEN RAISE EXCEPTION 'unknown mode %', p_mode; END IF;
    v_type := CASE p_mode WHEN 'add' THEN 'restock' WHEN 'reduce' THEN 'manual_deduction' ELSE 'manual_set' END;

    UPDATE public.variants
       SET stock_qty = v_new,
           cost_price = CASE WHEN p_mode IN ('add', 'set') AND p_cost IS NOT NULL AND p_cost >= 0 THEN p_cost ELSE cost_price END
     WHERE id = p_variant_id;

    IF v_new <> COALESCE(v.stock_qty, 0) THEN
        INSERT INTO public.inventory_transactions (business_id, variant_id, quantity_change, transaction_type, note)
        VALUES (v.business_id, p_variant_id, v_new - COALESCE(v.stock_qty, 0), v_type,
                NULLIF(concat_ws(' — ', NULLIF(trim(p_reason), ''), NULLIF(trim(p_note), ''),
                                 'by ' || COALESCE(auth.jwt() ->> 'email', 'system')), ''));
    END IF;

    RETURN jsonb_build_object('old', COALESCE(v.stock_qty, 0), 'new', v_new, 'change', v_new - COALESCE(v.stock_qty, 0));
END $$;
REVOKE ALL ON FUNCTION public.adjust_stock(UUID, TEXT, INTEGER, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock(UUID, TEXT, INTEGER, NUMERIC, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Save a product with its variants
-- ---------------------------------------------------------------------------
-- p_product: {id?, name, description?, archived?, variants: [{id?, title, sku?,
--   sale_price, cost_price, track_inventory, stock_qty (new variants only)}]}
CREATE OR REPLACE FUNCTION public.save_product(p_business_id UUID, p_product JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id    UUID := NULLIF(p_product ->> 'id', '')::UUID;
    v_name  TEXT := NULLIF(trim(COALESCE(p_product ->> 'name', '')), '');
    x       JSONB;
    v_vid   UUID;
    v_keep  UUID[] := '{}';
    v_sku   TEXT;
    v_other TEXT;
    v_stock INTEGER;
    r       RECORD;
BEGIN
    IF NOT public.is_member_of(p_business_id) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_name IS NULL THEN RAISE EXCEPTION 'اكتب اسم المنتج.' USING HINT = 'no_name'; END IF;
    IF jsonb_array_length(COALESCE(p_product -> 'variants', '[]')) = 0 THEN
        RAISE EXCEPTION 'المنتج محتاج اختيار واحد على الأقل.' USING HINT = 'no_variant';
    END IF;

    -- A SKU belongs to one variant in the business.
    FOR x IN SELECT * FROM jsonb_array_elements(p_product -> 'variants') LOOP
        v_sku := NULLIF(trim(COALESCE(x ->> 'sku', '')), '');
        CONTINUE WHEN v_sku IS NULL;
        SELECT p.name INTO v_other
          FROM public.variants vv JOIN public.products p ON p.id = vv.product_id
         WHERE vv.business_id = p_business_id
           AND lower(vv.sku) = lower(v_sku)
           AND vv.id IS DISTINCT FROM NULLIF(x ->> 'id', '')::UUID
           AND (v_id IS NULL OR vv.product_id <> v_id)
         LIMIT 1;
        IF v_other IS NOT NULL THEN
            RAISE EXCEPTION 'الكود % مستخدم للمنتج «%».', v_sku, v_other USING HINT = 'sku_taken';
        END IF;
    END LOOP;
    IF (SELECT count(*) <> count(DISTINCT lower(trim(x ->> 'sku')))
          FROM jsonb_array_elements(p_product -> 'variants') x
         WHERE NULLIF(trim(COALESCE(x ->> 'sku', '')), '') IS NOT NULL) THEN
        RAISE EXCEPTION 'فيه كود (SKU) متكرر بين اختيارات المنتج.' USING HINT = 'sku_taken';
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO public.products (business_id, name, description, archived)
        VALUES (p_business_id, v_name, NULLIF(trim(COALESCE(p_product ->> 'description', '')), ''),
                COALESCE((p_product ->> 'archived')::BOOLEAN, false))
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.products
           SET name = v_name,
               description = NULLIF(trim(COALESCE(p_product ->> 'description', '')), ''),
               archived = COALESCE((p_product ->> 'archived')::BOOLEAN, archived)
         WHERE id = v_id AND business_id = p_business_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'المنتج ده مش موجود.' USING HINT = 'not_found'; END IF;
    END IF;

    FOR x IN SELECT * FROM jsonb_array_elements(p_product -> 'variants') LOOP
        v_vid := NULLIF(x ->> 'id', '')::UUID;
        IF v_vid IS NOT NULL THEN
            -- Never the stock: that moves with orders and the stock page.
            UPDATE public.variants
               SET title = COALESCE(NULLIF(trim(x ->> 'title'), ''), 'Default'),
                   sku = NULLIF(trim(COALESCE(x ->> 'sku', '')), ''),
                   sale_price = GREATEST(0, COALESCE((x ->> 'sale_price')::NUMERIC, 0)),
                   cost_price = GREATEST(0, COALESCE((x ->> 'cost_price')::NUMERIC, 0)),
                   track_inventory = COALESCE((x ->> 'track_inventory')::BOOLEAN, false),
                   archived = false
             WHERE id = v_vid AND product_id = v_id;
            IF NOT FOUND THEN RAISE EXCEPTION 'اختيار مش موجود في المنتج ده.' USING HINT = 'not_found'; END IF;
        ELSE
            v_stock := CASE WHEN COALESCE((x ->> 'track_inventory')::BOOLEAN, false)
                            THEN GREATEST(0, COALESCE((x ->> 'stock_qty')::INTEGER, 0)) ELSE 0 END;
            INSERT INTO public.variants (business_id, product_id, title, sku, sale_price, cost_price, track_inventory, stock_qty)
            VALUES (p_business_id, v_id, COALESCE(NULLIF(trim(x ->> 'title'), ''), 'Default'),
                    NULLIF(trim(COALESCE(x ->> 'sku', '')), ''),
                    GREATEST(0, COALESCE((x ->> 'sale_price')::NUMERIC, 0)),
                    GREATEST(0, COALESCE((x ->> 'cost_price')::NUMERIC, 0)),
                    COALESCE((x ->> 'track_inventory')::BOOLEAN, false), v_stock)
            RETURNING id INTO v_vid;
            IF v_stock > 0 THEN
                INSERT INTO public.inventory_transactions (business_id, variant_id, quantity_change, transaction_type, note)
                VALUES (p_business_id, v_vid, v_stock, 'restock', 'رصيد أول المدة — by ' || COALESCE(auth.jwt() ->> 'email', 'system'));
            END IF;
        END IF;
        v_keep := v_keep || v_vid;
    END LOOP;

    -- Variants taken out: deleted, or archived when orders or bundles use them.
    FOR r IN SELECT vv.id FROM public.variants vv WHERE vv.product_id = v_id AND NOT (vv.id = ANY (v_keep)) LOOP
        IF EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.variant_id = r.id)
           OR EXISTS (SELECT 1 FROM public.bundle_variant_items bi WHERE bi.variant_id = r.id) THEN
            UPDATE public.variants SET archived = true WHERE id = r.id;
        ELSE
            DELETE FROM public.variants WHERE id = r.id;
        END IF;
    END LOOP;

    RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.save_product(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product(UUID, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- Delete a product, or say why not
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_product(p_product_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_business UUID;
    v_orders   INTEGER;
    v_bundles  INTEGER;
BEGIN
    SELECT business_id INTO v_business FROM public.products WHERE id = p_product_id;
    IF v_business IS NULL THEN RETURN; END IF;
    IF NOT public.is_member_of(v_business) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(DISTINCT oi.order_id) INTO v_orders
      FROM public.order_items oi JOIN public.variants v ON v.id = oi.variant_id
     WHERE v.product_id = p_product_id;
    SELECT count(*) INTO v_bundles
      FROM public.bundle_variant_items bi JOIN public.variants v ON v.id = bi.variant_id
     WHERE v.product_id = p_product_id;
    IF v_orders > 0 OR v_bundles > 0 THEN
        RAISE EXCEPTION 'المنتج ده في % أوردر و% باندل، فمينفعش يتمسح. أرشفه بدل كده.', v_orders, v_bundles
            USING HINT = 'in_use';
    END IF;
    DELETE FROM public.variants WHERE product_id = p_product_id;
    DELETE FROM public.products WHERE id = p_product_id;
END $$;
REVOKE ALL ON FUNCTION public.delete_product(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_product(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Rollback:
-- DROP FUNCTION IF EXISTS public.delete_product(UUID);
-- DROP FUNCTION IF EXISTS public.save_product(UUID, JSONB);
-- DROP FUNCTION IF EXISTS public.adjust_stock(UUID, TEXT, INTEGER, NUMERIC, TEXT, TEXT);
-- ALTER TABLE public.variants DROP COLUMN IF EXISTS archived;
-- ALTER TABLE public.products DROP COLUMN IF EXISTS archived;
