-- ===========================================================================
-- WhatsApp rules («الأتمتة»): what each rule already did
-- ===========================================================================
-- A rule (Settings → WhatsApp, lib/whatsapp/flows.ts) runs once per order
-- for an order event or a missing reply, and once per customer message for a
-- reply. whatsapp_flow_runs remembers it, so a rule never sends the same
-- thing twice, however many times the event is seen.
--
-- Also: the outbox call (20261126) only for rows waiting to be sent.
-- Requires 20261125 and 20261126. Safe to run again.

CREATE TABLE IF NOT EXISTS public.whatsapp_flow_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    flow_id     TEXT NOT NULL,
    order_id    UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    run_key     TEXT NOT NULL,
    result      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (flow_id, run_key)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_flow_runs_order ON public.whatsapp_flow_runs (order_id);
ALTER TABLE public.whatsapp_flow_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_flow_runs_members_read ON public.whatsapp_flow_runs;
CREATE POLICY whatsapp_flow_runs_members_read ON public.whatsapp_flow_runs FOR SELECT TO authenticated
    USING (public.is_member_of(business_id));
GRANT SELECT ON public.whatsapp_flow_runs TO authenticated;

CREATE OR REPLACE FUNCTION public.whatsapp_outbox_kick()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE h RECORD;
BEGIN
    -- The new order's confirmation is sent by the webhook, after its items;
    -- a row that is not waiting to be sent needs nothing.
    IF NEW.event = 'new_order' OR NEW.status <> 'queued' THEN RETURN NEW; END IF;
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
    RETURN NEW;
END $$;
