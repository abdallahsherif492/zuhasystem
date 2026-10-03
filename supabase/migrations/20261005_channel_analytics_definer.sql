-- Migration: channel analytics — check membership once, not on every row
-- Created At: 2026-10-05
-- Requires: 20261004_channel_analytics.sql
--
-- channel_analytics() ran as the caller (SECURITY INVOKER), so the orders
-- policies were evaluated for every row it touched — including the
-- returning-customer lookup, which runs once per order in the range. With
-- the service key it answered in 0.4 s; signed in, the page reported
-- "Could not load the data".
--
-- The other analytics functions (20260905_advanced_analytics.sql) do it the
-- other way round: check once that the caller belongs to the business, then
-- read as the owner. This does the same. The body is unchanged — the
-- function is renamed to channel_analytics_data(), closed to callers, and
-- channel_analytics() becomes the checked entry point.

ALTER FUNCTION public.channel_analytics(UUID, DATE, DATE) RENAME TO channel_analytics_data;
REVOKE ALL ON FUNCTION public.channel_analytics_data(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.channel_analytics(p_business_id UUID, p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.business_users bu
         WHERE bu.business_id = p_business_id
           AND lower(bu.user_email) = lower(auth.jwt() ->> 'email')
    ) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN public.channel_analytics_data(p_business_id, p_from, p_to);
END $$;

REVOKE ALL ON FUNCTION public.channel_analytics(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.channel_analytics(UUID, DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Rollback:
--   DROP FUNCTION IF EXISTS public.channel_analytics(UUID, DATE, DATE);
--   ALTER FUNCTION public.channel_analytics_data(UUID, DATE, DATE) RENAME TO channel_analytics;
--   GRANT EXECUTE ON FUNCTION public.channel_analytics(UUID, DATE, DATE) TO authenticated;
