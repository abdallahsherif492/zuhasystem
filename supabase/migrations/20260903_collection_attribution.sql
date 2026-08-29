-- Migration: link a courier transfer to its courier, and stop counting
--            returned parcels as cash the courier collected
-- Created At: 2026-09-03
--
-- Three things, all in the settlement comparison.
--
-- 1. transactions.shipping_company_id
--    20260902 matched a transfer to a courier by reading the name out of the
--    description, because that was the only signal the history carried. It
--    works — 238 of 328 — but guessing from prose is not where this should
--    stay. The column makes the link explicit, the accounting screen now asks
--    for it, and the match function prefers it and only falls back to reading
--    the description for rows that predate it.
--
-- 2. The 90 unattributable transfers become fixable.
--    get_unattributed_collections lists them so a courier can be assigned by
--    hand instead of the money sitting in an "unknown" bucket forever.
--
-- 3. A bug in get_courier_net_due.
--    collected_total summed collected_amount over every row in the payout
--    view, and that view includes returned parcels. A returned parcel
--    collected nothing — the customer paid nothing and the goods came back —
--    so the card overstated what couriers took from customers by the full
--    value of every return. On August: 724,527 shown against 611,972 actual,
--    inflated by the 222 returns. net_due was always right, because it sums
--    expected_payout which is already zero for a return; only the card
--    reporting the collected figure was wrong, and it is the one a person
--    reads to sanity-check the other two.
--
-- Deposits and shipping were already handled correctly and are left alone.
-- v_courier_payouts defines collected_amount as total_amount - paid_amount, so
-- a deposit taken from the customer up front never counts as money the courier
-- collected: 154,855 EGP across 1,411 orders is deducted this way. Shipping is
-- subtracted from the delivered side only, since a return's cost is already
-- carried inside its own negative payout.

-- ===========================================================================
-- 1. The column
-- ===========================================================================
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS shipping_company_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'transactions_shipping_company_id_fkey'
           AND conrelid = 'public.transactions'::regclass
    ) THEN
        -- SET NULL, never CASCADE: deleting a courier must not delete the
        -- record of money they transferred.
        ALTER TABLE public.transactions
            ADD CONSTRAINT transactions_shipping_company_id_fkey
            FOREIGN KEY (shipping_company_id)
            REFERENCES public.shipping_companies (id)
            ON DELETE SET NULL;
    END IF;
END $$;

COMMENT ON COLUMN public.transactions.shipping_company_id IS
    'Which courier this Orders Collection transfer came from. Explicit since '
    '2026-09-03; older rows were backfilled by matching the courier name out '
    'of the description.';

CREATE INDEX IF NOT EXISTS idx_transactions_shipping_company
    ON public.transactions (business_id, shipping_company_id)
    WHERE shipping_company_id IS NOT NULL;

-- Backfill from the name in the description — the same rule 20260902 reads
-- with, run once so the column starts out as complete as the guess was.
UPDATE public.transactions t
   SET shipping_company_id = sc.id
  FROM public.shipping_companies sc
 WHERE t.shipping_company_id IS NULL
   AND lower(btrim(COALESCE(t.category, ''))) = 'orders collection'
   AND sc.business_id = t.business_id
   AND length(public.courier_match_key(sc.name)) >= 3
   AND (position(public.courier_match_key(sc.name)
                 IN public.courier_match_key(t.description)) > 0
     OR (length(public.courier_match_key(sc.name)) >= 4
         AND position(left(public.courier_match_key(sc.name), 4)
                      IN public.courier_match_key(t.description)) > 0))
   -- Only when exactly one courier claims it; an ambiguous description is
   -- left for a human rather than resolved by whichever row came first.
   AND (SELECT COUNT(*) FROM public.shipping_companies s2
         WHERE s2.business_id = t.business_id
           AND length(public.courier_match_key(s2.name)) >= 3
           AND (position(public.courier_match_key(s2.name)
                         IN public.courier_match_key(t.description)) > 0
             OR (length(public.courier_match_key(s2.name)) >= 4
                 AND position(left(public.courier_match_key(s2.name), 4)
                              IN public.courier_match_key(t.description)) > 0))) = 1;

-- ===========================================================================
-- 2. collected_total must exclude returns
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_courier_net_due(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    shipping_company_id UUID,
    company_name        TEXT,
    delivered_count     BIGINT,
    returned_count      BIGINT,
    collected_total     NUMERIC,   -- cash the courier took from customers
    shipping_total      NUMERIC,   -- what the courier charges us for those
    net_due             NUMERIC,   -- what should actually reach our treasury
    settled_count       BIGINT,
    unsettled_net       NUMERIC
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
    SELECT
        p.shipping_company_id,
        p.company_name,
        COUNT(*) FILTER (WHERE public.is_cod_collected(p.status))::BIGINT,
        COUNT(*) FILTER (WHERE public.is_cod_returned(p.status))::BIGINT,
        -- Delivered only. A returned parcel collected nothing: the customer
        -- paid nothing and the goods came back. Summing every row here counted
        -- the value of every return as cash in the courier's hands.
        ROUND(COALESCE(SUM(p.collected_amount) FILTER (
            WHERE public.is_cod_collected(p.status)), 0), 2),
        -- Only the delivered side carries a shipping charge in this figure;
        -- a return's cost is already inside its negative expected_payout.
        ROUND(COALESCE(SUM(p.actual_shipping_cost) FILTER (
            WHERE public.is_cod_collected(p.status)), 0), 2),
        ROUND(COALESCE(SUM(p.expected_payout), 0), 2),
        COUNT(*) FILTER (WHERE p.settlement_id IS NOT NULL)::BIGINT,
        ROUND(COALESCE(SUM(p.expected_payout) FILTER (
            WHERE p.settlement_id IS NULL), 0), 2)
    FROM public.v_courier_payouts p
    WHERE p.business_id = p_business_id
      AND p.created_at >= p_from
      AND p.created_at <  p_to
    GROUP BY p.shipping_company_id, p.company_name
    HAVING COUNT(*) > 0
    ORDER BY 7 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_courier_net_due(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ===========================================================================
-- 3. Prefer the column, fall back to the description
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_courier_collection_match(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    shipping_company_id UUID,     -- NULL on the unattributed row
    company_name        TEXT,
    due_period          NUMERIC,
    received_period     NUMERIC,
    due_total           NUMERIC,
    received_total      NUMERIC,
    outstanding         NUMERIC,
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
               COALESCE(
                   t.shipping_company_id,
                   -- Older rows, and anything typed before the field existed.
                   (SELECT sc.id
                      FROM public.shipping_companies sc
                     WHERE sc.business_id = p_business_id
                       AND length(public.courier_match_key(sc.name)) >= 3
                       AND (position(public.courier_match_key(sc.name)
                                     IN public.courier_match_key(t.description)) > 0
                         OR (length(public.courier_match_key(sc.name)) >= 4
                             AND position(left(public.courier_match_key(sc.name), 4)
                                          IN public.courier_match_key(t.description)) > 0))
                     ORDER BY (position(public.courier_match_key(sc.name)
                                        IN public.courier_match_key(t.description)) > 0) DESC,
                              length(public.courier_match_key(sc.name)) DESC
                     LIMIT 1)) AS sc_id
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

GRANT EXECUTE ON FUNCTION public.get_courier_collection_match(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ===========================================================================
-- 4. The ones nobody can attribute — so they can be fixed
-- ===========================================================================
-- Every 'Orders Collection' row that neither carries a courier nor names one
-- in its description. Not filtered by period: an unattributed transfer from
-- April is exactly as wrong as one from today, and hiding it behind the date
-- picker is how it stayed unnoticed.
CREATE OR REPLACE FUNCTION public.get_unattributed_collections(
    p_business_id UUID
)
RETURNS TABLE (
    id               UUID,
    transaction_date DATE,
    amount           NUMERIC,
    account_name     TEXT,
    description      TEXT
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
    SELECT t.id, t.transaction_date, ABS(t.amount), t.account_name, t.description
      FROM public.transactions t
     WHERE t.business_id = p_business_id
       AND lower(btrim(COALESCE(t.category, ''))) = 'orders collection'
       AND t.shipping_company_id IS NULL
       AND NOT EXISTS (
           SELECT 1 FROM public.shipping_companies sc
            WHERE sc.business_id = p_business_id
              AND length(public.courier_match_key(sc.name)) >= 3
              AND (position(public.courier_match_key(sc.name)
                            IN public.courier_match_key(t.description)) > 0
                OR (length(public.courier_match_key(sc.name)) >= 4
                    AND position(left(public.courier_match_key(sc.name), 4)
                                 IN public.courier_match_key(t.description)) > 0)))
     ORDER BY ABS(t.amount) DESC, t.transaction_date DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unattributed_collections(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT count(*) FROM transactions
--    WHERE lower(btrim(category)) = 'orders collection'
--      AND shipping_company_id IS NOT NULL;            -- 238 after backfill
--
--   SELECT count(*), sum(amount) FROM get_unattributed_collections('<id>');
--   -- 90 rows, 67,983 EGP
--
--   SELECT collected_total, shipping_total, net_due
--     FROM get_courier_net_due('<id>', '2026-08-01', '2026-09-01');
--   -- collected_total must now be 611,972 rather than 724,527, and
--   -- collected_total - shipping_total must equal net_due while every
--   -- courier fee is still zero.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.get_unattributed_collections(UUID);
-- ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_shipping_company_id_fkey;
-- ALTER TABLE public.transactions DROP COLUMN IF EXISTS shipping_company_id;
