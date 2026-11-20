-- ===========================================================================
-- WhatsApp outbox: sent the moment it is queued, with no polling
-- ===========================================================================
-- 20261125 had a job checking the outbox every minute (about 43,000 runs a
-- month). Now the database calls the site once when a status message is
-- queued (pg_net, asynchronous: the order's update never waits for it). A
-- new store order's confirmation is sent by the EasyOrders webhook once the
-- order's items are saved; an hourly run sends anything left.
--
-- The call is signed with a key made here and kept in app_hooks, a table
-- only the server reads (RLS on, no policies). Nobody copies a secret.
-- Requires 20261125. Safe to run again.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.app_hooks (
    name   TEXT PRIMARY KEY,
    url    TEXT NOT NULL,
    secret TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
ALTER TABLE public.app_hooks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_hooks FROM anon, authenticated;

INSERT INTO public.app_hooks (name, url)
VALUES ('whatsapp_outbox', 'https://www.e-commerx.com/api/cron/whatsapp-outbox')
ON CONFLICT (name) DO NOTHING;

-- A claimed row while it is being sent, so two runs never send it twice.
ALTER TABLE public.whatsapp_outbox DROP CONSTRAINT IF EXISTS whatsapp_outbox_status_check;
ALTER TABLE public.whatsapp_outbox ADD CONSTRAINT whatsapp_outbox_status_check
    CHECK (status IN ('queued', 'sending', 'sent', 'skipped', 'failed'));

CREATE OR REPLACE FUNCTION public.whatsapp_outbox_kick()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE h RECORD;
BEGIN
    -- The new order's confirmation is sent by the webhook, after its items.
    IF NEW.event = 'new_order' THEN RETURN NEW; END IF;
    SELECT url, secret INTO h FROM public.app_hooks WHERE name = 'whatsapp_outbox';
    IF h.url IS NULL THEN RETURN NEW; END IF;
    PERFORM net.http_post(
        url := h.url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', h.secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW; -- never block an order's update; the hourly run sends it
END $$;

DROP TRIGGER IF EXISTS trg_whatsapp_outbox_kick ON public.whatsapp_outbox;
CREATE TRIGGER trg_whatsapp_outbox_kick
    AFTER INSERT ON public.whatsapp_outbox
    FOR EACH ROW EXECUTE FUNCTION public.whatsapp_outbox_kick();
