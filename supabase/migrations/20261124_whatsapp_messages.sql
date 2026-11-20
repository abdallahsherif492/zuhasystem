-- ===========================================================================
-- WhatsApp messages: everything sent and received on the connected number
-- ===========================================================================
-- Filled by the webhook (/api/whatsapp/webhook): a customer's message as it
-- arrives, and the status of ours (sent, delivered, read, failed) as Meta
-- reports it. Messages the system sends are added by the server when sent.
-- The team reads them (the conversations page); only the server writes.
-- Safe to run more than once. Needs 20261123_whatsapp_accounts.sql.

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    phone_number_id  TEXT NOT NULL,
    wa_message_id    TEXT UNIQUE,
    direction        TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    -- The customer: 01xxxxxxxxx for an Egyptian mobile, else as WhatsApp sent it.
    customer_phone   TEXT NOT NULL,
    customer_wa_id   TEXT,
    contact_name     TEXT,
    type             TEXT NOT NULL DEFAULT 'text',
    body             TEXT,
    media_id         TEXT,
    media_mime       TEXT,
    -- A reply to one of our messages, or a button the customer pressed.
    context_id       TEXT,
    template_name    TEXT,
    status           TEXT NOT NULL DEFAULT 'received',
    error            JSONB,
    payload          JSONB,
    sent_by          TEXT,
    order_id         UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    status_at        TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat ON public.whatsapp_messages (business_id, customer_phone, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_recent ON public.whatsapp_messages (business_id, sent_at DESC);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_messages_members_read ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_members_read ON public.whatsapp_messages FOR SELECT TO authenticated
    USING (public.is_member_of(business_id));
GRANT SELECT ON public.whatsapp_messages TO authenticated;

-- Live updates for the conversations page.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_messages') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
    END IF;
END $$;
