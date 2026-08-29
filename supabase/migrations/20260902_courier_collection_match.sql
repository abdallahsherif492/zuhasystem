-- Migration: what the couriers owe, against what they actually paid
-- Created At: 2026-09-02
--
-- get_courier_net_due says what a courier should hand over. The money they
-- actually handed over is already in the books, as revenue transactions under
-- category 'Orders Collection' — 328 of them worth 3,223,533 EGP. Nothing has
-- ever compared the two, so nobody could say whether a courier is behind.
--
-- The two sides are not linked by anything but a habit: whoever books the
-- transfer types the courier's name in the description, and types it however
-- they feel like that day. Telegraf appears as "Telegraph", "Telegrah" and
-- "Telegraph تحصيل"; Xfast as "X-fast" and "تحصيل X Fast"; GoSpeed as
-- "Go Speed", "GoSpeed" and "GOSpeed"; ROC in three different cases. So the
-- match is made on a normalised key — lowercased, everything but letters and
-- digits stripped — plus a four-character prefix, which is what lets
-- "telegraph" and "telegrah" both find "telegraf".
--
-- Measured over the whole history: 238 of 328 transfers attach to a courier
-- and none is ambiguous. The 90 that do not are genuinely unattributable —
-- 28,605 EGP with a blank description, 17,225 described only as "Orders
-- Collection", and a handful of personal orders ("اوردر لعادل"). They are
-- returned as their own row with a NULL company rather than dropped, so the
-- totals still add up and the gap is visible instead of implied.
--
-- The result, all time:
--
--   courier      net due    received   outstanding
--   Telegraf   2,434,102   2,224,045       210,057
--   ROC          572,202     597,042       -24,840
--   Xfast        140,099     138,844         1,255
--   GoSpeed       74,259      88,884       -14,625
--   2MA           47,883      58,010       -10,127
--   Youssef       26,208      28,745        -2,537
--   Islam         18,040      19,980        -1,940
--   TOTAL      3,312,793   3,155,550       157,243   (less 67,983 unattributed)
--
-- A negative outstanding is not a courier overpaying. It means transfers were
-- booked against them for orders this system never marked Collected, which is
-- its own thing to chase.
--
-- Read the period columns with care. What is due is dated by when the order
-- was placed and what was received by when the transfer landed, and a courier
-- pays weeks in arrears, so a single month will never balance and is not
-- supposed to. The cumulative column is the one that means something.
--
-- The real fix is a shipping_company_id on the transaction so a transfer is
-- linked rather than guessed. This reads the history that exists.

-- Normalised key for matching a free-text description to a courier name.
-- Latin letters and digits only: Arabic in a description is noise for this
-- purpose, and a courier whose name is written in Arabic will not match —
-- the length guard below skips it rather than matching everything.
CREATE OR REPLACE FUNCTION public.courier_match_key(t TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT regexp_replace(
               translate(lower(COALESCE(t, '')),
                         '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
                         '01234567890123456789'),
               '[^a-z0-9]', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.get_courier_collection_match(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    shipping_company_id UUID,     -- NULL on the unattributed row
    company_name        TEXT,
    due_period          NUMERIC,  -- payout earned on orders placed in the period
    received_period     NUMERIC,  -- transfers booked in the period
    due_total           NUMERIC,  -- all time
    received_total      NUMERIC,  -- all time
    outstanding         NUMERIC,  -- due_total - received_total
    received_count      INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.business_id = p_business_id
          AND bu.user_email = auth.jwt() ->> 'email'
    ) THEN
        RAISE EXCEPTION 'not a member of this business';
    END IF;

    RETURN QUERY
    WITH col AS (
        SELECT t.transaction_date,
               ABS(t.amount) AS amount,
               (SELECT sc.id
                  FROM public.shipping_companies sc
                 WHERE sc.business_id = p_business_id
                   AND length(public.courier_match_key(sc.name)) >= 3
                   AND (position(public.courier_match_key(sc.name)
                                 IN public.courier_match_key(t.description)) > 0
                     OR (length(public.courier_match_key(sc.name)) >= 4
                         AND position(left(public.courier_match_key(sc.name), 4)
                                      IN public.courier_match_key(t.description)) > 0))
                 -- A whole-name hit always beats a prefix hit, and a longer
                 -- name beats a shorter one, so the most specific courier wins
                 -- instead of whichever the planner happened to reach first.
                 ORDER BY (position(public.courier_match_key(sc.name)
                                    IN public.courier_match_key(t.description)) > 0) DESC,
                          length(public.courier_match_key(sc.name)) DESC
                 LIMIT 1) AS sc_id
          FROM public.transactions t
         WHERE t.business_id = p_business_id
           AND lower(btrim(COALESCE(t.category, ''))) = 'orders collection'
    ),
    recv AS (
        SELECT col.sc_id,
               COALESCE(SUM(col.amount) FILTER (
                   WHERE col.transaction_date >= p_from::DATE
                     AND col.transaction_date <  p_to::DATE), 0) AS recv_period,
               SUM(col.amount)  AS recv_total,
               COUNT(*)::INT    AS n_total
          FROM col
         GROUP BY col.sc_id
    ),
    due AS (
        SELECT v.shipping_company_id AS sc_id,
               MAX(v.company_name)   AS cname,
               COALESCE(SUM(v.expected_payout) FILTER (
                   WHERE v.created_at >= p_from
                     AND v.created_at <  p_to), 0) AS due_period,
               SUM(v.expected_payout) AS due_total
          FROM public.v_courier_payouts v
         WHERE v.business_id = p_business_id
         GROUP BY v.shipping_company_id
    )
    SELECT COALESCE(due.sc_id, recv.sc_id),
           due.cname,
           COALESCE(due.due_period, 0),
           COALESCE(recv.recv_period, 0),
           COALESCE(due.due_total, 0),
           COALESCE(recv.recv_total, 0),
           COALESCE(due.due_total, 0) - COALESCE(recv.recv_total, 0),
           COALESCE(recv.n_total, 0)
      FROM due
      FULL OUTER JOIN recv ON recv.sc_id = due.sc_id
     ORDER BY 5 DESC, 6 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.courier_match_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_courier_collection_match(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT company_name, due_total, received_total, outstanding
--     FROM get_courier_collection_match('<business id>', '2026-08-01', '2026-09-01')
--    ORDER BY due_total DESC;
--   -- matches the table in the header; the NULL company row carries 67,983.
--
--   -- The variants that must all land on Telegraf:
--   SELECT courier_match_key('Telegraph تحصيل');  -- telegraph
--   SELECT courier_match_key('X-fast');           -- xfast
--   SELECT courier_match_key('Go Speed');         -- gospeed
--
--   -- Nothing may be lost between the two views:
--   SELECT sum(received_total) FROM get_courier_collection_match(...);
--   -- must equal
--   SELECT sum(abs(amount)) FROM transactions
--    WHERE business_id = '<id>' AND lower(btrim(category)) = 'orders collection';

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.get_courier_collection_match(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
-- DROP FUNCTION IF EXISTS public.courier_match_key(TEXT);
