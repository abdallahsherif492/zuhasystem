-- ===========================================================================
-- WhatsApp: shipping answers sent to a moderator for the courier
-- ===========================================================================
-- A customer's answers to a shipping message (المندوب ماقدرش يوصله / الشحنة
-- راجعة) go to a moderator on shift, on their own WhatsApp, ready to forward
-- to the courier's group (lib/whatsapp/team-alerts.ts). Each one is kept here:
-- who got it (the same moderator gets the order's updates), what it said, and
-- whether it went.
-- Safe to run again.

CREATE TABLE IF NOT EXISTS public.whatsapp_team_alerts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    order_id      UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    member_email  TEXT NOT NULL,
    member_phone  TEXT NOT NULL,
    body          TEXT NOT NULL,
    wa_message_id TEXT,
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_team_alerts_order ON public.whatsapp_team_alerts (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_team_alerts_recent ON public.whatsapp_team_alerts (business_id, created_at DESC);

ALTER TABLE public.whatsapp_team_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_team_alerts_members_read ON public.whatsapp_team_alerts;
CREATE POLICY whatsapp_team_alerts_members_read ON public.whatsapp_team_alerts FOR SELECT TO authenticated
    USING (public.is_member_of(business_id));
