-- Migration: Live session tracking for the System Admin real-time analytics page
-- Created At: 2026-07-29

-- One row per open browser tab. The client heartbeats into it; "live" is
-- simply a row whose last_seen_at is recent, so a crashed tab ages out on its
-- own without needing an explicit "session ended" signal.
CREATE TABLE IF NOT EXISTS public.live_sessions (
    session_id      TEXT PRIMARY KEY,
    user_email      TEXT,
    business_id     UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    business_name   TEXT,

    -- Where they are right now
    page_path       TEXT NOT NULL,
    page_title      TEXT,
    page_entered_at TIMESTAMPTZ DEFAULT NOW(),
    page_views      INTEGER DEFAULT 1,

    -- Who / what they are on
    device_type     TEXT,   -- mobile | tablet | desktop
    browser         TEXT,
    os              TEXT,
    screen_size     TEXT,
    viewport        TEXT,
    language        TEXT,
    timezone        TEXT,
    referrer        TEXT,
    entry_page      TEXT,

    is_idle         BOOLEAN DEFAULT false,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS live_sessions_last_seen_idx ON public.live_sessions (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS live_sessions_business_idx  ON public.live_sessions (business_id);

ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;

-- Reading the whole platform's traffic is a System Admin power.
DROP POLICY IF EXISTS "System Admins can read live sessions" ON public.live_sessions;
CREATE POLICY "System Admins can read live sessions"
ON public.live_sessions FOR SELECT
TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email')
    OR EXISTS (
        SELECT 1 FROM public.business_users
        WHERE user_email = auth.jwt() ->> 'email' AND role ILIKE '%super%'
    )
);

-- A signed-in visitor may only write the row describing their own session.
DROP POLICY IF EXISTS "Users can write their own session" ON public.live_sessions;
CREATE POLICY "Users can write their own session"
ON public.live_sessions FOR INSERT
TO authenticated
WITH CHECK (user_email = auth.jwt() ->> 'email');

DROP POLICY IF EXISTS "Users can update their own session" ON public.live_sessions;
CREATE POLICY "Users can update their own session"
ON public.live_sessions FOR UPDATE
TO authenticated
USING (user_email = auth.jwt() ->> 'email')
WITH CHECK (user_email = auth.jwt() ->> 'email');

-- Anonymous marketing-page visitors are tracked too, but may only ever write
-- rows that claim no identity. They can never read anything back.
DROP POLICY IF EXISTS "Anonymous visitors can write anonymous sessions" ON public.live_sessions;
CREATE POLICY "Anonymous visitors can write anonymous sessions"
ON public.live_sessions FOR INSERT
TO anon
WITH CHECK (user_email IS NULL AND business_id IS NULL);

DROP POLICY IF EXISTS "Anonymous visitors can update anonymous sessions" ON public.live_sessions;
CREATE POLICY "Anonymous visitors can update anonymous sessions"
ON public.live_sessions FOR UPDATE
TO anon
USING (user_email IS NULL)
WITH CHECK (user_email IS NULL AND business_id IS NULL);

-- Housekeeping: drop sessions nobody has touched in a day. Called by the
-- analytics page on load so the table cannot grow without bound even if no
-- scheduled job is configured.
CREATE OR REPLACE FUNCTION public.prune_live_sessions()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM public.live_sessions WHERE last_seen_at < NOW() - INTERVAL '1 day';
$$;

GRANT EXECUTE ON FUNCTION public.prune_live_sessions() TO authenticated;

-- Let the admin page receive row changes over Realtime instead of polling
-- hard. Wrapped because re-adding a table to the publication errors.
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_sessions;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
END $$;
