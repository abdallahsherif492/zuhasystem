-- Migration: missed orders that a script filled stay out of the queue
-- Created At: 2026-11-02
-- Requires: 20261101_missed_orders_in_queue.sql
--
-- Someone is filling Zuha's order form with a script: a name and a phone set
-- in one go, no address, never an order. EasyOrders catches these as bots and
-- lists them as missed orders; our capture saw them as people, and
-- 20261101 moved the ones with a known product into the sales queue. Now they
-- are marked as bots before anything is moved. Only missed_leads_promote()
-- changes; the rest of 20261101 stands.
--
-- Safe to run again.

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

    -- The form filled the way a script fills it: name and phone dropped in
    -- whole (one input event each, where a person typing makes one per
    -- letter), no address, never ordered. In Zuha's first week of capture
    -- 47 leads looked like this and 3 orders did, all three cancelled; the
    -- people who really ordered typed, or gave an address. EasyOrders marks
    -- the same visitors as bots. They are bots here too, and never reach
    -- the queue. A moderator can still say "not a bot" on the missed page.
    UPDATE public.missed_leads
       SET status = 'bot', bot_score = GREATEST(bot_score, 60),
           bot_reasons = (SELECT ARRAY(SELECT DISTINCT unnest(bot_reasons || ARRAY['الاسم والرقم اتحطوا مرة واحدة من غير كتابة، ومفيش عنوان'])))
     WHERE business_id = p_business_id AND status = 'open' AND handled_at IS NULL
       AND last_seen_at <= now() - interval '15 minutes'
       AND COALESCE((signals ->> 'inputs')::INT, 0) <= 4
       AND COALESCE(btrim(address), '') = '';

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

        -- The product: by the code the store page carries, else a code in its
        -- title ("غسالة PW2 محمولة" — the store's titles are Arabic and the
        -- catalogue's names English, so the code is what they share). A lead
        -- whose product is not known is left out: sales would be confirming
        -- an order for nothing in particular.
        v_title := btrim(regexp_replace(COALESCE(l.product, ''), '\s*\|\s*متجر.*$', ''));
        v_variant := NULL;
        SELECT v.id, COALESCE(v.sale_price, 0), COALESCE(v.cost_price, 0)
          INTO v_variant, v_price, v_cost
          FROM public.variants v
         WHERE v.business_id = p_business_id
           AND length(regexp_replace(COALESCE(v.sku, ''), '[^A-Za-z0-9]', '', 'g')) >= 2
           AND (lower(regexp_replace(v.sku, '[^A-Za-z0-9]', '', 'g')) = lower(regexp_replace(COALESCE(l.product_sku, ''), '[^A-Za-z0-9]', '', 'g'))
                OR v_title ~* ('(^|[^A-Za-z0-9])' || regexp_replace(v.sku, '[^A-Za-z0-9]', '', 'g') || '([^A-Za-z0-9]|$)'))
         ORDER BY (lower(regexp_replace(v.sku, '[^A-Za-z0-9]', '', 'g')) = lower(regexp_replace(COALESCE(l.product_sku, ''), '[^A-Za-z0-9]', '', 'g'))) DESC,
                  length(regexp_replace(v.sku, '[^A-Za-z0-9]', '', 'g')) DESC
         LIMIT 1;
        CONTINUE WHEN v_variant IS NULL;

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

        INSERT INTO public.order_items (business_id, order_id, variant_id, quantity, price_at_sale, cost_at_sale)
        VALUES (p_business_id, v_order, v_variant, 1, v_price, v_cost);

        UPDATE public.missed_leads SET status = 'promoted', order_id = v_order WHERE id = l.id;
        v_created := v_created + 1;
    END LOOP;

    RETURN jsonb_build_object('created', v_created);
END $$;
REVOKE ALL ON FUNCTION public.missed_leads_promote(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missed_leads_promote(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- Rollback: re-run missed_leads_promote() from 20261101_missed_orders_in_queue.sql.
