-- Migration: channel analytics, computed in the database
-- Created At: 2026-10-04
--
-- The Channels page showed nothing: get_channel_performance() reads
-- orders.source, a column that does not exist (it is `channel`), so every
-- call failed. It also only counted orders and revenue.
--
-- channel_analytics() replaces it for that page. It returns one JSON
-- document for a date range — per channel, per day, top products, and ad
-- spend per ad group — so the page downloads a few kilobytes instead of
-- every order in the range (a month is ~2,400 orders here). It also breaks
-- each channel down by moderator — orders.closed_by, the e-mail of whoever
-- confirmed the order — so the page shows who handled how many, and how
-- those orders ended.
--
-- Channels are typed by hand and the data shows it ("WhatsApp ", "Websit",
-- "instagram"), so they are normalised before grouping. Each channel also
-- belongs to an ad group, the same one ads are uploaded under: messages
-- (Facebook, WhatsApp, Instagram), website, tiktok.
--
-- Statuses, as everywhere else in the app:
--   cancelled  Cancelled, Unavailable
--   delivered  Delivered, Collected
--   returned   Returned, Returning
--   open       anything else (pending, prepared, shipped, ...)
--
-- Runs as the caller (SECURITY INVOKER), so the orders it reads are the
-- ones the caller's RLS already allows. Dates are Cairo days.

CREATE OR REPLACE FUNCTION public.normalize_order_channel(p_channel TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN c = '' THEN 'غير محدد'
        WHEN c IN ('website', 'websit', 'web', 'site', 'easyorders', 'easy orders') THEN 'Website'
        WHEN c = 'shopify' THEN 'Shopify'
        WHEN c LIKE 'tiktok%web%' OR c LIKE 'tik tok%web%' THEN 'TikTok Website'
        WHEN c LIKE 'tiktok%' OR c LIKE 'tik tok%' THEN 'TikTok'
        WHEN c IN ('facebook', 'fb', 'messenger', 'facebook messenger') THEN 'Facebook'
        WHEN c IN ('whatsapp', 'whats app', 'wa', 'whatsup') THEN 'WhatsApp'
        WHEN c IN ('instagram', 'insta', 'ig') THEN 'Instagram'
        ELSE initcap(c)
    END
    FROM (SELECT lower(regexp_replace(trim(COALESCE(p_channel, '')), '\s+', ' ', 'g')) AS c) x;
$$;

CREATE OR REPLACE FUNCTION public.order_channel_group(p_channel TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_channel IN ('Facebook', 'WhatsApp', 'Instagram') THEN 'messages'
        WHEN p_channel IN ('Website', 'Shopify') THEN 'website'
        WHEN p_channel IN ('TikTok', 'TikTok Website') THEN 'tiktok'
        ELSE 'other'
    END;
$$;

CREATE OR REPLACE FUNCTION public.channel_analytics(p_business_id UUID, p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH bounds AS (
    SELECT (p_from::timestamp AT TIME ZONE 'Africa/Cairo') AS t0,
           ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo') AS t1
),
o AS (
    SELECT o.id, o.customer_id, o.created_at, o.total_amount, o.total_cost,
           NULLIF(lower(trim(o.closed_by)), '') AS moderator,
           o.actual_shipping_cost, o.profit,
           public.normalize_order_channel(o.channel) AS channel,
           (o.created_at AT TIME ZONE 'Africa/Cairo')::date AS day,
           CASE
               WHEN o.status IN ('Cancelled', 'Unavailable') THEN 'cancelled'
               WHEN o.status IN ('Delivered', 'Collected')    THEN 'delivered'
               WHEN o.status IN ('Returned', 'Returning')     THEN 'returned'
               ELSE 'open'
           END AS bucket
      FROM public.orders o, bounds b
     WHERE o.business_id = p_business_id
       AND o.created_at >= b.t0 AND o.created_at < b.t1
       AND COALESCE(o.order_type, 'new') = 'new'
),
-- A customer is returning when they had an order that was not cancelled
-- before this one, at any time.
o2 AS (
    SELECT o.*,
           (o.customer_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.orders p
                WHERE p.business_id = p_business_id
                  AND p.customer_id = o.customer_id
                  AND p.created_at < o.created_at
                  AND p.status NOT IN ('Cancelled', 'Unavailable'))) AS is_returning
      FROM o
),
per_channel AS (
    SELECT channel,
           public.order_channel_group(channel) AS ad_group,
           count(*)                                                     AS orders,
           count(*) FILTER (WHERE bucket = 'cancelled')                 AS cancelled,
           count(*) FILTER (WHERE bucket = 'delivered')                 AS delivered,
           count(*) FILTER (WHERE bucket = 'returned')                  AS returned,
           count(*) FILTER (WHERE bucket = 'open')                      AS open,
           COALESCE(sum(total_amount) FILTER (WHERE bucket <> 'cancelled'), 0) AS sales,
           COALESCE(sum(total_amount) FILTER (WHERE bucket = 'delivered'), 0)  AS delivered_sales,
           COALESCE(sum(profit)       FILTER (WHERE bucket = 'delivered'), 0)  AS delivered_profit,
           COALESCE(sum(actual_shipping_cost) FILTER (WHERE bucket = 'returned'), 0) AS return_shipping,
           count(DISTINCT customer_id) FILTER (WHERE bucket <> 'cancelled')    AS customers,
           count(*) FILTER (WHERE bucket <> 'cancelled' AND is_returning)          AS returning_orders
      FROM o2
     GROUP BY channel
),
units AS (
    SELECT o.channel, COALESCE(sum(i.quantity), 0) AS units
      FROM o JOIN public.order_items i ON i.order_id = o.id
     WHERE o.bucket <> 'cancelled'
     GROUP BY o.channel
),
daily AS (
    SELECT day, channel,
           count(*) AS orders,
           count(*) FILTER (WHERE bucket <> 'cancelled') AS confirmed,
           COALESCE(sum(total_amount) FILTER (WHERE bucket <> 'cancelled'), 0) AS sales
      FROM o GROUP BY day, channel
),
products AS (
    SELECT o.channel, v.product_id, pr.name,
           sum(i.quantity) AS units,
           sum(i.quantity * i.price_at_sale) AS sales,
           count(DISTINCT o.id) AS orders,
           count(DISTINCT o.id) FILTER (WHERE o.bucket = 'delivered') AS delivered,
           count(DISTINCT o.id) FILTER (WHERE o.bucket = 'returned')  AS returned,
           row_number() OVER (PARTITION BY o.channel ORDER BY sum(i.quantity) DESC) AS rn
      FROM o
      JOIN public.order_items i ON i.order_id = o.id
      JOIN public.variants v    ON v.id = i.variant_id
      JOIN public.products pr   ON pr.id = v.product_id
     WHERE o.bucket <> 'cancelled'
     GROUP BY o.channel, v.product_id, pr.name
),
moderators AS (
    SELECT moderator, channel,
           count(*)                                      AS orders,
           count(*) FILTER (WHERE bucket = 'cancelled')  AS cancelled,
           count(*) FILTER (WHERE bucket = 'delivered')  AS delivered,
           count(*) FILTER (WHERE bucket = 'returned')   AS returned,
           count(*) FILTER (WHERE bucket = 'open')       AS open,
           COALESCE(sum(total_amount) FILTER (WHERE bucket <> 'cancelled'), 0) AS sales,
           COALESCE(sum(total_amount) FILTER (WHERE bucket = 'delivered'), 0)  AS delivered_sales
      FROM o GROUP BY moderator, channel
),
ads AS (
    SELECT CASE
               WHEN platform = 'Meta - Messages' THEN 'messages'
               WHEN platform = 'Meta - Website' THEN 'website'
               WHEN platform ILIKE 'tiktok%' THEN 'tiktok'
               ELSE 'unassigned'
           END AS ad_group,
           sum(amount) AS spend
      FROM public.ads_expenses
     WHERE business_id = p_business_id AND ad_date BETWEEN p_from AND p_to
     GROUP BY 1
)
SELECT jsonb_build_object(
    'channels', COALESCE((SELECT jsonb_agg(to_jsonb(c) || jsonb_build_object('units', COALESCE(u.units, 0)) ORDER BY c.orders DESC)
                            FROM per_channel c LEFT JOIN units u USING (channel)), '[]'::jsonb),
    'daily',    COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day) FROM daily d), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(jsonb_build_object('channel', channel, 'product_id', product_id, 'name', name,
                                                              'units', units, 'sales', sales, 'orders', orders,
                                                              'delivered', delivered, 'returned', returned) ORDER BY channel, rn)
                            FROM products WHERE rn <= 8), '[]'::jsonb),
    'moderators', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.moderator NULLS LAST, m.orders DESC) FROM moderators m), '[]'::jsonb),
    'ads',      COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM ads a), '[]'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION public.channel_analytics(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_order_channel(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_channel_group(TEXT) TO authenticated;

-- The returning-customer check looks up earlier orders per customer.
CREATE INDEX IF NOT EXISTS idx_orders_business_customer_created
    ON public.orders (business_id, customer_id, created_at);

NOTIFY pgrst, 'reload schema';

-- Rollback:
--   DROP FUNCTION IF EXISTS public.channel_analytics(UUID, DATE, DATE);
--   DROP FUNCTION IF EXISTS public.order_channel_group(TEXT);
--   DROP FUNCTION IF EXISTS public.normalize_order_channel(TEXT);
--   DROP INDEX IF EXISTS public.idx_orders_business_customer_created;
