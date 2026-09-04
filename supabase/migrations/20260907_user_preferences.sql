-- Migration: the interface language belongs to the person, not the tenant
-- Created At: 2026-09-07
--
-- Language and layout direction lived in businesses.theme_config, so one
-- setting decided what every member of a business saw. On a team where the
-- accountant reads English and the moderators read Arabic, one of them was
-- always working in the wrong language, and changing it changed it for
-- everyone.
--
-- The business value is kept and still applies — it is the default a new
-- member starts on. This table only records a person overriding it.
--
-- Keyed on auth.uid() rather than an email so it survives someone changing
-- their address, and so the policy can be a plain equality check.

CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id    UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    language   TEXT CHECK (language IN ('en', 'ar')),
    direction  TEXT CHECK (direction IN ('ltr', 'rtl')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_preferences IS
    'Per-person interface settings. NULL means "follow the business default".';

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Yours and only yours, in both directions. Nothing here is worth reading
-- across accounts and nothing here should be writable across them.
DROP POLICY IF EXISTS user_preferences_select_own ON public.user_preferences;
CREATE POLICY user_preferences_select_own
ON public.user_preferences FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_preferences_insert_own ON public.user_preferences;
CREATE POLICY user_preferences_insert_own
ON public.user_preferences FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_preferences_update_own ON public.user_preferences;
CREATE POLICY user_preferences_update_own
ON public.user_preferences FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.user_preferences TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- Verify
-- ===========================================================================
--   -- As a signed-in user:
--   INSERT INTO user_preferences (user_id, language, direction)
--   VALUES (auth.uid(), 'en', 'ltr')
--   ON CONFLICT (user_id) DO UPDATE SET language = EXCLUDED.language;
--   SELECT * FROM user_preferences;      -- exactly one row, your own
--
--   -- And that the policy actually holds:
--   INSERT INTO user_preferences (user_id, language) VALUES (gen_random_uuid(), 'en');
--   -- must fail on the WITH CHECK, not succeed.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP TABLE IF EXISTS public.user_preferences;
