-- Migration: moderator attribution, monthly targets, and the league table
-- Created At: 2026-08-02
--
-- Moderators confirm orders with the customer — either an order that came in
-- through EasyOrders and is waiting review, or one they took over messages.
-- Nothing currently records who closed which order, so there is no way to set
-- a target, no way to see who is meeting it, and no way to reward the ones who
-- talk customers into a second item.
--
-- Three pieces:
--   1. orders.closed_by       — who confirmed the order with the customer
--   2. moderator_targets      — the month's goal for the team
--   3. get_moderator_league() — the standings, aggregated in SQL

-- ===========================================================================
-- 1. Attribution
-- ===========================================================================
-- Email rather than a user id: business_users.user_id is null for people who
-- were invited but have not signed up yet, and the rest of the app already
-- identifies staff by email (logBusinessAction, attendance, permissions).
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS closed_by TEXT;

COMMENT ON COLUMN public.orders.closed_by IS
    'Email of the moderator who confirmed and closed this order with the customer. Null for orders nobody has claimed.';

-- The league groups by this within a business and a date range.
CREATE INDEX IF NOT EXISTS idx_orders_closed_by
    ON public.orders (business_id, closed_by, created_at)
    WHERE closed_by IS NOT NULL;

-- ===========================================================================
-- 2. Monthly targets
-- ===========================================================================
-- One row per business per month. Targets are team-wide: the stated goal is
-- 2000 orders and 86% delivery across the moderators, not per person, so that
-- a small team is not judged by the same number as a large one.
--
-- items_per_order_target drives the cross-sell contest. It is a rate, not a
-- count, so it cannot be won by simply taking more orders.
CREATE TABLE IF NOT EXISTS public.moderator_targets (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id            UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    -- Always the first day of the month it applies to.
    month                  DATE NOT NULL,
    orders_target          INTEGER NOT NULL DEFAULT 0,
    delivery_rate_target   NUMERIC(5,2) NOT NULL DEFAULT 0,
    items_per_order_target NUMERIC(5,2) NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, month)
);

ALTER TABLE public.moderator_targets ENABLE ROW LEVEL SECURITY;

-- Members of the business read and write their own targets. Written as two
-- policies because the app upserts: ON CONFLICT DO UPDATE needs to be able to
-- see the row it collides with, so SELECT has to be granted too.
DROP POLICY IF EXISTS "Members can read their targets" ON public.moderator_targets;
CREATE POLICY "Members can read their targets"
ON public.moderator_targets FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = moderator_targets.business_id
      AND bu.user_email = auth.jwt() ->> 'email'
));

DROP POLICY IF EXISTS "Members can write their targets" ON public.moderator_targets;
CREATE POLICY "Members can write their targets"
ON public.moderator_targets FOR ALL TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = moderator_targets.business_id
      AND bu.user_email = auth.jwt() ->> 'email'
))
WITH CHECK (EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = moderator_targets.business_id
      AND bu.user_email = auth.jwt() ->> 'email'
));

-- ===========================================================================
-- 3. What counts as delivered
-- ===========================================================================
-- Delivery rate is measured over orders that actually reached a conclusion.
-- Collected and Delivered succeeded; Returned came back. Cancelled is excluded
-- deliberately — the parcel never shipped, so it is not a failed delivery and
-- counting it would punish a moderator for a customer changing their mind.
-- Shipped / Returning / Hold To redeliver are still moving and are not yet
-- either.
CREATE OR REPLACE FUNCTION public.is_delivery_success(p_status TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(btrim(coalesce(p_status,''))) IN ('delivered','collected');
$$;

CREATE OR REPLACE FUNCTION public.is_delivery_failure(p_status TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(btrim(coalesce(p_status,''))) IN ('returned');
$$;

-- ===========================================================================
-- 4. The standings
-- ===========================================================================
-- Aggregated in SQL. There are ~7.6k orders and every one of them has line
-- items; counting this in the browser would mean shipping the whole table.
--
-- SECURITY DEFINER is needed to read across the business regardless of the
-- caller's row policies, so the first thing it does is verify the caller is
-- actually a member of the business it was handed. Without that check any
-- authenticated user could read another tenant's numbers by passing their id.
CREATE OR REPLACE FUNCTION public.get_moderator_league(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    closed_by        TEXT,
    orders_count     BIGINT,
    items_count      BIGINT,
    items_per_order  NUMERIC,
    sales_value      NUMERIC,
    delivered_count  BIGINT,
    returned_count   BIGINT,
    delivery_rate    NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.business_id = p_business_id
          AND bu.user_email = auth.jwt() ->> 'email'
    ) THEN
        RAISE EXCEPTION 'not a member of this business';
    END IF;

    RETURN QUERY
    WITH scoped AS (
        SELECT o.id, o.closed_by, o.status, o.total_amount
        FROM public.orders o
        WHERE o.business_id = p_business_id
          AND o.closed_by IS NOT NULL
          AND o.created_at >= p_from
          AND o.created_at <  p_to
          -- A cancelled order was never sold; leaving it in would let someone
          -- climb the board by confirming orders that go nowhere.
          AND lower(btrim(coalesce(o.status,''))) <> 'cancelled'
    ),
    -- Summed per order first. Joining items straight onto orders would
    -- multiply total_amount by the number of lines.
    item_counts AS (
        SELECT oi.order_id, COALESCE(SUM(oi.quantity), 0) AS qty
        FROM public.order_items oi
        JOIN scoped s ON s.id = oi.order_id
        GROUP BY oi.order_id
    )
    SELECT
        s.closed_by,
        COUNT(*)::BIGINT,
        COALESCE(SUM(ic.qty), 0)::BIGINT,
        ROUND(COALESCE(SUM(ic.qty), 0)::NUMERIC / NULLIF(COUNT(*), 0), 2),
        ROUND(COALESCE(SUM(s.total_amount), 0)::NUMERIC, 2),
        (COUNT(*) FILTER (WHERE public.is_delivery_success(s.status)))::BIGINT,
        (COUNT(*) FILTER (WHERE public.is_delivery_failure(s.status)))::BIGINT,
        ROUND(
            100.0 * COUNT(*) FILTER (WHERE public.is_delivery_success(s.status))
            / NULLIF(COUNT(*) FILTER (
                WHERE public.is_delivery_success(s.status)
                   OR public.is_delivery_failure(s.status)
              ), 0)
        , 2)
    FROM scoped s
    LEFT JOIN item_counts ic ON ic.order_id = s.id
    GROUP BY s.closed_by
    ORDER BY COUNT(*) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_moderator_league(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ===========================================================================
-- 5. Let the edit-order screen save the attribution
-- ===========================================================================
-- update_order_and_items whitelists the columns it writes, so a new field is
-- invisible to it until it is named here. Only the SET list changes; the item
-- upsert and delete below it are reproduced exactly as they already are,
-- because CREATE OR REPLACE rewrites the whole body.
--
-- Guarded with `?` so a caller that does not send the key leaves the existing
-- value alone instead of clearing it — an unconditional assignment would strip
-- the moderator off an order the moment anyone edited it from another screen.
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
    payment_status = p_order_update->>'payment_status',
    paid_amount = (p_order_update->>'paid_amount')::NUMERIC,
    closed_by = CASE
                  WHEN jsonb_exists(p_order_update, 'closed_by')
                    THEN NULLIF(p_order_update->>'closed_by', '')
                  ELSE orders.closed_by
                END,
    tags = (SELECT array_agg(x) FROM jsonb_array_elements_text(p_order_update->'tags') t(x))
  WHERE id = p_order_id;

  -- 2. Upsert Items
  IF array_length(p_upsert_items, 1) > 0 THEN
    INSERT INTO order_items (id, order_id, variant_id, quantity, price_at_sale, cost_at_sale)
    SELECT
      COALESCE((x->>'id')::UUID, gen_random_uuid()),
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

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT * FROM public.get_moderator_league(
--       '<business id>', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month');
--
-- Unattributed orders are absent by design: closed_by IS NULL means nobody has
-- claimed it, and inventing a bucket for them would make the totals look like
-- the team's when they are not.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.get_moderator_league(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
-- DROP TABLE IF EXISTS public.moderator_targets;
-- DROP INDEX IF EXISTS public.idx_orders_closed_by;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS closed_by;
-- -- is_delivery_success / is_delivery_failure are left in place; they are
-- -- harmless and may be referenced elsewhere by then.
