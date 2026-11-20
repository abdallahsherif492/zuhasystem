-- ===========================================================================
-- WhatsApp automation: messages sent on their own when an order changes
-- ===========================================================================
-- 1. products.image_url: the product's photo from the store (EasyOrders sends
--    it with every order), shown in the confirmation message and the chats.
-- 2. whatsapp_outbox: what should be sent and why. A new store order queues
--    its confirmation; a status change queues the message for that status
--    (shipped, hold to redeliver, returning, delivered, confirmed by a
--    person). /api/cron/whatsapp-outbox sends them every minute, by the
--    business's WhatsApp settings. One message per order per event.
-- Only for businesses with a WhatsApp number connected. Safe to run again.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE TABLE IF NOT EXISTS public.whatsapp_outbox (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    order_id     UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    event        TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'skipped', 'failed')),
    detail       TEXT,
    send_after   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    UNIQUE (order_id, event)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_queue ON public.whatsapp_outbox (status, send_after);
ALTER TABLE public.whatsapp_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_outbox_members_read ON public.whatsapp_outbox;
CREATE POLICY whatsapp_outbox_members_read ON public.whatsapp_outbox FOR SELECT TO authenticated
    USING (public.is_member_of(business_id));
GRANT SELECT ON public.whatsapp_outbox TO authenticated;

CREATE OR REPLACE FUNCTION public.whatsapp_queue_order_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_new TEXT := lower(btrim(COALESCE(NEW.status, '')));
    v_old TEXT := CASE WHEN TG_OP = 'UPDATE' THEN lower(btrim(COALESCE(OLD.status, ''))) ELSE '' END;
    v_event TEXT;
BEGIN
    IF v_new = v_old THEN RETURN NEW; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_accounts a WHERE a.business_id = NEW.business_id) THEN RETURN NEW; END IF;

    v_event := CASE
        WHEN TG_OP = 'INSERT' AND v_new = 'waiting' AND (NEW.easyorders_id IS NOT NULL OR NEW.shopify_id IS NOT NULL) THEN 'new_order'
        WHEN v_old = 'waiting' AND v_new = 'pending' AND COALESCE(NEW.confirmed_by, '') <> 'whatsapp-auto' THEN 'confirmed'
        WHEN v_new = 'shipped' THEN 'shipped'
        WHEN v_new IN ('hold to redeliver', 'hold_to_redeliver') THEN 'hold'
        WHEN v_new = 'returning' THEN 'returning'
        WHEN v_new = 'delivered' THEN 'delivered'
        ELSE NULL
    END;
    IF v_event IS NULL THEN RETURN NEW; END IF;

    INSERT INTO public.whatsapp_outbox (business_id, order_id, event, send_after)
    -- A new order waits a minute so its items are in before the message is built.
    VALUES (NEW.business_id, NEW.id, v_event, now() + CASE WHEN v_event = 'new_order' THEN interval '1 minute' ELSE interval '0' END)
    ON CONFLICT (order_id, event) DO NOTHING;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_whatsapp_queue_order_event ON public.orders;
CREATE TRIGGER trg_whatsapp_queue_order_event
    AFTER INSERT OR UPDATE OF status ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.whatsapp_queue_order_event();
