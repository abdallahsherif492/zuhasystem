-- Migration: who signed up, and how far they got
-- Created At: 2026-09-23
--
-- Of 26 people who signed up from ads since July, 21 created a store, 3 added
-- a product, none connected EasyOrders or added a courier, and one came back
-- another day. Nobody knew, because signups live in auth.users, which the app
-- cannot read, and the phone number was optional.
--
-- This lists recent signups for System Admins only: contact details, their
-- store, and how far setup went, so each one can get a WhatsApp message the
-- same day. Read-only; it changes nothing.

CREATE OR REPLACE FUNCTION public.admin_new_signups(p_days INT DEFAULT 60)
RETURNS TABLE (
    user_id            UUID,
    user_email         TEXT,
    full_name          TEXT,
    phone              TEXT,
    signed_up_at       TIMESTAMPTZ,
    email_confirmed    BOOLEAN,
    last_sign_in_at    TIMESTAMPTZ,
    business_id        UUID,
    business_name      TEXT,
    product_count      BIGINT,
    order_count        BIGINT,
    courier_count      BIGINT,
    platform_connected BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
#variable_conflict use_column
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE lower(bu.user_email) = lower(auth.jwt() ->> 'email')
          AND bu.role ILIKE '%super%'
    ) THEN
        RAISE EXCEPTION 'system admins only';
    END IF;

    RETURN QUERY
    SELECT
        u.id,
        u.email::TEXT,
        NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
        NULLIF(u.raw_user_meta_data ->> 'phone', ''),
        u.created_at,
        u.email_confirmed_at IS NOT NULL,
        u.last_sign_in_at,
        b.id,
        b.name,
        (SELECT COUNT(*) FROM public.products p WHERE p.business_id = b.id),
        (SELECT COUNT(*) FROM public.orders o WHERE o.business_id = b.id),
        (SELECT COUNT(*) FROM public.shipping_companies s WHERE s.business_id = b.id),
        COALESCE(
            (b.theme_config -> 'integrations' -> 'platforms' -> 'easyorders' ->> 'webhookToken') IS NOT NULL
            OR (b.theme_config ->> 'easyorders_token') IS NOT NULL
            OR (b.theme_config -> 'integrations' -> 'platforms' -> 'shopify' ->> 'enabled') = 'true',
            FALSE)
    FROM auth.users u
    LEFT JOIN LATERAL (
        SELECT bz.id, bz.name, bz.theme_config
        FROM public.business_users bu
        JOIN public.businesses bz ON bz.id = bu.business_id
        WHERE lower(bu.user_email) = lower(u.email)
        ORDER BY bz.created_at
        LIMIT 1
    ) b ON TRUE
    WHERE u.created_at >= now() - make_interval(days => GREATEST(p_days, 1))
    ORDER BY u.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_new_signups(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_new_signups(INT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Verify (as a System Admin, from the app): /system-admin/signups lists them.
-- Rollback: DROP FUNCTION IF EXISTS public.admin_new_signups(INT);
