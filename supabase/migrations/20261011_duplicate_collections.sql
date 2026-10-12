-- Migration: order collections booked more than once, by the order number in
-- the description
-- Created At: 2026-10-11
-- Requires: nothing new
--
-- get_duplicate_deposits (20260901) finds a deposit booked twice by the order
-- the transaction is linked to. Most order collections are not linked to any
-- order: they are typed in by hand, category 'Orders Collection', and the only
-- thing tying one to an order is the number written in its description —
-- "CC01D645", "#5a199ada", "1d364cb0 استلم من المكان ...". Platform Orders
-- writes its own, category 'orders_collection', with the EasyOrders id
-- ("Payment collection for Platform Order 7f52f5dc-...") or the system
-- reference ("#19724d7d (name)").
--
-- So the same order can be collected twice — once from Platform Orders, once
-- by hand a week later — and the two rows share nothing but a number that is
-- written differently in each. On real data: order ee7dd23d, 200 EGP from
-- Platform Orders on 28 September under its EasyOrders id, and 200 EGP again
-- by hand on 4 October as "EE7DD23D".
--
-- get_duplicate_collections reads every order number out of every collection
-- description, resolves it to the order — a full UUID is the order's id or
-- its EasyOrders id; an 8-character code is the first 8 characters of the
-- order's id, any case, with or without '#' — and returns each order named by
-- more than one collection:
--
--   repeated    the same amount booked more than once: almost always the
--               same money twice
--   over_total  different amounts that add up to more than the order's total
--   check       different amounts within the total — often a deposit and
--               the rest, but worth a look
--
-- A number that matches no order is still grouped by itself, so two rows
-- naming the same unknown code are still reported.
--
-- Grouped over all time and returned when any of a group's transactions is
-- dated inside the period, so a pair split across two months is never shown
-- as a single.

CREATE OR REPLACE FUNCTION public.get_duplicate_collections(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    kind          TEXT,      -- 'repeated' | 'over_total' | 'check'
    match_key     TEXT,      -- the order id, or the number itself when no order matches
    order_id      UUID,
    reference     TEXT,      -- the order's first 8 characters, or the number as written
    easyorders_id TEXT,
    customer_name TEXT,
    order_status  TEXT,
    order_total   NUMERIC,
    booked_total  NUMERIC,   -- every collection naming this order
    suspect       NUMERIC,   -- how much of that looks booked twice
    txn_count     INT,
    txns          JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uuid CONSTANT TEXT := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = p_business_id
                      AND lower(bu.user_email) = lower(auth.jwt() ->> 'email')) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH col AS (
        -- 'Orders Collection' by hand, 'orders_collection' from Platform Orders.
        SELECT t.id, t.transaction_date, ABS(t.amount) AS amount, t.category,
               t.account_name, t.description, t.created_at,
               lower(COALESCE(t.description, '')) AS d
          FROM public.transactions t
         WHERE t.business_id = p_business_id
           AND t.type = 'revenue'
           AND lower(regexp_replace(COALESCE(t.category, ''), '[^a-zA-Z]', '', 'g'))
               IN ('orderscollection', 'ordercollection')
    ),
    ords AS (
        SELECT o.id, lower(o.id::text) AS sid, left(lower(o.id::text), 8) AS ref,
               lower(o.easyorders_id::text) AS eo
          FROM public.orders o
         WHERE o.business_id = p_business_id
    ),
    -- Short codes that belong to exactly one order.
    refs AS (
        SELECT ref, min(id::text)::uuid AS id FROM ords GROUP BY ref HAVING count(*) = 1
    ),
    tokens AS (
        -- Full UUIDs: the order's own id, or its EasyOrders id.
        SELECT c.id AS txn_id, COALESCE(a.id, b.id)::text AS order_key, m[1] AS raw
          FROM col c
         CROSS JOIN LATERAL regexp_matches(c.d, '(' || v_uuid || ')', 'g') AS m
          LEFT JOIN ords a ON a.sid = m[1]
          LEFT JOIN ords b ON b.eo = m[1] AND a.id IS NULL
        UNION
        -- 8-character codes, once the UUIDs are out of the way so a UUID's
        -- first block is not read twice.
        SELECT c.id, r.id::text, m[1]
          FROM col c
         CROSS JOIN LATERAL regexp_matches(regexp_replace(c.d, v_uuid, ' ', 'g'),
                                           '(?<![0-9a-z])([0-9a-f]{8})(?![0-9a-z])', 'g') AS m
          LEFT JOIN refs r ON r.ref = m[1]
    ),
    keyed AS (
        SELECT DISTINCT COALESCE(k.order_key, 'n:' || k.raw) AS match_key, k.txn_id
          FROM tokens k
    ),
    grp AS (
        SELECT k.match_key,
               count(*)::int                                   AS n,
               sum(c.amount)                                   AS total,
               sum(c.amount) - (SELECT sum(DISTINCT c2.amount)
                                  FROM keyed k2 JOIN col c2 ON c2.id = k2.txn_id
                                 WHERE k2.match_key = k.match_key) AS repeated_amount,
               bool_or(c.transaction_date >= p_from::date AND c.transaction_date < p_to::date) AS in_window,
               jsonb_agg(jsonb_build_object(
                   'id', c.id, 'date', c.transaction_date, 'amount', c.amount,
                   'category', c.category, 'account', c.account_name,
                   'description', c.description, 'created_at', c.created_at
               ) ORDER BY c.transaction_date, c.created_at)    AS rows
          FROM keyed k JOIN col c ON c.id = k.txn_id
         GROUP BY k.match_key
        HAVING count(*) > 1
    )
    SELECT CASE WHEN g.repeated_amount > 0.009 THEN 'repeated'
                WHEN o.id IS NOT NULL AND g.total > COALESCE(o.total_amount, 0) + 0.01 THEN 'over_total'
                ELSE 'check' END,
           g.match_key,
           o.id,
           COALESCE(left(o.id::text, 8), substr(g.match_key, 3)),
           o.easyorders_id::text,
           o.customer_info ->> 'name',
           o.status,
           o.total_amount,
           g.total,
           GREATEST(g.repeated_amount,
                    CASE WHEN o.id IS NOT NULL THEN g.total - COALESCE(o.total_amount, 0) ELSE 0 END,
                    0),
           g.n,
           g.rows
      FROM grp g
      LEFT JOIN public.orders o ON o.id::text = g.match_key
     WHERE g.in_window
     ORDER BY 10 DESC, 9 DESC;
END $$;

REVOKE ALL ON FUNCTION public.get_duplicate_collections(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_duplicate_collections(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Verify:
--   SELECT kind, reference, booked_total, suspect, txn_count
--     FROM get_duplicate_collections('<business id>', '2026-01-01', '2027-01-01');
--   -- ee7dd23d repeated: 200 + 200 (Platform Orders on 28 Sep, by hand on 4 Oct).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_duplicate_collections(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
