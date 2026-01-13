CREATE OR REPLACE FUNCTION update_order_and_items(
  p_order_id UUID,
  p_order_update JSONB,
  p_upsert_items JSONB[],
  p_delete_item_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- 1. Update Order Header
  UPDATE orders
  SET
    created_at = (p_order_update->>'created_at')::TIMESTAMP WITH TIME ZONE,
    status = p_order_update->>'status',
    customer_info = p_order_update->'customer_info',
    shipping_cost = (p_order_update->>'shipping_cost')::NUMERIC,
    discount = (p_order_update->>'discount')::NUMERIC,
    total_amount = (p_order_update->>'total_amount')::NUMERIC,
    subtotal = (p_order_update->>'subtotal')::NUMERIC,
    total_cost = (p_order_update->>'total_cost')::NUMERIC,
    channel = p_order_update->>'channel',
    notes = p_order_update->>'notes',
    shipping_company_id = (p_order_update->>'shipping_company_id')::UUID,
    tags = (SELECT array_agg(x) FROM jsonb_array_elements_text(p_order_update->'tags') t(x))
  WHERE id = p_order_id;

  -- 2. Upsert Items
  IF array_length(p_upsert_items, 1) > 0 THEN
    INSERT INTO order_items (id, order_id, variant_id, quantity, price_at_sale, cost_at_sale)
    SELECT
      (x->>'id')::UUID, -- If NULL, it will auto-generate if column is DEFAULT gen_random_uuid()
      p_order_id,
      (x->>'variant_id')::UUID,
      (x->>'quantity')::INTEGER,
      (x->>'price_at_sale')::NUMERIC,
      (x->>'cost_at_sale')::NUMERIC
    FROM unnest(p_upsert_items) AS x
    ON CONFLICT (id) DO UPDATE
    SET
      quantity = EXCLUDED.quantity,
      price_at_sale = EXCLUDED.price_at_sale,
      cost_at_sale = EXCLUDED.cost_at_sale;
  END IF;

  -- 3. Delete Items
  IF array_length(p_delete_item_ids, 1) > 0 THEN
    DELETE FROM order_items
    WHERE id = ANY(p_delete_item_ids) AND order_id = p_order_id;
  END IF;
  
END;
$$;
