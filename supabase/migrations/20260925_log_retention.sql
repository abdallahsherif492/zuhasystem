-- Migration: keep logs short-lived, and give the space back
-- Created At: 2026-09-25
--
-- The free database is 0.5 GB and it is full. Logs took over 90% of it:
-- integration_logs alone was 421 MB (75%), mostly a "[DEBUG] Fetched N matching
-- shipments" line written on every courier sync with ~10 KB of payload each —
-- read by nobody. actions_log was another 80 MB.
--
-- Retention from now on, run hourly by pg_cron:
--   integration_logs   24 hours
--   actions_log        30 days
--   live_sessions       7 days   (who is online now; history is useless)
--
-- The one-time cleanup below keeps what is inside those windows and TRUNCATEs
-- the rest instead of DELETEing it. A DELETE leaves the table file at its old
-- size until a VACUUM FULL, so the database would still read as full; TRUNCATE
-- gives the disk back immediately. Everything runs in this migration's single
-- transaction: if any step fails, nothing is deleted.
--
-- ⚠ This permanently deletes integration logs older than 24 hours and actions
-- log entries older than 30 days. Nothing else is touched: no orders, no
-- transactions, no products, no audit history of money.

-- ---------------------------------------------------------------------------
-- 1. One-time cleanup, reclaiming the space
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE keep_integration_logs ON COMMIT DROP AS
    SELECT * FROM public.integration_logs WHERE created_at > now() - interval '24 hours';
TRUNCATE public.integration_logs;
INSERT INTO public.integration_logs SELECT * FROM keep_integration_logs;

CREATE TEMP TABLE keep_actions_log ON COMMIT DROP AS
    SELECT * FROM public.actions_log WHERE created_at > now() - interval '30 days';
TRUNCATE public.actions_log;
INSERT INTO public.actions_log SELECT * FROM keep_actions_log;

DELETE FROM public.live_sessions WHERE last_seen_at < now() - interval '7 days';

-- ---------------------------------------------------------------------------
-- 2. Retention, every hour
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.purge_old_logs()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    DELETE FROM public.integration_logs WHERE created_at < now() - interval '24 hours';
    DELETE FROM public.actions_log      WHERE created_at < now() - interval '30 days';
    DELETE FROM public.live_sessions    WHERE last_seen_at < now() - interval '7 days';
$$;

REVOKE ALL ON FUNCTION public.purge_old_logs() FROM PUBLIC, anon, authenticated;

-- Re-running the migration replaces the job instead of stacking a second one.
DO $$
BEGIN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-old-logs';
END $$;

SELECT cron.schedule('purge-old-logs', '17 * * * *', $$SELECT public.purge_old_logs();$$);

-- Hourly deletes leave only an hour's worth of dead rows behind, which
-- autovacuum reuses, so the tables stay at their small size from here on.

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--   SELECT pg_size_pretty(pg_database_size(current_database()));
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'purge-old-logs';
--   SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
--     FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 8;

-- ---------------------------------------------------------------------------
-- Rollback (the deleted rows cannot be restored)
-- ---------------------------------------------------------------------------
--   SELECT cron.unschedule('purge-old-logs');
--   DROP FUNCTION IF EXISTS public.purge_old_logs();
