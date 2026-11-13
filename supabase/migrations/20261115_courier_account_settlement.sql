-- ===========================================================================
-- Courier accounts: settle by statement, close when square
-- ===========================================================================
-- "With couriers" was everything ever due on a courier's orders minus every
-- collection ever booked, since January. Any collection booked under the wrong
-- courier or never booked, any fee the courier charged differently from our
-- estimate, any transfer that arrived 20 EGP short, stayed in that figure for
-- good: Telegraf showed 216,677 EGP owed when its own statement said 40,462.
--
-- A settlement now fixes the account at a point in time:
--   * kind 'statement': the courier's statement says that at `as_of` they
--     owed us `closing_balance`. The orders it lists, and the courier's
--     finished orders from before its first line, are covered by it.
--   * kind 'closing': we agree we are square (balance 0) at `as_of`; every
--     finished order up to then is covered.
-- From the latest one, a courier owes:
--     closing_balance
--   + what is due on its orders no settlement covers yet
--   − collections booked after as_of's day.
-- Couriers never settled this way keep the old all-time figure.
--
-- Reuses shipping_settlements and orders.settlement_id (20260730), which held
-- nothing. Safe to run more than once.

ALTER TABLE public.shipping_settlements
    ADD COLUMN IF NOT EXISTS kind            TEXT NOT NULL DEFAULT 'transfer',
    ADD COLUMN IF NOT EXISTS as_of           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closing_balance NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS source_file     TEXT,
    -- The statement's own totals, for the record: {lines, deliveries, fees,
    -- cash, matched, unknown_refs, first_at, our_estimate_gap}
    ADD COLUMN IF NOT EXISTS totals          JSONB;

DO $$ BEGIN
    ALTER TABLE public.shipping_settlements ADD CONSTRAINT shipping_settlements_kind_check
        CHECK (kind IN ('transfer', 'statement', 'closing'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_settlements_checkpoint
    ON public.shipping_settlements (business_id, shipping_company_id, as_of DESC)
    WHERE closing_balance IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Record a statement or a closing
-- ---------------------------------------------------------------------------
-- p_order_ids: the orders the statement lists (matched by the app). For a
-- statement, the courier's finished orders created before p_covers_before
-- (its first line) are covered too: the balance already reflects them.
CREATE OR REPLACE FUNCTION public.settle_courier_account(
    p_business_id         UUID,
    p_shipping_company_id UUID,
    p_kind                TEXT,
    p_as_of               TIMESTAMPTZ,
    p_closing_balance     NUMERIC,
    p_order_ids           UUID[] DEFAULT '{}',
    p_covers_before       TIMESTAMPTZ DEFAULT NULL,
    p_source_file         TEXT DEFAULT NULL,
    p_totals              JSONB DEFAULT NULL,
    p_notes               TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id       UUID;
    v_before   TIMESTAMPTZ;
    v_count    INTEGER;
    v_expected NUMERIC;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_business_manager(p_business_id) THEN
        RAISE EXCEPTION 'الأونر أو الأدمن بس اللي يقدر يسجّل تسوية.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_kind NOT IN ('statement', 'closing') THEN
        RAISE EXCEPTION 'unknown settlement kind %', p_kind;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.shipping_companies WHERE id = p_shipping_company_id AND business_id = p_business_id) THEN
        RAISE EXCEPTION 'شركة الشحن دي مش موجودة.';
    END IF;
    IF p_as_of IS NULL OR p_closing_balance IS NULL THEN
        RAISE EXCEPTION 'لازم تاريخ ورصيد للتسوية.';
    END IF;

    INSERT INTO public.shipping_settlements
        (business_id, shipping_company_id, settlement_date, kind, as_of, closing_balance,
         expected_amount, received_amount, order_count, source_file, totals, notes, created_by)
    VALUES
        (p_business_id, p_shipping_company_id, (p_as_of AT TIME ZONE 'Africa/Cairo')::date, p_kind, p_as_of,
         round(p_closing_balance, 2), 0, 0, 0, p_source_file, p_totals, p_notes,
         COALESCE(auth.jwt() ->> 'email', 'system'))
    RETURNING id INTO v_id;

    v_before := CASE WHEN p_kind = 'closing' THEN p_as_of ELSE COALESCE(p_covers_before, p_as_of) END;

    -- The orders it covers.
    WITH covered AS (
        UPDATE public.orders o
           SET settlement_id = v_id
         WHERE o.business_id = p_business_id
           AND o.shipping_company_id = p_shipping_company_id
           AND o.settlement_id IS NULL
           AND (o.id = ANY (COALESCE(p_order_ids, '{}'))
                OR (o.created_at < v_before
                    AND (public.is_cod_collected(o.status) OR public.is_cod_returned(o.status))))
        RETURNING o.id
    )
    SELECT count(*), COALESCE(sum(v.expected_payout), 0)
      INTO v_count, v_expected
      FROM covered c JOIN public.v_courier_payouts v ON v.order_id = c.id;

    UPDATE public.shipping_settlements
       SET order_count = v_count, expected_amount = v_expected
     WHERE id = v_id;

    RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.settle_courier_account(UUID, UUID, TEXT, TIMESTAMPTZ, NUMERIC, UUID[], TIMESTAMPTZ, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_courier_account(UUID, UUID, TEXT, TIMESTAMPTZ, NUMERIC, UUID[], TIMESTAMPTZ, TEXT, JSONB, TEXT) TO authenticated;

-- Undo the latest settlement of a courier (a wrong file, a wrong balance).
CREATE OR REPLACE FUNCTION public.undo_courier_settlement(p_settlement_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.shipping_settlements;
BEGIN
    SELECT * INTO s FROM public.shipping_settlements WHERE id = p_settlement_id;
    IF NOT FOUND THEN RETURN; END IF;
    IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_business_manager(s.business_id) THEN
        RAISE EXCEPTION 'الأونر أو الأدمن بس.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF EXISTS (SELECT 1 FROM public.shipping_settlements x
                WHERE x.business_id = s.business_id AND x.shipping_company_id = s.shipping_company_id
                  AND x.closing_balance IS NOT NULL AND x.as_of > s.as_of) THEN
        RAISE EXCEPTION 'فيه تسوية أحدث للشركة دي. الغيها الأول.';
    END IF;
    UPDATE public.orders SET settlement_id = NULL WHERE settlement_id = p_settlement_id;
    DELETE FROM public.shipping_settlements WHERE id = p_settlement_id;
END $$;
REVOKE ALL ON FUNCTION public.undo_courier_settlement(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_courier_settlement(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- What each courier owes: from its latest settlement when it has one
-- ---------------------------------------------------------------------------
-- Same columns as before; due_total / received_total / outstanding now start
-- from the latest settlement. due_period / received_period are unchanged.
CREATE OR REPLACE FUNCTION public.get_courier_collection_match(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    shipping_company_id UUID,
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
    IF COALESCE(auth.role(), '') <> 'service_role' AND NOT EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.business_id = p_business_id
          AND bu.user_email = auth.jwt() ->> 'email'
    ) THEN
        RAISE EXCEPTION 'not a member of this business';
    END IF;

    RETURN QUERY
    WITH cp AS (
        SELECT DISTINCT ON (s.shipping_company_id)
               s.shipping_company_id AS sc_id, s.closing_balance AS balance,
               (s.as_of AT TIME ZONE 'Africa/Cairo')::date AS as_of_day
          FROM public.shipping_settlements s
         WHERE s.business_id = p_business_id AND s.closing_balance IS NOT NULL
         ORDER BY s.shipping_company_id, s.as_of DESC
    ),
    col AS (
        SELECT t.transaction_date,
               ABS(t.amount) AS amount,
               COALESCE(
                   t.shipping_company_id,
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
               -- After the settlement's day only: what came in up to then is
               -- already inside its balance.
               COALESCE(SUM(col.amount) FILTER (
                   WHERE cp.sc_id IS NULL OR col.transaction_date::date > cp.as_of_day), 0) AS recv_total,
               COUNT(*) FILTER (WHERE cp.sc_id IS NULL OR col.transaction_date::date > cp.as_of_day)::INT AS n_total
          FROM col LEFT JOIN cp ON cp.sc_id = col.sc_id
         GROUP BY col.sc_id
    ),
    due AS (
        SELECT v.shipping_company_id AS sc_id,
               MAX(v.company_name)   AS cname,
               COALESCE(SUM(v.expected_payout) FILTER (
                   WHERE v.created_at >= p_from
                     AND v.created_at <  p_to), 0) AS due_period,
               -- Orders no settlement covers; with a settlement, plus its balance.
               COALESCE(SUM(v.expected_payout) FILTER (
                   WHERE cp.sc_id IS NULL OR v.settlement_id IS NULL), 0)
                 + COALESCE(MAX(cp.balance), 0) AS due_total
          FROM public.v_courier_payouts v
          LEFT JOIN cp ON cp.sc_id = v.shipping_company_id
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

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- Re-run the get_courier_collection_match from 20260903_collection_attribution.sql, then:
-- UPDATE public.orders SET settlement_id = NULL WHERE settlement_id IN
--     (SELECT id FROM public.shipping_settlements WHERE kind IN ('statement', 'closing'));
-- DELETE FROM public.shipping_settlements WHERE kind IN ('statement', 'closing');
-- DROP FUNCTION IF EXISTS public.undo_courier_settlement(UUID);
-- DROP FUNCTION IF EXISTS public.settle_courier_account(UUID, UUID, TEXT, TIMESTAMPTZ, NUMERIC, UUID[], TIMESTAMPTZ, TEXT, JSONB, TEXT);
