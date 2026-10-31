-- Migration: missed orders join the confirmation queue
-- Created At: 2026-11-01
-- Requires: 20261025_missed_leads.sql
--
-- Missed orders had a page of their own, and a page of their own is one that
-- sales skip. Now a missed order that is not a bot becomes a Waiting order,
-- tagged "missed-order", among the store's other orders on "New from stores"
-- — confirmed, retried or cancelled exactly like them.
--
-- It waits a quiet quarter of an hour first (whoever is still checking out is
-- not called mid-order), and only leads from the last two days are taken, so
-- turning this on does not flood the queue with week-old visitors.
--
-- These orders are order_type 'missed' while they wait, which keeps them out
-- of the dashboard, channel and commission figures (all count order_type
-- 'new'). Confirming one makes it 'new'; a cancelled one stays 'missed', so a
-- visitor who was never going to order is not counted as a cancelled order.
--
-- If the customer orders after all — on the store, or through anyone — the
-- waiting missed order is cancelled, so the same customer is not shipped twice.

-- 1. The lead remembers that it was moved into the queue.
DO $$
DECLARE c TEXT;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint
              WHERE conrelid = 'public.missed_leads'::regclass AND contype = 'c'
                AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE public.missed_leads DROP CONSTRAINT %I', c);
    END LOOP;
END $$;
ALTER TABLE public.missed_leads ADD CONSTRAINT missed_leads_status_check
    CHECK (status IN ('open', 'bot', 'converted', 'contacted', 'dismissed', 'promoted'));

-- 2. orders.order_type may carry a check of its own (it is not in these
-- migrations); if so, 'missed' is added to whatever it allows.
DO $$
DECLARE r RECORD; v_expr TEXT;
BEGIN
    FOR r IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
              WHERE conrelid = 'public.orders'::regclass AND contype = 'c'
                AND pg_get_constraintdef(oid) ILIKE '%order_type%'
    LOOP
        v_expr := regexp_replace(r.def, '^CHECK \((.*)\)( NOT VALID)?$', '\1');
        EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', r.conname);
        EXECUTE format('ALTER TABLE public.orders ADD CONSTRAINT %I CHECK ((%s) OR order_type = %L) NOT VALID',
                       r.conname, v_expr, 'missed');
    END LOOP;
END $$;

-- 3. Confirming a missed order makes it an ordinary one, so from then on it
-- counts everywhere a new order counts.
CREATE OR REPLACE FUNCTION public.orders_missed_confirmed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.order_type = 'missed'
       AND lower(trim(COALESCE(NEW.status, ''))) NOT IN ('waiting', 'cancelled', 'unavailable') THEN
        NEW.order_type := 'new';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_orders_missed_confirmed ON public.orders;
CREATE TRIGGER trg_orders_missed_confirmed
    BEFORE UPDATE OF status ON public.orders
    FOR EACH ROW WHEN (OLD.order_type = 'missed')
    EXECUTE FUNCTION public.orders_missed_confirmed();

-- 4. A real order for a lead's phone: never the lead's own missed order.
CREATE OR REPLACE FUNCTION public.missed_lead_order(p_business_id UUID, p_phone TEXT, p_since TIMESTAMPTZ)
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT o.id FROM public.orders o
     WHERE o.business_id = p_business_id
       AND o.created_at >= p_since - interval '2 hours'
       AND COALESCE(o.order_type, 'new') <> 'missed'
       AND (public.phone_key(o.customer_info ->> 'phone') = public.phone_key(p_phone)
            OR public.phone_key(o.customer_info ->> 'phone2') = public.phone_key(p_phone))
     ORDER BY o.created_at
     LIMIT 1;
$$;

-- 5. The customer ordered: close the lead on that order, and cancel its
-- missed order if that is still waiting to be confirmed.
CREATE OR REPLACE FUNCTION public.missed_lead_absorb(p_lead_id UUID, p_order_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old UUID;
BEGIN
    SELECT order_id INTO v_old FROM public.missed_leads WHERE id = p_lead_id AND status = 'promoted';
    IF v_old IS NOT NULL AND v_old IS DISTINCT FROM p_order_id THEN
        UPDATE public.orders
           SET status = 'Cancelled',
               tags = array_append(COALESCE(tags, '{}'), 'ordered-anyway')
         WHERE id = v_old AND order_type = 'missed' AND lower(trim(status)) = 'waiting';
    END IF;
    UPDATE public.missed_leads SET status = 'converted', order_id = p_order_id
     WHERE id = p_lead_id;
END $$;
REVOKE ALL ON FUNCTION public.missed_lead_absorb(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- The webhook's call, now also for leads already in the queue.
CREATE OR REPLACE FUNCTION public.missed_leads_mark_converted(p_business_id UUID, p_phone TEXT, p_order_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_n INT := 0;
BEGIN
    FOR v_id IN SELECT id FROM public.missed_leads
                 WHERE business_id = p_business_id
                   AND phone_key(phone) = phone_key(p_phone)
                   AND status IN ('open', 'bot', 'contacted', 'promoted')
                   AND last_seen_at >= now() - interval '7 days'
    LOOP
        PERFORM public.missed_lead_absorb(v_id, p_order_id);
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.missed_leads_mark_converted(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missed_leads_mark_converted(UUID, TEXT, UUID) TO authenticated, service_role;

-- 6. Capture: a lead already in the queue stays there; the queue settles it.
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
        v_score := GREATEST(v_score, 60);
    END IF;

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
            order_id    = CASE WHEN status = 'promoted' THEN order_id ELSE COALESCE(order_id, v_order) END,
            status      = CASE
                            WHEN status = 'promoted' THEN status
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

-- 7. The page's refresh also settles leads already in the queue.
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
    PERFORM public.missed_leads_promote(p_business_id);
    RETURN jsonb_build_object('linked', v_linked);
END $$;

-- 8. Moving missed orders into the queue. Called by the sidebar's waiting
-- counter and the "New from stores" page, so it runs whenever anyone in the
-- business has the system open.
CREATE OR REPLACE FUNCTION public.missed_leads_promote(p_business_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    l          RECORD;
    v_found    UUID;
    v_order    UUID;
    v_cust     UUID;
    v_title    TEXT;
    v_variant  UUID;
    v_price    NUMERIC;
    v_cost     NUMERIC;
    v_ship     NUMERIC;
    v_courier  NUMERIC;
    v_rates    JSONB;
    v_created  INT := 0;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' AND NOT EXISTS (
        SELECT 1 FROM public.business_users bu
         WHERE bu.business_id = p_business_id AND lower(bu.user_email) = lower(auth.jwt() ->> 'email')) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Missed orders that have left the queue: confirmed is converted,
    -- cancelled is dismissed.
    UPDATE public.missed_leads ml
       SET status = CASE WHEN o.status IN ('Cancelled', 'Unavailable') THEN 'dismissed' ELSE 'converted' END,
           outcome = COALESCE(ml.outcome, CASE WHEN o.status IN ('Cancelled', 'Unavailable') THEN 'not_interested' ELSE 'will_order' END),
           handled_at = COALESCE(ml.handled_at, now())
      FROM public.orders o
     WHERE ml.business_id = p_business_id AND ml.status = 'promoted'
       AND o.id = ml.order_id AND lower(trim(o.status)) <> 'waiting';
    UPDATE public.missed_leads SET status = 'dismissed'
     WHERE business_id = p_business_id AND status = 'promoted' AND order_id IS NULL;

    -- Still waiting, but the customer has ordered since.
    FOR l IN SELECT id, phone, first_seen_at FROM public.missed_leads
              WHERE business_id = p_business_id AND status = 'promoted'
    LOOP
        v_found := public.missed_lead_order(p_business_id, l.phone, l.first_seen_at);
        IF v_found IS NOT NULL THEN PERFORM public.missed_lead_absorb(l.id, v_found); END IF;
    END LOOP;

    -- What the store usually charges for delivery, and what the default
    -- courier charges us, by governorate.
    SELECT o.shipping_cost INTO v_ship FROM public.orders o
     WHERE o.business_id = p_business_id AND o.easyorders_id IS NOT NULL
       AND o.created_at >= now() - interval '60 days' AND o.shipping_cost > 0
     GROUP BY o.shipping_cost ORDER BY count(*) DESC LIMIT 1;
    SELECT sc.rates INTO v_rates FROM public.shipping_companies sc
     WHERE sc.business_id = p_business_id AND sc.is_default LIMIT 1;

    FOR l IN SELECT * FROM public.missed_leads
              WHERE business_id = p_business_id AND status = 'open'
                AND last_seen_at <= now() - interval '15 minutes'
                AND last_seen_at >= now() - interval '2 days'
              ORDER BY last_seen_at
              FOR UPDATE SKIP LOCKED
    LOOP
        v_found := public.missed_lead_order(p_business_id, l.phone, l.first_seen_at);
        IF v_found IS NOT NULL THEN
            UPDATE public.missed_leads SET status = 'converted', order_id = v_found WHERE id = l.id;
            CONTINUE;
        END IF;

        -- The product, by its code in the page's title ("غسالة PW2 محمولة"):
        -- the store's titles are Arabic and the catalogue's names English, so
        -- the code is what they share. Otherwise the line is left unmapped
        -- under the title, as an unrecognised store item is.
        v_title := btrim(regexp_replace(COALESCE(l.product, ''), '\s*\|\s*متجر.*$', ''));
        v_variant := NULL; v_price := 0; v_cost := 0;
        SELECT v.id, COALESCE(v.sale_price, 0), COALESCE(v.cost_price, 0)
          INTO v_variant, v_price, v_cost
          FROM public.variants v
         WHERE v.business_id = p_business_id
           AND length(regexp_replace(COALESCE(v.sku, ''), '[^A-Za-z0-9]', '', 'g')) >= 2
           AND v_title ~* ('(^|[^A-Za-z0-9])' || regexp_replace(v.sku, '[^A-Za-z0-9]', '', 'g') || '([^A-Za-z0-9]|$)')
         ORDER BY length(regexp_replace(v.sku, '[^A-Za-z0-9]', '', 'g')) DESC
         LIMIT 1;
        -- No match leaves all three NULL, not as they were set above.
        v_price := COALESCE(v_price, 0); v_cost := COALESCE(v_cost, 0);
        -- A title still holding "store | tagline" is the home page, not a product.
        IF v_variant IS NULL AND (v_title = '' OR v_title LIKE '%|%') THEN
            v_title := 'منتج مش معروف — اسأل العميل';
        END IF;

        v_courier := 0;
        IF l.governorate IS NOT NULL AND v_rates ? l.governorate THEN
            v_courier := COALESCE(NULLIF(v_rates ->> l.governorate, '')::NUMERIC, 0);
        END IF;

        SELECT c.id INTO v_cust FROM public.customers c
         WHERE c.business_id = p_business_id AND c.phone = l.phone LIMIT 1;
        IF v_cust IS NULL THEN
            INSERT INTO public.customers (business_id, name, phone, phone2, address, governorate)
            VALUES (p_business_id, COALESCE(l.name, 'من غير اسم'), l.phone, l.phone2, l.address, l.governorate)
            RETURNING id INTO v_cust;
        END IF;

        INSERT INTO public.orders (
            business_id, customer_id, customer_info, created_at, status, channel, order_type, tags,
            subtotal, shipping_cost, actual_shipping_cost, total_amount, total_cost, payment_status, paid_amount)
        VALUES (
            p_business_id, v_cust,
            jsonb_build_object(
                'name', COALESCE(l.name, 'من غير اسم'), 'phone', l.phone, 'phone2', COALESCE(l.phone2, ''),
                'address', COALESCE(l.address, ''), 'governorate', COALESCE(l.governorate, ''),
                'missed_lead_id', l.id, 'missed_product', l.product, 'missed_page', l.page_url,
                'missed_submitted', l.submitted, 'missed_touches', l.touches),
            l.last_seen_at, 'Waiting', 'Website', 'missed', ARRAY['missed-order'],
            v_price, COALESCE(v_ship, 0), v_courier, v_price + COALESCE(v_ship, 0), v_cost, 'Not Paid', 0)
        RETURNING id INTO v_order;

        INSERT INTO public.order_items (business_id, order_id, variant_id, quantity, price_at_sale, cost_at_sale, unmapped_name)
        VALUES (p_business_id, v_order, v_variant, 1, v_price, v_cost, CASE WHEN v_variant IS NULL THEN v_title END);

        UPDATE public.missed_leads SET status = 'promoted', order_id = v_order WHERE id = l.id;
        v_created := v_created + 1;
    END LOOP;

    RETURN jsonb_build_object('created', v_created);
END $$;
REVOKE ALL ON FUNCTION public.missed_leads_promote(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missed_leads_promote(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- Rollback (the missed orders already created stay, as orders):
--   DROP TRIGGER IF EXISTS trg_orders_missed_confirmed ON public.orders;
--   DROP FUNCTION IF EXISTS public.orders_missed_confirmed();
--   DROP FUNCTION IF EXISTS public.missed_leads_promote(UUID);
--   then re-run 20261025_missed_leads.sql for the earlier functions.
