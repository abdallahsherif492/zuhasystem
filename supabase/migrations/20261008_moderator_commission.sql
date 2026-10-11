-- Migration: moderator commission
-- Created At: 2026-10-08
--
-- Moderators earn a share of the orders they close. Per moderator, set in
-- Settings:
--   rate        percent of the order's total
--   min_units   the fewest pieces an order must have to count
-- and once for the business, which orders earn it:
--   basis       'delivered'  only orders that were delivered (default — a
--                            cancelled or returned order earned nothing)
--               'confirmed'  every order the moderator confirmed
--
-- An order belongs to the moderator in orders.closed_by, the same link the
-- moderators league already ranks by. commission_board() returns the board
-- for a period. Everyone in the business sees the ranking — orders, average
-- order value, sales — but a commission figure and a rate only to its own
-- moderator and to managers.

-- ===========================================================================
-- 1. Settings
-- ===========================================================================
-- One row per moderator, plus one with user_email = '*' for the business:
-- the basis, and the defaults offered for new moderators.
CREATE TABLE IF NOT EXISTS public.commission_settings (
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_email  TEXT NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    rate        NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (rate >= 0 AND rate <= 100),
    min_units   INTEGER NOT NULL DEFAULT 1 CHECK (min_units >= 0),
    basis       TEXT NOT NULL DEFAULT 'delivered' CHECK (basis IN ('delivered', 'confirmed')),
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
    v_basis   TEXT;
    v_rows    JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = p_business_id AND lower(bu.user_email) = v_me) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_manager := public.is_business_manager(p_business_id);

    SELECT basis INTO v_basis FROM public.commission_settings
     WHERE business_id = p_business_id AND user_email = '*';
    v_basis := COALESCE(v_basis, 'delivered');

    WITH mods AS (
        SELECT lower(user_email) AS email, rate, min_units
          FROM public.commission_settings
         WHERE business_id = p_business_id AND user_email <> '*' AND enabled
    ),
    o AS (
        SELECT o.id, lower(trim(o.closed_by)) AS email, o.total_amount,
               COALESCE((SELECT sum(i.quantity) FROM public.order_items i WHERE i.order_id = o.id), 0) AS units,
               CASE
                   WHEN o.status IN ('Delivered', 'Collected')            THEN 'delivered'
                   WHEN o.status IN ('Returned', 'Returning')             THEN 'returned'
                   WHEN o.status IN ('Cancelled', 'Unavailable')          THEN 'cancelled'
                   WHEN lower(trim(o.status)) = 'waiting'                 THEN 'waiting'
                   ELSE 'open'
               END AS bucket
          FROM public.orders o
         WHERE o.business_id = p_business_id
           AND o.created_at >= (p_from::timestamp AT TIME ZONE 'Africa/Cairo')
           AND o.created_at <  ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo')
           AND COALESCE(o.order_type, 'new') = 'new'
           AND lower(trim(o.closed_by)) IN (SELECT email FROM mods)
    ),
    -- What would count once delivered, under the delivered basis: confirmed
    -- and still on its way.
    scored AS (
        SELECT o.*, m.rate, m.min_units,
               (o.units >= m.min_units) AS enough_units,
               CASE v_basis
                   WHEN 'delivered' THEN o.bucket = 'delivered'
                   ELSE o.bucket IN ('delivered', 'open', 'returned')
               END AS counts,
               (v_basis = 'delivered' AND o.bucket = 'open') AS awaiting
          FROM o JOIN mods m ON m.email = o.email
    ),
    per AS (
        SELECT m.email, m.rate, m.min_units,
               count(s.id) FILTER (WHERE s.bucket <> 'cancelled' AND s.bucket <> 'waiting')      AS confirmed_orders,
               count(s.id) FILTER (WHERE s.counts AND s.enough_units)                            AS eligible_orders,
               COALESCE(sum(s.total_amount) FILTER (WHERE s.counts AND s.enough_units), 0)       AS eligible_sales,
               COALESCE(sum(s.units) FILTER (WHERE s.counts AND s.enough_units), 0)              AS eligible_units,
               count(s.id) FILTER (WHERE s.counts AND NOT s.enough_units)                        AS below_min,
               count(s.id) FILTER (WHERE s.awaiting AND s.enough_units)                          AS awaiting_orders,
               COALESCE(sum(s.total_amount) FILTER (WHERE s.awaiting AND s.enough_units), 0)     AS awaiting_sales,
               count(s.id) FILTER (WHERE s.bucket = 'returned')                                  AS returned,
               count(s.id) FILTER (WHERE s.bucket = 'cancelled')                                 AS cancelled
          FROM mods m LEFT JOIN scored s ON s.email = m.email
         GROUP BY m.email, m.rate, m.min_units
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'email', p.email,
               'is_me', p.email = v_me,
               'confirmed_orders', p.confirmed_orders,
               'eligible_orders', p.eligible_orders,
               'eligible_sales', p.eligible_sales,
               'eligible_units', p.eligible_units,
               'aov', CASE WHEN p.eligible_orders > 0 THEN round(p.eligible_sales / p.eligible_orders, 2) END,
               'below_min', p.below_min,
               'awaiting_orders', p.awaiting_orders,
               'returned', p.returned,
               'cancelled', p.cancelled,
               'min_units', p.min_units,
               -- Pay: to the moderator it belongs to, and to managers.
               'rate', CASE WHEN v_manager OR p.email = v_me THEN p.rate END,
               'commission', CASE WHEN v_manager OR p.email = v_me THEN round(p.eligible_sales * p.rate / 100, 2) END,
               'awaiting_commission', CASE WHEN v_manager OR p.email = v_me THEN round(p.awaiting_sales * p.rate / 100, 2) END
           ) ORDER BY p.eligible_orders DESC, p.eligible_sales DESC), '[]'::jsonb)
      INTO v_rows
      FROM per p;

    RETURN jsonb_build_object(
        'configured', jsonb_array_length(v_rows) > 0,
        'basis', v_basis,
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
