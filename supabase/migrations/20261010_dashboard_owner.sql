-- Migration: the owner's dashboard — what needs attention, and the money
-- Created At: 2026-10-10
-- Requires: 20261009_dashboard_overview.sql, 20261008_moderator_commission.sql,
--           20261001_payroll.sql
--
-- Three changes so the owner can run the day from the dashboard alone:
--
-- 1. dashboard_overview() also returns
--      fulfilment  confirmed orders not yet shipped (Pending, Processing,
--                  Prepared), how many have waited a day, and how many left
--                  today;
--      flags       store orders that cannot be confirmed as they stand: an
--                  item not linked to a product, or a total that disagrees
--                  with the store's.
--
-- 2. dashboard_money() — managers only — the period's money:
--      profit on delivered orders (orders.profit: total − cost − courier
--      fee), the courier fees thrown away on returns, the period's ads and
--      running costs from accounting (purchases left out: they are stock and
--      already inside each order's cost), and what is left; plus what is owed
--      to suppliers and whether last month's salaries were paid.
--      Treasury balances and money still with couriers come from the
--      functions the accounting and courier pages already use.
--
-- 3. commission_board() also returns, per moderator, every confirmed order —
--    count and sales — beside the delivered ones that earn commission, and
--    the orders that qualify but are still on their way: count, total with
--    shipping, sales without, and the commission waiting on them.
--    Commission is now open to the whole sales team: every member sees every
--    moderator's rate and commission, as the business asked, so the ranking
--    is a scoreboard everyone can read. (It was the moderator's own and
--    managers' only.)

-- ===========================================================================
-- 1. Overview
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.dashboard_overview(p_business_id UUID, p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me    TEXT := lower(auth.jwt() ->> 'email');
    v_days  INTEGER := (p_to - p_from) + 1;
    v_t0    TIMESTAMPTZ := p_from::timestamp AT TIME ZONE 'Africa/Cairo';
    v_t1    TIMESTAMPTZ := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo';
    v_p0    TIMESTAMPTZ := (p_from - v_days)::timestamp AT TIME ZONE 'Africa/Cairo';
    v_today DATE := (now() AT TIME ZONE 'Africa/Cairo')::date;
    v_result JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = p_business_id AND lower(bu.user_email) = v_me) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;

    WITH o AS (
        SELECT o.created_at >= v_t0 AS is_current,
               COALESCE(o.total_amount, 0) AS total,
               CASE
                   WHEN lower(trim(o.status)) = 'waiting'               THEN 'waiting'
                   WHEN o.status IN ('Cancelled', 'Unavailable')        THEN 'cancelled'
                   WHEN o.status IN ('Delivered', 'Collected')          THEN 'delivered'
                   WHEN o.status IN ('Returned', 'Returning')           THEN 'returned'
                   ELSE 'open'
               END AS bucket
          FROM public.orders o
         WHERE o.business_id = p_business_id
           AND o.created_at >= v_p0 AND o.created_at < v_t1
           AND COALESCE(o.order_type, 'new') = 'new'
    ),
    periods AS (
        SELECT is_current,
               jsonb_build_object(
                   'orders',    count(*),
                   'waiting',   count(*) FILTER (WHERE bucket = 'waiting'),
                   'cancelled', count(*) FILTER (WHERE bucket = 'cancelled'),
                   'confirmed', count(*) FILTER (WHERE bucket IN ('open', 'delivered', 'returned')),
                   'delivered', count(*) FILTER (WHERE bucket = 'delivered'),
                   'returned',  count(*) FILTER (WHERE bucket = 'returned'),
                   'sales',     COALESCE(sum(total) FILTER (WHERE bucket IN ('open', 'delivered', 'returned')), 0)
               ) AS figures
          FROM o GROUP BY is_current
    ),

    -- Store orders waiting right now, whatever the range.
    waiting AS (
        SELECT o.created_at, COALESCE(o.total_amount, 0) AS total,
               COALESCE(o.confirm_attempts, 0) AS attempts, o.last_attempt_at
          FROM public.orders o
         WHERE o.business_id = p_business_id
           AND lower(trim(o.status)) = 'waiting'
           AND (o.easyorders_id IS NOT NULL OR o.tags::text ILIKE '%easyorders%' OR o.tags::text ILIKE '%shopify%')
    ),
    platform AS (
        SELECT jsonb_build_object(
                   'waiting',        count(*),
                   'value',          COALESCE(sum(total), 0),
                   'new',            count(*) FILTER (WHERE attempts = 0),
                   'retry',          count(*) FILTER (WHERE attempts > 0),
                   'due',            count(*) FILTER (WHERE attempts > 0 AND last_attempt_at <= now() - interval '1 hour'),
                   'oldest_new_at',  min(created_at) FILTER (WHERE attempts = 0),
                   'oldest_at',      min(created_at)
               ) AS j
          FROM waiting
    ),
    confirmed_by AS (
        SELECT lower(trim(o.closed_by)) AS email, count(*) AS confirmed
          FROM public.orders o
         WHERE o.business_id = p_business_id
           AND o.created_at >= v_t0 AND o.created_at < v_t1
           AND NULLIF(trim(o.closed_by), '') IS NOT NULL
           AND lower(trim(o.status)) <> 'waiting'
           AND o.status NOT IN ('Cancelled', 'Unavailable')
           AND (o.easyorders_id IS NOT NULL OR o.tags::text ILIKE '%easyorders%' OR o.tags::text ILIKE '%shopify%')
         GROUP BY 1
    ),
    attempts_by AS (
        SELECT lower(trim(a.attempted_by)) AS email, count(*) AS failed_attempts, count(DISTINCT a.order_id) AS orders_tried
          FROM public.order_confirmation_attempts a
         WHERE a.business_id = p_business_id
           AND a.created_at >= v_t0 AND a.created_at < v_t1
           AND NULLIF(trim(a.attempted_by), '') IS NOT NULL
         GROUP BY 1
    ),
    platform_mods AS (
        SELECT COALESCE(c.email, a.email) AS email,
               COALESCE(c.confirmed, 0) AS confirmed,
               COALESCE(a.failed_attempts, 0) AS failed_attempts,
               COALESCE(a.orders_tried, 0) AS orders_tried
          FROM confirmed_by c FULL JOIN attempts_by a ON a.email = c.email
    ),

    -- Orders stuck with the courier right now.
    stuck AS (
        SELECT o.id, COALESCE(o.total_amount, 0) AS total
          FROM public.orders o
         WHERE o.business_id = p_business_id
           AND (lower(trim(o.status)) IN ('returning', 'hold to redeliver')
                OR (lower(trim(o.status)) = 'shipped'
                    AND COALESCE(o.status_changed_at, o.created_at) <= now() - interval '5 days'))
    ),
    last_followup AS (
        SELECT DISTINCT ON (f.order_id) f.order_id, f.outcome, f.next_action_at
          FROM public.shipping_followups f
         WHERE f.business_id = p_business_id AND f.order_id IN (SELECT id FROM stuck)
         ORDER BY f.order_id, f.created_at DESC
    ),
    shipping AS (
        SELECT jsonb_build_object(
                   'stuck',     count(*),
                   'value',     COALESCE(sum(s.total), 0),
                   'untouched', count(*) FILTER (WHERE l.order_id IS NULL),
                   'retry',     count(*) FILTER (WHERE l.outcome IS NOT NULL
                                                   AND l.outcome NOT IN ('reached_rescheduled', 'reached_confirmed', 'courier_contacted')),
                   'reached',   count(*) FILTER (WHERE l.outcome IN ('reached_rescheduled', 'reached_confirmed', 'courier_contacted')),
                   'due_today', count(*) FILTER (WHERE l.next_action_at IS NOT NULL AND l.next_action_at <= v_today)
               ) AS j
          FROM stuck s LEFT JOIN last_followup l ON l.order_id = s.id
    ),
    shipping_mods AS (
        SELECT lower(trim(f.created_by)) AS email,
               count(*) AS followups,
               count(DISTINCT f.order_id) AS orders,
               count(*) FILTER (WHERE f.outcome IN ('reached_rescheduled', 'reached_confirmed', 'courier_contacted')) AS reached
          FROM public.shipping_followups f
         WHERE f.business_id = p_business_id
           AND f.created_at >= v_t0 AND f.created_at < v_t1
           AND NULLIF(trim(f.created_by), '') IS NOT NULL
         GROUP BY 1
    ),

    -- Confirmed orders on their way out of the warehouse.
    fulfil AS (
        SELECT jsonb_build_object(
                   'pending',      count(*) FILTER (WHERE st = 'pending'),
                   'processing',   count(*) FILTER (WHERE st = 'processing'),
                   'prepared',     count(*) FILTER (WHERE st = 'prepared'),
                   'aged',         count(*) FILTER (WHERE since <= now() - interval '24 hours'),
                   'value',        COALESCE(sum(total), 0),
                   'oldest_at',    min(since),
                   'shipped_today', (SELECT count(*) FROM public.orders s
                                      WHERE s.business_id = p_business_id
                                        AND lower(trim(s.status)) = 'shipped'
                                        AND s.status_changed_at >= (v_today::timestamp AT TIME ZONE 'Africa/Cairo'))
               ) AS j
          FROM (SELECT lower(trim(o.status)) AS st, COALESCE(o.status_changed_at, o.created_at) AS since,
                       COALESCE(o.total_amount, 0) AS total
                  FROM public.orders o
                 WHERE o.business_id = p_business_id
                   AND lower(trim(o.status)) IN ('pending', 'processing', 'prepared')) f
    ),

    -- Store orders that cannot be confirmed as they stand.
    flags AS (
        SELECT jsonb_build_object(
                   'unmapped', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.order_items i
                                                              WHERE i.order_id = w.id AND i.variant_id IS NULL)),
                   'mismatch', count(*) FILTER (WHERE w.tags::text ILIKE '%total-mismatch%')
               ) AS j
          FROM public.orders w
         WHERE w.business_id = p_business_id
           AND lower(trim(w.status)) = 'waiting'
    )
    SELECT jsonb_build_object(
        'period',   COALESCE((SELECT figures FROM periods WHERE is_current), '{}'::jsonb),
        'previous', COALESCE((SELECT figures FROM periods WHERE NOT is_current), '{}'::jsonb),
        'platform', (SELECT j FROM platform),
        'platform_moderators', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.confirmed DESC, m.failed_attempts DESC) FROM platform_mods m), '[]'::jsonb),
        'shipping', (SELECT j FROM shipping),
        'shipping_moderators', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'email', m.email, 'followups', m.followups, 'orders', m.orders,
                'reached', m.reached, 'failed', m.followups - m.reached) ORDER BY m.followups DESC) FROM shipping_mods m), '[]'::jsonb),
        'fulfilment', (SELECT j FROM fulfil),
        'flags', (SELECT j FROM flags),
        'me', v_me
    ) INTO v_result;

    RETURN v_result;
END $$;



-- ===========================================================================
-- 2. Money
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.dashboard_money(p_business_id UUID, p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me      TEXT := lower(auth.jwt() ->> 'email');
    v_t0      TIMESTAMPTZ := p_from::timestamp AT TIME ZONE 'Africa/Cairo';
    v_t1      TIMESTAMPTZ := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo';
    v_month   DATE := date_trunc('month', (now() AT TIME ZONE 'Africa/Cairo'))::date;
    v_result  JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = p_business_id AND lower(bu.user_email) = v_me) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.is_business_manager(p_business_id) THEN
        RETURN jsonb_build_object('allowed', false);
    END IF;

    WITH o AS (
        SELECT o.status, COALESCE(o.profit, 0) AS profit, COALESCE(o.total_amount, 0) AS total,
               COALESCE(o.actual_shipping_cost, 0) AS courier_fee
          FROM public.orders o
         WHERE o.business_id = p_business_id
           AND o.created_at >= v_t0 AND o.created_at < v_t1
           AND COALESCE(o.order_type, 'new') = 'new'
    ),
    ex AS (
        SELECT lower(btrim(COALESCE(t.category, ''))) AS cat, max(t.category) AS label, sum(abs(t.amount)) AS amount
          FROM public.transactions t
         WHERE t.business_id = p_business_id
           AND lower(btrim(COALESCE(t.type, ''))) = 'expense'
           AND t.transaction_date >= p_from AND t.transaction_date <= p_to
           AND lower(btrim(COALESCE(t.category, ''))) <> 'purchases'
         GROUP BY 1
    ),
    -- Last month's salaries: who had a salary and no payslip for it.
    unpaid AS (
        SELECT count(*) AS n, COALESCE(sum(es.monthly_salary), 0) AS amount
          FROM public.employee_salaries es
         WHERE es.business_id = p_business_id
           AND es.monthly_salary > 0
           AND NOT EXISTS (SELECT 1 FROM public.payslips p
                            WHERE p.business_user_id = es.business_user_id
                              AND p.period = (v_month - interval '1 month')::date)
    )
    SELECT jsonb_build_object(
        'allowed', true,
        'delivered_orders', (SELECT count(*) FROM o WHERE status IN ('Delivered', 'Collected')),
        'delivered_sales',  (SELECT COALESCE(sum(total), 0) FROM o WHERE status IN ('Delivered', 'Collected')),
        'delivered_profit', (SELECT COALESCE(sum(profit), 0) FROM o WHERE status IN ('Delivered', 'Collected')),
        'returned_orders',  (SELECT count(*) FROM o WHERE status IN ('Returned', 'Returning')),
        'return_shipping',  (SELECT COALESCE(sum(courier_fee), 0) FROM o WHERE status IN ('Returned', 'Returning')),
        'ads',              (SELECT COALESCE(sum(amount), 0) FROM ex WHERE cat = 'ads'),
        'opex',             (SELECT COALESCE(sum(amount), 0) FROM ex WHERE cat <> 'ads'),
        'expenses_by_category', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', label, 'amount', amount) ORDER BY amount DESC) FROM ex), '[]'::jsonb),
        'payables',         public.get_total_payables(p_business_id),
        'unpaid_salaries',  (SELECT jsonb_build_object('month', (v_month - interval '1 month')::date, 'count', n, 'amount', amount) FROM unpaid)
    ) INTO v_result;
    RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.dashboard_money(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_money(UUID, DATE, DATE) TO authenticated;

-- ===========================================================================
-- 3. Commission
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
               -- Every order they confirmed, whatever its size or where it is now.
               count(s.id) FILTER (WHERE s.bucket IN ('open', 'delivered', 'returned'))           AS confirmed_orders,
               COALESCE(sum(s.net) FILTER (WHERE s.bucket IN ('open', 'delivered', 'returned')), 0) AS confirmed_sales,
               count(s.id) FILTER (WHERE s.bucket = 'delivered' AND s.big_enough)              AS eligible_orders,
               COALESCE(sum(s.net)   FILTER (WHERE s.bucket = 'delivered' AND s.big_enough), 0) AS eligible_sales,
               COALESCE(sum(s.total) FILTER (WHERE s.bucket = 'delivered' AND s.big_enough), 0) AS eligible_total,
               count(s.id) FILTER (WHERE s.bucket = 'delivered' AND NOT s.big_enough)          AS below_min,
               -- Would count once delivered.
               count(s.id) FILTER (WHERE s.bucket = 'open' AND s.big_enough)                   AS awaiting_orders,
               COALESCE(sum(s.net)   FILTER (WHERE s.bucket = 'open' AND s.big_enough), 0)     AS awaiting_sales,
               COALESCE(sum(s.total) FILTER (WHERE s.bucket = 'open' AND s.big_enough), 0)     AS awaiting_total,
               count(s.id) FILTER (WHERE s.bucket = 'returned')                                AS returned,
               count(s.id) FILTER (WHERE s.bucket = 'cancelled')                               AS cancelled
          FROM mods m LEFT JOIN scored s ON s.email = m.email
         GROUP BY m.email, m.rate, m.min_total
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'email', p.email,
               'is_me', p.email = v_me,
               'confirmed_orders', p.confirmed_orders,
               'confirmed_sales', p.confirmed_sales,
               'awaiting_sales', p.awaiting_sales,
               'awaiting_total', p.awaiting_total,
               'eligible_orders', p.eligible_orders,
               'eligible_sales', p.eligible_sales,     -- without shipping: what commission is paid on
               'eligible_total', p.eligible_total,     -- with shipping
               'aov', CASE WHEN p.eligible_orders > 0 THEN round(p.eligible_sales / p.eligible_orders, 2) END,
               'below_min', p.below_min,
               'awaiting_orders', p.awaiting_orders,
               'returned', p.returned,
               'cancelled', p.cancelled,
               'min_total', p.min_total,
               -- Open to the whole team.
               'rate', p.rate,
               'commission', round(p.eligible_sales * p.rate / 100, 2),
               'awaiting_commission', round(p.awaiting_sales * p.rate / 100, 2)
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
GRANT EXECUTE ON FUNCTION public.dashboard_overview(UUID, DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Rollback: run 20261009_dashboard_overview.sql and the function in
-- 20261008_moderator_commission.sql again, then
--   DROP FUNCTION IF EXISTS public.dashboard_money(UUID, DATE, DATE);
