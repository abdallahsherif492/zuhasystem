-- ===========================================================================
-- WhatsApp numbers connected to the system (WhatsApp Cloud API)
-- ===========================================================================
-- One row per connected number: the WhatsApp Business account and phone
-- number Meta returned when the owner connected it from Settings → WhatsApp
-- (Embedded Signup, src/app/(dashboard)/settings/whatsapp/page.tsx), and the
-- token the server sends with. The token never reaches a browser: the table
-- has no policies, so only the server (service role) reads or writes it.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.whatsapp_accounts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    waba_id          TEXT NOT NULL,
    phone_number_id  TEXT NOT NULL UNIQUE,
    display_phone    TEXT,
    verified_name    TEXT,
    access_token     TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ,
    -- 'coexistence': the number stays on the WhatsApp Business app too.
    mode             TEXT NOT NULL DEFAULT 'coexistence',
    -- What Meta answered to the setup calls (subscribe, history sync).
    setup_result     JSONB,
    connected_by     TEXT,
    connected_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_business ON public.whatsapp_accounts (business_id);

ALTER TABLE public.whatsapp_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_accounts FROM anon, authenticated;
