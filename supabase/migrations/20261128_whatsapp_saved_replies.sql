-- ===========================================================================
-- WhatsApp saved replies («الردود المحفوظة»)
-- ===========================================================================
-- The replies the team sends again and again, one tap in the chat. Shared
-- by the whole business: every member can add, edit and delete them, and
-- each one remembers who changed it last. Typing «/» in the chat finds one.
-- Safe to run again.

CREATE TABLE IF NOT EXISTS public.whatsapp_saved_replies (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    sort        INT  NOT NULL DEFAULT 0,
    updated_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_saved_replies_business ON public.whatsapp_saved_replies (business_id, sort, created_at);

ALTER TABLE public.whatsapp_saved_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_saved_replies_members ON public.whatsapp_saved_replies;
CREATE POLICY whatsapp_saved_replies_members ON public.whatsapp_saved_replies FOR ALL TO authenticated
    USING (public.is_member_of(business_id)) WITH CHECK (public.is_member_of(business_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_saved_replies TO authenticated;

-- Who changed it last, and when (whoever is signed in).
CREATE OR REPLACE FUNCTION public.whatsapp_saved_replies_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    NEW.updated_at := now();
    NEW.updated_by := COALESCE(NULLIF(lower(auth.jwt() ->> 'email'), ''), NEW.updated_by);
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_whatsapp_saved_replies_touch ON public.whatsapp_saved_replies;
CREATE TRIGGER trg_whatsapp_saved_replies_touch
    BEFORE INSERT OR UPDATE ON public.whatsapp_saved_replies
    FOR EACH ROW EXECUTE FUNCTION public.whatsapp_saved_replies_touch();

-- The replies the chat offered until now, for each business with a WhatsApp
-- number that has none yet.
INSERT INTO public.whatsapp_saved_replies (business_id, title, body, sort)
SELECT a.business_id, r.title, r.body, r.sort
  FROM (SELECT DISTINCT business_id FROM public.whatsapp_accounts) a
 CROSS JOIN (VALUES
    ('اتأكد وهيتشحن', 'تمام، طلبك اتأكد وهيتشحن قريب 🌸', 1),
    ('العنوان مظبوط؟', 'العنوان ده مظبوط؟ ابعتلنا علامة مميزة جنبه لو سمحت.', 2),
    ('محتاج ديبوزت', 'الطلب ده محتاج ديبوزت قبل الشحن. تحب نبعتلك تفاصيل التحويل؟', 3),
    ('ميعاد المندوب', 'هنبلّغ المندوب بالميعاد اللي يناسبك.', 4),
    ('تحت أمرك', 'تحت أمرك في أي وقت 🌸', 5)
 ) AS r(title, body, sort)
 WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_saved_replies s WHERE s.business_id = a.business_id);
