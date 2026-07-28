-- Migration: record live sessions through a definer function
-- Created At: 2026-07-29
--
-- Fixes: only System Admins' sessions were ever recorded.
--
-- The client upserts on session_id, and PostgreSQL's INSERT ... ON CONFLICT
-- DO UPDATE has to read the conflicting row — which means the caller needs a
-- SELECT policy on the table. Reading platform traffic is deliberately
-- restricted to System Admins, so every other visitor's write was rejected
-- with "new row violates row-level security policy". Anonymous visitors on
-- /landing, /login and /register could never be recorded at all.
--
-- Routing writes through a SECURITY DEFINER function decouples "may I report
-- my own presence" (everyone) from "may I read everyone's presence" (admins
-- only), and lets the identity be taken from the JWT server-side so a client
-- cannot report itself as somebody else.

CREATE OR REPLACE FUNCTION public.record_live_session(
    p_session_id      TEXT,
    p_page_path       TEXT,
    p_business_id     UUID        DEFAULT NULL,
    p_business_name   TEXT        DEFAULT NULL,
    p_page_title      TEXT        DEFAULT NULL,
    p_page_entered_at TIMESTAMPTZ DEFAULT NULL,
    p_page_views      INTEGER     DEFAULT 1,
    p_device_type     TEXT        DEFAULT NULL,
    p_browser         TEXT        DEFAULT NULL,
    p_os              TEXT        DEFAULT NULL,
    p_screen_size     TEXT        DEFAULT NULL,
    p_viewport        TEXT        DEFAULT NULL,
    p_language        TEXT        DEFAULT NULL,
    p_timezone        TEXT        DEFAULT NULL,
    p_referrer        TEXT        DEFAULT NULL,
    p_entry_page      TEXT        DEFAULT NULL,
    p_is_idle         BOOLEAN     DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- Never trust the client for identity.
    v_email TEXT := auth.jwt() ->> 'email';
BEGIN
    -- Cheap sanity limits: this endpoint is callable with the public anon key,
    -- so keep a stray or malicious caller from writing unbounded junk.
    IF p_session_id IS NULL OR length(p_session_id) > 100 THEN
        RETURN;
    END IF;
    IF p_page_path IS NULL OR length(p_page_path) > 500 THEN
        RETURN;
    END IF;

    INSERT INTO public.live_sessions AS ls (
        session_id, user_email, business_id, business_name,
        page_path, page_title, page_entered_at, page_views,
        device_type, browser, os, screen_size, viewport,
        language, timezone, referrer, entry_page,
        is_idle, started_at, last_seen_at
    )
    VALUES (
        p_session_id,
        v_email,
        -- A signed-out visitor has no tenant, whatever the client claims.
        CASE WHEN v_email IS NULL THEN NULL ELSE p_business_id END,
        CASE WHEN v_email IS NULL THEN NULL ELSE p_business_name END,
        p_page_path,
        left(p_page_title, 300),
        COALESCE(p_page_entered_at, NOW()),
        GREATEST(COALESCE(p_page_views, 1), 1),
        left(p_device_type, 20), left(p_browser, 50), left(p_os, 50),
        left(p_screen_size, 20), left(p_viewport, 20),
        left(p_language, 20), left(p_timezone, 60),
        left(p_referrer, 500), left(p_entry_page, 500),
        COALESCE(p_is_idle, false),
        NOW(), NOW()
    )
    ON CONFLICT (session_id) DO UPDATE SET
        user_email      = EXCLUDED.user_email,
        business_id     = EXCLUDED.business_id,
        business_name   = EXCLUDED.business_name,
        page_path       = EXCLUDED.page_path,
        page_title      = EXCLUDED.page_title,
        page_entered_at = EXCLUDED.page_entered_at,
        page_views      = EXCLUDED.page_views,
        device_type     = EXCLUDED.device_type,
        browser         = EXCLUDED.browser,
        os              = EXCLUDED.os,
        screen_size     = EXCLUDED.screen_size,
        viewport        = EXCLUDED.viewport,
        language        = EXCLUDED.language,
        timezone        = EXCLUDED.timezone,
        referrer        = EXCLUDED.referrer,
        entry_page      = EXCLUDED.entry_page,
        is_idle         = EXCLUDED.is_idle,
        last_seen_at    = NOW()
    -- started_at is intentionally never updated: it is when the tab opened.
    WHERE ls.session_id = EXCLUDED.session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_live_session(
    TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT,
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) TO anon, authenticated;

-- Direct client writes are no longer used; the function is the only path in.
-- Reading stays restricted to System Admins via the existing SELECT policy.
DROP POLICY IF EXISTS "Users can write their own session" ON public.live_sessions;
DROP POLICY IF EXISTS "Users can update their own session" ON public.live_sessions;
DROP POLICY IF EXISTS "Anonymous visitors can write anonymous sessions" ON public.live_sessions;
DROP POLICY IF EXISTS "Anonymous visitors can update anonymous sessions" ON public.live_sessions;
