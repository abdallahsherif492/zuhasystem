-- ===========================================================================
-- Confirmation as a flow: three steps, an instruction on each, never stuck
-- ===========================================================================
-- Every Waiting store order is at one of three steps, worked out from how many
-- times the customer did not answer (orders.confirm_rounds):
--   step 1, new:            call twice; no answer -> send a WhatsApp.
--   step 2, WhatsApp sent:  4 hours later. Check the WhatsApp; no reply -> call twice.
--   step 3, last chance:    the next morning. Check, call twice; no answer -> cancel.
-- What the moderator taps is a confirmation attempt (record_confirmation_attempt):
--   whatsapp_pending  no answer, WhatsApp sent          (a round)
--   no_reply          no answer to calls nor WhatsApp    (a round)
--   no_answer / phone_off                               (a round, as before)
--   call_later, deposit_pending: the time picked (else +3h); thinking,
--   wants_changes, price: +1 day; wrong_number: now; other: +3h.
-- A round's next time: the 1st +4 hours, the 2nd 11:00 Cairo the next day,
-- the 3rd and after: now. next_attempt_at is never left empty for a Waiting
-- order, so no order drops out of the queue; one whose time has come stays
-- in it until someone calls.
-- whatsapp_sent_by / _at: whose phone the WhatsApp went from (moderators use
-- their own numbers), so step 2 goes back to them first.
-- Cancel reasons the customer gave on the phone are added; the daily
-- cancellation review leaves them alone, like "customer refused".
-- Safe to run more than once. Needs 20261119_confirm_queue.sql.

-- ---------------------------------------------------------------------------
-- 1. New attempt reasons and cancel reasons
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_confirmation_attempts DROP CONSTRAINT IF EXISTS order_confirmation_attempts_reason_check;
ALTER TABLE public.order_confirmation_attempts ADD CONSTRAINT order_confirmation_attempts_reason_check CHECK (reason IN (
    'no_answer', 'phone_off', 'wrong_number', 'call_later', 'thinking',
    'whatsapp_pending', 'wants_changes', 'price', 'other', 'no_reply', 'deposit_pending'));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_cancel_reason_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_cancel_reason_check CHECK (cancel_reason IS NULL OR cancel_reason IN (
    'customer_refused', 'no_answer', 'phone_off', 'price', 'duplicate', 'wrong_number', 'fake', 'out_of_stock', 'other',
    'deposit_refused', 'didnt_order', 'changed_mind', 'found_cheaper'));

-- ---------------------------------------------------------------------------
-- 2. Rounds without an answer, and whose phone the WhatsApp went from
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS confirm_rounds   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS whatsapp_sent_by TEXT,
    ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 3. Recording an attempt
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_confirmation_attempt(
    p_order_id UUID, p_reason TEXT, p_note TEXT, p_next_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    o public.orders;
    v_by TEXT := auth.jwt() ->> 'email';
    v_note TEXT := NULLIF(trim(COALESCE(p_note, '')), '');
    v_round BOOLEAN := p_reason IN ('no_answer', 'phone_off', 'whatsapp_pending', 'no_reply');
    v_rounds INTEGER;
    v_cairo TIMESTAMP := now() AT TIME ZONE 'Africa/Cairo';
    v_next TIMESTAMPTZ;
    v_result JSONB;
BEGIN
    SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'gone');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = o.business_id AND lower(bu.user_email) = lower(v_by)) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF lower(trim(COALESCE(o.status, ''))) <> 'waiting' THEN
        RETURN jsonb_build_object('status', 'gone');
    END IF;
    IF p_reason = 'other' AND v_note IS NULL THEN
        RAISE EXCEPTION 'اكتب إيه اللي حصل.' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.order_confirmation_attempts (business_id, order_id, reason, note, attempted_by)
    VALUES (o.business_id, o.id, p_reason, v_note, v_by);

    v_rounds := COALESCE(o.confirm_rounds, 0) + CASE WHEN v_round THEN 1 ELSE 0 END;
    v_next := CASE
        WHEN v_round AND v_rounds = 1 THEN now() + interval '4 hours'
        -- "Tomorrow at 11": after midnight but before 6 it is still the night
        -- shift's day, so 11 the same morning.
        WHEN v_round AND v_rounds = 2 THEN
            ((date_trunc('day', v_cairo) + CASE WHEN extract(hour FROM v_cairo) < 6 THEN interval '0' ELSE interval '1 day' END
              + interval '11 hours') AT TIME ZONE 'Africa/Cairo')
        WHEN v_round THEN now()
        WHEN p_reason = 'wrong_number' THEN now()
        WHEN p_reason IN ('call_later', 'deposit_pending') THEN COALESCE(p_next_at, now() + interval '3 hours')
        WHEN p_reason IN ('thinking', 'wants_changes', 'price') THEN now() + interval '1 day'
        ELSE now() + interval '3 hours'
    END;

    UPDATE public.orders
       SET confirm_attempts    = COALESCE(confirm_attempts, 0) + 1,
           confirm_rounds      = v_rounds,
           last_attempt_at     = now(),
           last_attempt_reason = p_reason,
           last_attempt_note   = v_note,
           last_attempt_by     = v_by,
           next_attempt_at     = v_next,
           whatsapp_sent_by    = CASE WHEN p_reason = 'whatsapp_pending' THEN lower(v_by) ELSE whatsapp_sent_by END,
           whatsapp_sent_at    = CASE WHEN p_reason = 'whatsapp_pending' THEN now() ELSE whatsapp_sent_at END,
           claimed_by          = NULL,
           claimed_at          = NULL
     WHERE id = o.id
    RETURNING jsonb_build_object(
        'status', 'done',
        'confirm_attempts', confirm_attempts,
        'confirm_rounds', confirm_rounds,
        'last_attempt_at', last_attempt_at,
        'last_attempt_reason', last_attempt_reason,
        'last_attempt_note', last_attempt_note,
        'last_attempt_by', last_attempt_by,
        'next_attempt_at', next_attempt_at,
        'whatsapp_sent_by', whatsapp_sent_by,
        'whatsapp_sent_at', whatsapp_sent_at,
        'claimed_by', claimed_by,
        'claimed_at', claimed_at)
    INTO v_result;

    RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.record_confirmation_attempt(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_confirmation_attempt(UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Orders already Waiting join the flow where they stand
-- ---------------------------------------------------------------------------
UPDATE public.orders o
   SET confirm_rounds = a.rounds
  FROM (SELECT order_id, count(*) FILTER (WHERE reason IN ('no_answer', 'phone_off', 'whatsapp_pending', 'no_reply'))::int AS rounds
          FROM public.order_confirmation_attempts GROUP BY order_id) a
 WHERE a.order_id = o.id AND o.confirm_rounds IS DISTINCT FROM a.rounds;

UPDATE public.orders o
   SET whatsapp_sent_by = lower(w.attempted_by), whatsapp_sent_at = w.created_at
  FROM (SELECT DISTINCT ON (order_id) order_id, attempted_by, created_at
          FROM public.order_confirmation_attempts WHERE reason = 'whatsapp_pending'
         ORDER BY order_id, created_at DESC) w
 WHERE w.order_id = o.id AND o.whatsapp_sent_at IS NULL;

-- A Waiting order with no next time (4 tries, a wrong number) is due now.
UPDATE public.orders
   SET next_attempt_at = now()
 WHERE lower(btrim(COALESCE(status, ''))) = 'waiting'
   AND COALESCE(confirm_attempts, 0) > 0
   AND next_attempt_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. The daily cancellation review leaves the new reasons alone
-- ---------------------------------------------------------------------------
-- Same as 20261107_cancellation_review.sql, with the reasons the customer
-- gave on the phone added to the ones a second call would not change.
CREATE OR REPLACE FUNCTION public.cancellation_suspects_core(
    p_business_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_ids UUID[] DEFAULT NULL)
RETURNS TABLE (order_id UUID, score INTEGER, reasons TEXT[], cancelled_at TIMESTAMPTZ, cancelled_by TEXT,
               cancel_reason TEXT, cancel_note TEXT, attempts INTEGER, minutes_to_cancel INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    WITH c AS (
        SELECT o.id, o.created_at, o.customer_id, o.customer_info, o.notes, o.cancel_reason, o.cancel_note,
               o.cancelled_by, o.last_attempt_note, o.last_attempt_reason, COALESCE(o.confirm_attempts, 0) AS summary_attempts,
               COALESCE(o.cancelled_at, o.status_changed_at, o.created_at) AS c_at,
               right(regexp_replace(COALESCE(o.customer_info ->> 'phone', ''), '\D', '', 'g'), 10) AS phone
          FROM public.orders o
         WHERE o.business_id = p_business_id
           AND lower(btrim(COALESCE(o.status, ''))) IN ('cancelled', 'canceled')
           AND COALESCE(o.cancelled_at, o.status_changed_at, o.created_at) >= p_from
           AND COALESCE(o.cancelled_at, o.status_changed_at, o.created_at) < p_to
           AND (p_ids IS NULL OR o.id = ANY (p_ids))
           AND COALESCE(o.order_type, 'new') = 'new'
           AND COALESCE(o.tags::text, '') NOT ILIKE '%missed%'
           AND o.closed_by IS NULL
           AND lower(btrim(COALESCE(o.cancelled_from, 'waiting'))) = 'waiting'
           AND NOT COALESCE(o.stock_deducted, false)
           AND o.courier_sent_at IS NULL
           AND COALESCE(o.cancel_reason, '') NOT IN ('customer_refused', 'duplicate', 'wrong_number', 'fake', 'out_of_stock', 'price',
                                                       'deposit_refused', 'didnt_order', 'changed_mind', 'found_cheaper')
           AND COALESCE(o.last_attempt_reason, '') <> 'wrong_number'
           AND NOT EXISTS (SELECT 1 FROM public.cancellation_reopens r WHERE r.order_id = o.id)
    ),
    f AS (
        SELECT c.*,
               GREATEST(COALESCE(a.n, 0), c.summary_attempts)
                   + CASE WHEN c.cancel_reason IN ('no_answer', 'phone_off') THEN 1 ELSE 0 END AS calls,
               a.span,
               concat_ws(' ', c.cancel_note, c.last_attempt_note, c.notes, c.customer_info ->> 'internal_workbench_notes', a.notes) AS said,
               EXTRACT(epoch FROM (c.c_at - c.created_at)) / 60 AS mins,
               EXISTS (
                   SELECT 1 FROM public.orders x
                    WHERE x.business_id = p_business_id AND x.id <> c.id
                      AND x.created_at BETWEEN c.created_at - interval '3 days' AND c.created_at + interval '3 days'
                      AND COALESCE(x.order_type, 'new') <> 'missed'
                      AND ((c.customer_id IS NOT NULL AND x.customer_id = c.customer_id)
                           OR (length(c.phone) = 10 AND right(regexp_replace(COALESCE(x.customer_info ->> 'phone', ''), '\D', '', 'g'), 10) = c.phone))
               ) AS repeated,
               (c.customer_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.orders x
                    WHERE x.business_id = p_business_id AND x.customer_id = c.customer_id
                      AND lower(btrim(COALESCE(x.status, ''))) IN ('delivered', 'collected')
                      AND x.created_at < c.created_at
               )) AS received_before
          FROM c
          LEFT JOIN LATERAL (
              SELECT count(*)::int AS n, max(t.created_at) - min(t.created_at) AS span, string_agg(t.note, ' ') AS notes
                FROM public.order_confirmation_attempts t WHERE t.order_id = c.id
          ) a ON true
    ),
    scored AS (
        SELECT f.*, s.score, s.reasons
          FROM f
          CROSS JOIN LATERAL (
              SELECT COALESCE(sum(v.p), 0)::int AS score,
                     array_agg(v.r ORDER BY v.p DESC) FILTER (WHERE v.r IS NOT NULL AND v.p > 0) AS reasons
                FROM (VALUES
                    (CASE WHEN f.calls = 0 THEN 45 WHEN f.calls = 1 THEN 25
                          WHEN f.span < interval '1 hour' THEN 15 ELSE 0 END,
                     CASE WHEN f.calls = 0 THEN 'اتلغى من غير ولا محاولة اتصال متسجلة'
                          WHEN f.calls = 1 THEN 'محاولة اتصال واحدة بس'
                          WHEN f.span < interval '1 hour' THEN 'كل محاولات الاتصال في ساعة واحدة' END),
                    (CASE WHEN f.mins < 60 THEN 30 WHEN f.mins < 360 THEN 20 WHEN f.mins < 1440 THEN 10 ELSE 0 END,
                     CASE WHEN f.mins < 60 THEN 'اتلغى في أقل من ساعة من وصوله'
                          WHEN f.mins < 360 THEN 'اتلغى في أول 6 ساعات'
                          WHEN f.mins < 1440 THEN 'اتلغى في نفس يومه' END),
                    (CASE WHEN f.cancel_reason IS NULL OR f.cancel_reason IN ('no_answer', 'phone_off') THEN 10 ELSE 0 END,
                     CASE WHEN f.cancel_reason IS NULL THEN 'اتلغى من غير سبب'
                          WHEN f.cancel_reason IN ('no_answer', 'phone_off') THEN 'اتلغى عشان مابيردش' END),
                    (CASE f.customer_info ->> 'delivery_rate' WHEN 'high' THEN 10 WHEN 'low' THEN -15 ELSE 0 END,
                     CASE WHEN f.customer_info ->> 'delivery_rate' = 'high' THEN 'تقييم استلامه عالي في EasyOrders' END),
                    (CASE WHEN f.received_before THEN 15 ELSE 0 END,
                     CASE WHEN f.received_before THEN 'استلم مننا أوردر قبل كده' END)
                ) v(p, r)
          ) s
         WHERE NOT f.repeated
           AND f.said !~ '(مش ?(عاي?ز|عاوز|عايزه|عاوزه|محتاج|طالب)|رافض|رفض|مكرر|هزار|وهمي|ما ?طلبش|متطلبش|الرقم غلط|رقم غلط|(عاي?ز|عاوز) يلغي|لغى الطلب|لغي الطلب|اشترى من مكان|جاب من بره)'
    )
    SELECT s.id, s.score, COALESCE(s.reasons, '{}'), s.c_at, s.cancelled_by, s.cancel_reason, s.cancel_note,
           s.calls, round(s.mins)::int
      FROM scored s
     WHERE s.score >= 50
     ORDER BY s.score DESC, s.c_at DESC;
$$;
