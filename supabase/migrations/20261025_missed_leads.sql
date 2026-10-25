-- Migration: missed orders — people who filled the store's order form and left
-- Created At: 2026-10-25
-- Requires: nothing new
--
-- EasyOrders keeps its own "missed orders", but its public API has no way to
-- read them, and its list is full of bots. So the store carries our own small
-- script (public/leads.js, pasted into EasyOrders' "Add Custom Code to the
-- Header"): as soon as a visitor has typed a valid phone into the order form,
-- it sends what they typed, and how they typed it, to /api/leads. That
-- endpoint scores the visitor for bot behaviour and calls capture_missed_lead.
--
-- A lead stops being "missed" the moment an order with the same phone exists:
-- capture_missed_lead checks on the way in, the EasyOrders webhook marks it as
-- soon as the order arrives, and missed_leads_refresh catches orders from any
-- other channel when the page opens.
--
--   missed_leads            one row per phone per business per three days
--   capture_missed_lead     called by /api/leads; checks the business's lead
--                           key, throttles a flooding device, dedupes, links an
--                           existing order
--   missed_leads_mark_converted   called by the webhook with a new order
--   missed_leads_refresh    called by the page: links orders from any channel

CREATE TABLE IF NOT EXISTS public.missed_leads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    phone           TEXT NOT NULL,                -- 11 digits, 01xxxxxxxxx
    name            TEXT,
    phone2          TEXT,
    address         TEXT,
    governorate     TEXT,
    product         TEXT,                         -- what page they were ordering from
    page_url        TEXT,
    referrer        TEXT,
    utm             JSONB,
    session_id      TEXT,
    ip              TEXT,
    user_agent      TEXT,
    signals         JSONB,                        -- how the form was filled
    bot_score       INT NOT NULL DEFAULT 0,       -- 0–100; 50 and up is a bot
    bot_reasons     TEXT[] NOT NULL DEFAULT '{}',
    submitted       BOOLEAN NOT NULL DEFAULT false, -- they pressed the order button
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'bot', 'converted', 'contacted', 'dismissed')),
    order_id        UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    touches         INT NOT NULL DEFAULT 1,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    outcome         TEXT,                         -- what the call ended in
    note            TEXT,
    handled_by      TEXT,
    handled_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_missed_leads_board ON public.missed_leads (business_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_missed_leads_phone ON public.missed_leads (business_id, phone);
CREATE INDEX IF NOT EXISTS idx_missed_leads_ip    ON public.missed_leads (business_id, ip, first_seen_at);

ALTER TABLE public.missed_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read missed leads" ON public.missed_leads;
CREATE POLICY "Members read missed leads" ON public.missed_leads FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = missed_leads.business_id
                      AND lower(bu.user_email) = lower(auth.jwt() ->> 'email')));

-- Members work the list: status, outcome, note. Rows only arrive through
-- capture_missed_lead.
DROP POLICY IF EXISTS "Members update missed leads" ON public.missed_leads;
CREATE POLICY "Members update missed leads" ON public.missed_leads FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = missed_leads.business_id
                      AND lower(bu.user_email) = lower(auth.jwt() ->> 'email')));

-- The last ten digits of a phone, however it was written: "+20 10 1234 5678",
-- "01012345678" and "201012345678" all become "1012345678".
CREATE OR REPLACE FUNCTION public.phone_key(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT right(regexp_replace(COALESCE(p, ''), '\D', '', 'g'), 10);
$$;

-- An order this business already has for the phone, placed after the lead
-- began (less two hours, for an order placed a little before the lead's last
-- update) — any channel, any status but Cancelled.
CREATE OR REPLACE FUNCTION public.missed_lead_order(p_business_id UUID, p_phone TEXT, p_since TIMESTAMPTZ)
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT o.id FROM public.orders o
     WHERE o.business_id = p_business_id
       AND o.created_at >= p_since - interval '2 hours'
       AND (public.phone_key(o.customer_info ->> 'phone') = public.phone_key(p_phone)
            OR public.phone_key(o.customer_info ->> 'phone2') = public.phone_key(p_phone))
     ORDER BY o.created_at
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.capture_missed_lead(
    p_business_id UUID, p_key TEXT, p_phone TEXT,
    p_name TEXT, p_phone2 TEXT, p_address TEXT, p_governorate TEXT,
    p_product TEXT, p_page_url TEXT, p_referrer TEXT, p_utm JSONB,
    p_session TEXT, p_ip TEXT, p_user_agent TEXT, p_signals JSONB,
    p_score INT, p_reasons TEXT[], p_submitted BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_key      TEXT;
    v_phones   INT;
    v_same_device INT;
    v_score    INT := LEAST(100, GREATEST(0, COALESCE(p_score, 0)));
    v_reasons  TEXT[] := COALESCE(p_reasons, '{}');
    v_existing public.missed_leads%ROWTYPE;
    v_order    UUID;
    v_status   TEXT;
BEGIN
    SELECT b.theme_config #>> '{integrations,platforms,easyorders,leadKey}' INTO v_key
      FROM public.businesses b WHERE b.id = p_business_id;
    IF v_key IS NULL OR v_key = '' OR v_key IS DISTINCT FROM p_key THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'key');
    END IF;
    IF p_phone !~ '^01[0125][0-9]{8}$' THEN
        -- Still recorded, but as what it is.
        v_score := GREATEST(v_score, 60);
    END IF;

    -- One device typing many different numbers within the hour. Mobile
    -- networks in Egypt put many customers behind one address, so the same
    -- address alone takes a lot; the same address AND the same browser is one
    -- device, and three other numbers from it is a bot.
    IF p_ip IS NOT NULL AND p_ip <> '' THEN
        SELECT count(DISTINCT phone),
               count(DISTINCT phone) FILTER (WHERE user_agent IS NOT DISTINCT FROM p_user_agent)
          INTO v_phones, v_same_device
          FROM public.missed_leads
         WHERE business_id = p_business_id AND ip = p_ip
           AND first_seen_at >= now() - interval '1 hour' AND phone <> p_phone;
        IF v_phones >= 40 THEN
            RETURN jsonb_build_object('ok', false, 'reason', 'throttled');
        ELSIF v_same_device >= 3 THEN
            v_score := LEAST(100, v_score + 50);
            v_reasons := array_append(v_reasons, format('نفس الجهاز كتب %s أرقام تانية في ساعة', v_same_device));
        ELSIF v_phones >= 8 THEN
            v_score := LEAST(100, v_score + 40);
            v_reasons := array_append(v_reasons, format('نفس الشبكة كتبت %s أرقام تانية في ساعة', v_phones));
        END IF;
    END IF;

    SELECT * INTO v_existing FROM public.missed_leads
     WHERE business_id = p_business_id AND phone = p_phone
       AND last_seen_at >= now() - interval '3 days'
     ORDER BY last_seen_at DESC LIMIT 1;

    v_order := public.missed_lead_order(p_business_id, p_phone, COALESCE(v_existing.first_seen_at, now()));

    IF v_existing.id IS NULL THEN
        v_status := CASE WHEN v_order IS NOT NULL THEN 'converted' WHEN v_score >= 50 THEN 'bot' ELSE 'open' END;
        INSERT INTO public.missed_leads (
            business_id, phone, name, phone2, address, governorate, product, page_url, referrer, utm,
            session_id, ip, user_agent, signals, bot_score, bot_reasons, submitted, status, order_id)
        VALUES (
            p_business_id, p_phone, NULLIF(btrim(p_name), ''), NULLIF(btrim(p_phone2), ''), NULLIF(btrim(p_address), ''),
            NULLIF(btrim(p_governorate), ''), NULLIF(btrim(p_product), ''), p_page_url, p_referrer, p_utm,
            p_session, p_ip, p_user_agent, p_signals, v_score, v_reasons, COALESCE(p_submitted, false), v_status, v_order);
    ELSE
        -- The same visitor coming back, or adding details: keep the fullest
        -- picture, and the worse of the two scores.
        UPDATE public.missed_leads SET
            name        = COALESCE(NULLIF(btrim(p_name), ''), name),
            phone2      = COALESCE(NULLIF(btrim(p_phone2), ''), phone2),
            address     = COALESCE(NULLIF(btrim(p_address), ''), address),
            governorate = COALESCE(NULLIF(btrim(p_governorate), ''), governorate),
            product     = COALESCE(NULLIF(btrim(p_product), ''), product),
            page_url    = COALESCE(p_page_url, page_url),
            signals     = COALESCE(p_signals, signals),
            user_agent  = COALESCE(p_user_agent, user_agent),
            ip          = COALESCE(NULLIF(p_ip, ''), ip),
            bot_score   = GREATEST(bot_score, v_score),
            bot_reasons = (SELECT ARRAY(SELECT DISTINCT unnest(bot_reasons || v_reasons))),
            submitted   = submitted OR COALESCE(p_submitted, false),
            touches     = touches + CASE WHEN session_id IS DISTINCT FROM p_session THEN 1 ELSE 0 END,
            session_id  = p_session,
            last_seen_at = now(),
            order_id    = COALESCE(order_id, v_order),
            status      = CASE
                            WHEN v_order IS NOT NULL THEN 'converted'
                            WHEN status IN ('contacted', 'dismissed', 'converted') THEN status
                            WHEN GREATEST(bot_score, v_score) >= 50 AND status = 'open' AND handled_at IS NULL THEN 'bot'
                            ELSE status END
         WHERE id = v_existing.id;
    END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.capture_missed_lead(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, JSONB, INT, TEXT[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capture_missed_lead(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, JSONB, INT, TEXT[], BOOLEAN) TO anon, authenticated, service_role;

-- A new order: whoever was "missing" with this phone has ordered.
CREATE OR REPLACE FUNCTION public.missed_leads_mark_converted(p_business_id UUID, p_phone TEXT, p_order_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT;
BEGIN
    UPDATE public.missed_leads SET status = 'converted', order_id = p_order_id
     WHERE business_id = p_business_id
       AND phone_key(phone) = phone_key(p_phone)
       AND status IN ('open', 'bot', 'contacted')
       AND last_seen_at >= now() - interval '7 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.missed_leads_mark_converted(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missed_leads_mark_converted(UUID, TEXT, UUID) TO authenticated, service_role;

-- The page: link orders from any channel, then the counts per tab.
CREATE OR REPLACE FUNCTION public.missed_leads_refresh(p_business_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_linked INT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = p_business_id AND lower(bu.user_email) = lower(auth.jwt() ->> 'email')) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;
    WITH linked AS (
        UPDATE public.missed_leads l
           SET status = 'converted', order_id = public.missed_lead_order(l.business_id, l.phone, l.first_seen_at)
         WHERE l.business_id = p_business_id
           AND l.status IN ('open', 'bot', 'contacted')
           AND l.first_seen_at >= now() - interval '30 days'
           AND public.missed_lead_order(l.business_id, l.phone, l.first_seen_at) IS NOT NULL
        RETURNING 1)
    SELECT count(*) INTO v_linked FROM linked;
    RETURN jsonb_build_object('linked', v_linked);
END $$;
REVOKE ALL ON FUNCTION public.missed_leads_refresh(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missed_leads_refresh(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Rollback:
--   DROP FUNCTION IF EXISTS public.missed_leads_refresh(UUID);
--   DROP FUNCTION IF EXISTS public.missed_leads_mark_converted(UUID, TEXT, UUID);
--   DROP FUNCTION IF EXISTS public.capture_missed_lead(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, JSONB, INT, TEXT[], BOOLEAN);
--   DROP FUNCTION IF EXISTS public.missed_lead_order(UUID, TEXT, TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS public.phone_key(TEXT);
--   DROP TABLE IF EXISTS public.missed_leads;
