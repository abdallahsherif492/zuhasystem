-- Migration: the dashboard's overview, in one call
-- Created At: 2026-10-09
-- Requires: 20260825_shipping_issues.sql, 20261006_confirmation_attempts.sql,
--           20261007_shipping_followup_reasons.sql
--
-- The dashboard now opens with two questions: how did the period go, and what
-- work is waiting for the moderators. dashboard_overview() answers both for a
-- date range, in one small JSON document — replacing the pages of orders the
-- dashboard used to download on every visit to count them in the browser.
--
--   period / previous   orders, confirmed, cancelled, waiting, delivered,
--                       returned and confirmed sales for the range and for the
--                       same-length range before it
--   platform            store orders waiting to be confirmed right now: new,
--                       to retry, due for another call, the oldest one
--   platform_moderators per moderator in the range: store orders they
--                       confirmed, and failed confirmation attempts recorded
--   shipping            orders stuck with the courier right now, by how far
--                       following them up has got
--   shipping_moderators per moderator in the range: follow-up calls, and how
--                       many reached someone
--
-- Definitions match the pages they summarise:
--   confirmed  = not Waiting and not Cancelled / Unavailable
--   delivered  = Delivered, Collected;  returned = Returned, Returning
--   stuck      = Returning, Hold To redeliver, or Shipped for 5+ days
-- Orders are dated by when they were placed, in Cairo time; attempts and
-- follow-ups by when they were recorded. Replacement and return orders are
-- left out of the period figures.

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
        'me', v_me
    ) INTO v_result;

    RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.dashboard_overview(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_overview(UUID, DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Rollback:
--   DROP FUNCTION IF EXISTS public.dashboard_overview(UUID, DATE, DATE);
