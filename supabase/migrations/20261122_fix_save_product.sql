-- ===========================================================================
-- Fix: saving a product failed every time
-- ===========================================================================
-- save_product (20261117_products_inventory.sql) checked for a SKU repeated
-- within the product with `jsonb_array_elements(...) x`, while `x` is also
-- one of its variables. PostgreSQL stops on that ("column reference "x" is
-- ambiguous", 42702), so no product could be added or edited through it.
-- The page now falls back to plain writes on that error; this puts the
-- one-step save back. Same function, the alias renamed. Safe to run again.

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
    IF (SELECT count(*) <> count(DISTINCT lower(trim(e ->> 'sku')))
          FROM jsonb_array_elements(p_product -> 'variants') e
         WHERE NULLIF(trim(COALESCE(e ->> 'sku', '')), '') IS NOT NULL) THEN
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

NOTIFY pgrst, 'reload schema';
