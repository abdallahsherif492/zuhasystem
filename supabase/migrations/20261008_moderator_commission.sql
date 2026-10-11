-- Migration: moderator commission
-- Created At: 2026-10-08
--
-- Moderators earn a share of the orders they close. An order earns it when
--   * it was delivered to the customer (Delivered or Collected) — a cancelled,
--     returned or still-travelling order earns nothing yet, and
--   * its total, shipping included, is at least the moderator's minimum
--     (1,500 EGP unless set otherwise).
-- The commission is the moderator's rate applied to the order total WITHOUT
-- shipping: shipping is passed on to the courier, it is not a sale.
--
-- Per moderator, set in Settings:
--   rate        percent of (order total − shipping)
--   min_total   the smallest order total, shipping included, that counts
--
-- An order belongs to the moderator in orders.closed_by, the same link the
-- moderators league ranks by. commission_board() returns the board for a
-- period. Everyone in the business sees the ranking — orders, average order
-- value, sales — but a commission figure and a rate only reach their own
-- moderator and managers.

-- ===========================================================================
-- 1. Settings
-- ===========================================================================
-- One row per moderator, plus one with user_email = '*' holding the defaults
-- offered for moderators switched on later.
CREATE TABLE IF NOT EXISTS public.commission_settings (
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_email  TEXT NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    rate        NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (rate >= 0 AND rate <= 100),
    min_total   NUMERIC(12,2) NOT NULL DEFAULT 1500 CHECK (min_total >= 0),
    updated_by  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id, user_email)
);

ALTER TABLE public.commission_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commission_settings_managers ON public.commission_settings;
CREATE POLICY commission_settings_managers ON public.commission_settings FOR ALL TO authenticated
    USING (public.is_business_manager(business_id))
    WITH CHECK (public.is_business_manager(business_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_settings TO authenticated;

-- ===========================================================================
-- 2. The board
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.commission_board(p_business_id UUID, p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me      TEXT := lower(auth.jwt() ->> 'email');
    v_manager BOOLEAN;
    v_rows    JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = p_business_id AND lower(bu.user_email) = v_me) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_manager := public.is_business_manager(p_business_id);

    WITH mods AS (
        SELECT lower(user_email) AS email, rate, min_total
          FROM public.commission_settings
         WHERE business_id = p_business_id AND user_email <> '*' AND enabled
    ),
    o AS (
        SELECT o.id, lower(trim(o.closed_by)) AS email,
               COALESCE(o.total_amount, 0) AS total,
               GREATEST(COALESCE(o.total_amount, 0) - COALESCE(o.shipping_cost, 0), 0) AS net,
               CASE
                   WHEN o.status IN ('Delivered', 'Collected')   THEN 'delivered'
                   WHEN o.status IN ('Returned', 'Returning')    THEN 'returned'
                   WHEN o.status IN ('Cancelled', 'Unavailable') THEN 'cancelled'
                   WHEN lower(trim(o.status)) = 'waiting'        THEN 'waiting'
                   ELSE 'open'   -- confirmed and on its way
               END AS bucket
          FROM public.orders o
         WHERE o.business_id = p_business_id
           AND o.created_at >= (p_from::timestamp AT TIME ZONE 'Africa/Cairo')
           AND o.created_at <  ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo')
           AND COALESCE(o.order_type, 'new') = 'new'
           AND lower(trim(o.closed_by)) IN (SELECT email FROM mods)
    ),
    scored AS (
        SELECT o.*, m.rate, m.min_total, (o.total >= m.min_total) AS big_enough
          FROM o JOIN mods m ON m.email = o.email
    ),
    per AS (
        SELECT m.email, m.rate, m.min_total,
               count(s.id) FILTER (WHERE s.bucket = 'delivered' AND s.big_enough)              AS eligible_orders,
               COALESCE(sum(s.net)   FILTER (WHERE s.bucket = 'delivered' AND s.big_enough), 0) AS eligible_sales,
               COALESCE(sum(s.total) FILTER (WHERE s.bucket = 'delivered' AND s.big_enough), 0) AS eligible_total,
               count(s.id) FILTER (WHERE s.bucket = 'delivered' AND NOT s.big_enough)          AS below_min,
               -- Would count once delivered.
               count(s.id) FILTER (WHERE s.bucket = 'open' AND s.big_enough)                   AS awaiting_orders,
               COALESCE(sum(s.net)   FILTER (WHERE s.bucket = 'open' AND s.big_enough), 0)     AS awaiting_sales,
               count(s.id) FILTER (WHERE s.bucket = 'returned')                                AS returned,
               count(s.id) FILTER (WHERE s.bucket = 'cancelled')                               AS cancelled
          FROM mods m LEFT JOIN scored s ON s.email = m.email
         GROUP BY m.email, m.rate, m.min_total
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'email', p.email,
               'is_me', p.email = v_me,
               'eligible_orders', p.eligible_orders,
               'eligible_sales', p.eligible_sales,     -- without shipping: what commission is paid on
               'eligible_total', p.eligible_total,     -- with shipping
               'aov', CASE WHEN p.eligible_orders > 0 THEN round(p.eligible_sales / p.eligible_orders, 2) END,
               'below_min', p.below_min,
               'awaiting_orders', p.awaiting_orders,
               'returned', p.returned,
               'cancelled', p.cancelled,
               'min_total', p.min_total,
               -- Pay: to the moderator it belongs to, and to managers.
               'rate', CASE WHEN v_manager OR p.email = v_me THEN p.rate END,
               'commission', CASE WHEN v_manager OR p.email = v_me THEN round(p.eligible_sales * p.rate / 100, 2) END,
               'awaiting_commission', CASE WHEN v_manager OR p.email = v_me THEN round(p.awaiting_sales * p.rate / 100, 2) END
           ) ORDER BY p.eligible_orders DESC, p.eligible_sales DESC), '[]'::jsonb)
      INTO v_rows
      FROM per p;

    RETURN jsonb_build_object(
        'configured', jsonb_array_length(v_rows) > 0,
        'is_manager', v_manager,
        'rows', v_rows);
END $$;

REVOKE ALL ON FUNCTION public.commission_board(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commission_board(UUID, DATE, DATE) TO authenticated;

-- Looked up per moderator and period.
CREATE INDEX IF NOT EXISTS idx_orders_business_closed_by_created
    ON public.orders (business_id, lower(trim(closed_by)), created_at);

NOTIFY pgrst, 'reload schema';

-- Rollback:
--   DROP FUNCTION IF EXISTS public.commission_board(UUID, DATE, DATE);
--   DROP TABLE IF EXISTS public.commission_settings;
--   DROP INDEX IF EXISTS public.idx_orders_business_closed_by_created;
