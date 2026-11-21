-- ===========================================================================
-- The chats list, worked out in the database
-- ===========================================================================
-- The chats page used to read every message of the last 45 days to build its
-- list — about 1 MB on a phone — and PostgREST hands back at most 1,000 rows,
-- so chats older than the last 1,000 messages (a day or two now) did not show
-- at all. whatsapp_chat_list returns one row per customer instead: the last
-- message, how many are waiting for a reply, how many are unread, whether the
-- signed-in member wrote to them, when the customer last wrote, and what the
-- last template was about (confirmation / shipping problem). A conversation's
-- messages are read when it is opened.
-- Runs as the caller, so the usual row security applies. Safe to run again.

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
    SELECT l.customer_phone, n.contact_name, to_jsonb(l),
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

-- The menu's badge: how many chats wait for a reply (the customer wrote
-- last, in the last 7 days). One number, read on every page.
CREATE OR REPLACE FUNCTION public.whatsapp_waiting_count(p_business UUID)
RETURNS INT
LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT count(*)::int FROM (
        SELECT DISTINCT ON (customer_phone) direction
          FROM public.whatsapp_messages
         WHERE business_id = p_business AND type <> 'reaction' AND sent_at >= now() - interval '7 days'
         ORDER BY customer_phone, sent_at DESC
    ) last WHERE direction = 'in'
$$;
GRANT EXECUTE ON FUNCTION public.whatsapp_waiting_count(UUID) TO authenticated;
