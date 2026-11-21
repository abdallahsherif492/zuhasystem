-- ===========================================================================
-- The chats list, lighter: only what the list shows of the last message
-- ===========================================================================
-- whatsapp_chat_list (20261129) returned each chat's last message whole —
-- the webhook's raw payload, ids, timestamps — about 335 KB for 300 chats.
-- The list shows only its text (cut to 140 characters), type, ticks, time and
-- sender: about 130 KB. Same columns and rows otherwise.
-- Requires 20261129. Safe to run again.

CREATE OR REPLACE FUNCTION public.whatsapp_chat_list(p_business UUID, p_days INT DEFAULT 60)
RETURNS TABLE (
    customer_phone TEXT, contact_name TEXT, last JSONB,
    waiting INT, unread INT, mine BOOLEAN, last_in_at TIMESTAMPTZ, topic TEXT
)
LANGUAGE sql STABLE SET search_path = public AS $$
    WITH m AS (
        SELECT * FROM public.whatsapp_messages
         WHERE business_id = p_business AND type <> 'reaction'
           AND sent_at >= now() - make_interval(days => p_days)
    ),
    last_msg AS (SELECT DISTINCT ON (customer_phone) * FROM m ORDER BY customer_phone, sent_at DESC),
    last_out AS (SELECT customer_phone, max(sent_at) AS at FROM m WHERE direction = 'out' GROUP BY 1),
    last_in  AS (SELECT customer_phone, max(sent_at) AS at FROM m WHERE direction = 'in' GROUP BY 1),
    waiting  AS (
        SELECT m.customer_phone, count(*)::int AS n FROM m LEFT JOIN last_out o USING (customer_phone)
         WHERE m.direction = 'in' AND (o.at IS NULL OR m.sent_at > o.at) GROUP BY 1
    ),
    unread AS (SELECT customer_phone, count(*)::int AS n FROM m WHERE direction = 'in' AND status = 'received' GROUP BY 1),
    mine   AS (SELECT DISTINCT customer_phone FROM m WHERE direction = 'out' AND lower(sent_by) = lower(auth.jwt() ->> 'email')),
    names  AS (SELECT DISTINCT ON (customer_phone) customer_phone, contact_name FROM m WHERE contact_name IS NOT NULL ORDER BY customer_phone, sent_at DESC),
    tpl    AS (
        SELECT DISTINCT ON (customer_phone) customer_phone, template_name, payload ->> 'event' AS ev
          FROM m WHERE direction = 'out' AND template_name IS NOT NULL ORDER BY customer_phone, sent_at DESC
    )
    SELECT l.customer_phone, n.contact_name,
           jsonb_build_object('id', l.id, 'direction', l.direction, 'type', l.type, 'body', left(l.body, 140), 'status', l.status,
                              'sent_at', l.sent_at, 'sent_by', l.sent_by, 'customer_phone', l.customer_phone, 'template_name', l.template_name,
                              'wa_message_id', l.wa_message_id),
           COALESCE(w.n, 0), COALESCE(u.n, 0), (mi.customer_phone IS NOT NULL), li.at,
           CASE WHEN t.template_name IN ('order_confirm', 'order_confirm_photo', 'order_confirmation', 'confirmation_reminder') OR t.ev IN ('confirm', 'reminder') THEN 'confirm'
                WHEN t.template_name IN ('delivery_failed', 'delivery_failed_photo', 'order_returning', 'order_returning_photo') OR t.ev IN ('hold', 'returning') THEN 'shipping'
           END
      FROM last_msg l
      LEFT JOIN names n USING (customer_phone)
      LEFT JOIN waiting w USING (customer_phone)
      LEFT JOIN unread u USING (customer_phone)
      LEFT JOIN mine mi USING (customer_phone)
      LEFT JOIN last_in li USING (customer_phone)
      LEFT JOIN tpl t USING (customer_phone)
     ORDER BY l.sent_at DESC
$$;
GRANT EXECUTE ON FUNCTION public.whatsapp_chat_list(UUID, INT) TO authenticated;
