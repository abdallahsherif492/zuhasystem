-- Migration: take units back out of the damaged pile
-- Created At: 2026-09-10
--
-- A damage was a one-way door. Once a unit was recorded as damaged it stayed
-- damaged forever, and the loss stayed on the books forever, even though a lot
-- of damaged stock does not end there: some goes back to the supplier for a
-- credit or a replacement, some gets repaired and sold, and some was recorded
-- against the wrong product in the first place. None of that could be written
-- down, so the damages total only ever grew and stopped describing reality.
--
-- A resolution is recorded rather than the damage being edited or deleted. The
-- damage happened; what changed is what became of the goods afterwards, and
-- keeping both rows is what lets the history still add up.
--
-- What a resolution does depends on where the goods end up, and the two
-- outcomes the business asked about move stock in opposite directions:
--
--   repaired / recorded by mistake
--       The units are sellable again. They go back on the shelf — the damage
--       trigger took them off when the damage was recorded — and the loss on
--       them is reversed in full.
--
--   returned to supplier / sold as-is / other
--       The units leave the business, so stock does not move. The loss is
--       reduced by whatever actually came back: the supplier's credit, the
--       discounted sale price. That is typed in, because it is rarely the full
--       cost and pretending otherwise would overstate the recovery.
--
-- The net figure every report uses is damages minus recoveries, dated by when
-- each happened: a unit broken in July and repaired in September is a July loss
-- and a September recovery, not a July loss that silently shrinks.

-- ===========================================================================
-- 1. The table
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.inventory_damage_resolutions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    variant_id      UUID NOT NULL REFERENCES public.variants(id)   ON DELETE CASCADE,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    resolution      TEXT NOT NULL CHECK (resolution IN (
                        'repaired', 'returned_to_supplier', 'recorded_by_mistake',
                        'sold_as_is', 'other')),
    -- Whether the units went back into sellable stock. Stored rather than
    -- inferred from `resolution` so an unusual case can still be recorded
    -- honestly — a repaired unit kept aside as a sample, say.
    restocked       BOOLEAN NOT NULL DEFAULT false,
    -- Cost per unit these units were written off at. Filled in by the trigger
    -- from the damages themselves when the app does not send it.
    unit_cost       NUMERIC CHECK (unit_cost IS NULL OR unit_cost >= 0),
    -- What came back. Reduces the damages loss by exactly this much.
    recovered_value NUMERIC NOT NULL DEFAULT 0 CHECK (recovered_value >= 0),
    date            TIMESTAMPTZ NOT NULL,
    notes           TEXT,
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_damage_resolutions IS
    'Units taken back out of inventory_damages — repaired, returned to the '
    'supplier, or recorded by mistake. Never edited: a wrong resolution is '
    'corrected by recording the damage again.';

CREATE INDEX IF NOT EXISTS idx_damage_resolutions_variant
    ON public.inventory_damage_resolutions (business_id, variant_id);
CREATE INDEX IF NOT EXISTS idx_damage_resolutions_date
    ON public.inventory_damage_resolutions (business_id, date);

-- ===========================================================================
-- 2. You cannot resolve what is not there
-- ===========================================================================
-- Checked in the database, not only in the form. Two people resolving the last
-- damaged unit of a product at the same moment would each see one open and
-- each succeed; the row lock on the variant makes the second one wait, recount,
-- and fail cleanly.
CREATE OR REPLACE FUNCTION public.check_damage_resolution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_damaged  BIGINT;
    v_resolved BIGINT;
    v_loss     NUMERIC;
BEGIN
    PERFORM 1 FROM public.variants WHERE id = NEW.variant_id FOR UPDATE;

    SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(total_loss), 0)
      INTO v_damaged, v_loss
      FROM public.inventory_damages
     WHERE business_id = NEW.business_id AND variant_id = NEW.variant_id;

    SELECT COALESCE(SUM(quantity), 0)
      INTO v_resolved
      FROM public.inventory_damage_resolutions
     WHERE business_id = NEW.business_id AND variant_id = NEW.variant_id;

    IF NEW.quantity > v_damaged - v_resolved THEN
        RAISE EXCEPTION 'Only % damaged unit(s) of this product are still open; cannot remove %.',
            v_damaged - v_resolved, NEW.quantity
            USING ERRCODE = 'check_violation';
    END IF;

    -- Valued at what these units were actually written off at, averaged over
    -- the product's damages, so reversing them undoes the loss that was
    -- booked rather than today's cost price.
    IF NEW.unit_cost IS NULL THEN
        NEW.unit_cost := CASE WHEN v_damaged > 0 THEN ROUND(v_loss / v_damaged, 2) ELSE 0 END;
    END IF;

    -- Back on the shelf means the whole cost came back.
    IF NEW.restocked THEN
        NEW.recovered_value := ROUND(NEW.quantity * NEW.unit_cost, 2);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_damage_resolution ON public.inventory_damage_resolutions;
CREATE TRIGGER trg_check_damage_resolution
    BEFORE INSERT ON public.inventory_damage_resolutions
    FOR EACH ROW EXECUTE FUNCTION public.check_damage_resolution();

-- ===========================================================================
-- 3. Repaired stock goes back on the shelf
-- ===========================================================================
-- The mirror of apply_damage_stock: that trigger took the units off when the
-- damage was recorded, this one puts them back, and both write the ledger so
-- the inventory reconciliation keeps agreeing with the counter.
--
-- 'restock' is reused as the ledger type rather than inventing a new one —
-- it is exactly what happened, and the reference_id points at this row.
CREATE OR REPLACE FUNCTION public.apply_damage_resolution_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.restocked THEN
        UPDATE public.variants
           SET stock_qty = stock_qty + NEW.quantity
         WHERE id = NEW.variant_id;

        INSERT INTO public.inventory_transactions
            (business_id, variant_id, quantity_change, transaction_type, reference_id, note)
        VALUES (NEW.business_id, NEW.variant_id, NEW.quantity, 'restock', NEW.id,
                COALESCE(NULLIF(btrim(NEW.notes), ''),
                         'Back from damages: ' || replace(NEW.resolution, '_', ' ')));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_damage_resolution_stock ON public.inventory_damage_resolutions;
CREATE TRIGGER trg_apply_damage_resolution_stock
    AFTER INSERT ON public.inventory_damage_resolutions
    FOR EACH ROW EXECUTE FUNCTION public.apply_damage_resolution_stock();

-- ===========================================================================
-- 4. Access
-- ===========================================================================
-- Read and insert only. A resolution that moved stock cannot be quietly edited
-- or deleted without leaving the counter wrong, so there are no UPDATE or
-- DELETE policies: the table is append-only, like the ledger it feeds.
ALTER TABLE public.inventory_damage_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS damage_resolutions_select ON public.inventory_damage_resolutions;
CREATE POLICY damage_resolutions_select
    ON public.inventory_damage_resolutions FOR SELECT
    USING (business_id IN (SELECT public.get_my_business_ids())
           OR public.am_i_admin_of_business(business_id));

DROP POLICY IF EXISTS damage_resolutions_insert ON public.inventory_damage_resolutions;
CREATE POLICY damage_resolutions_insert
    ON public.inventory_damage_resolutions FOR INSERT
    WITH CHECK (business_id IN (SELECT public.get_my_business_ids())
                OR public.am_i_admin_of_business(business_id));

GRANT SELECT, INSERT ON public.inventory_damage_resolutions TO authenticated;

-- In the actions log with everything else, through the same row trigger the
-- damages table already uses.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'log_row_change') THEN
        DROP TRIGGER IF EXISTS trg_audit_inventory_damage_resolutions
            ON public.inventory_damage_resolutions;
        CREATE TRIGGER trg_audit_inventory_damage_resolutions
            AFTER INSERT OR UPDATE OR DELETE ON public.inventory_damage_resolutions
            FOR EACH ROW EXECUTE FUNCTION public.log_row_change('inventory');
    END IF;
END $$;

-- ===========================================================================
-- 5. One net figure for every report
-- ===========================================================================
-- Damages as positive loss, resolutions as negative, each on its own date. A
-- reader sums `loss` over a period and gets damages net of recoveries without
-- knowing two tables exist.
--
-- security_invoker so the view answers with the caller's rights: without it a
-- view runs as its owner, skips the RLS on both tables, and would hand one
-- tenant another tenant's damages.
CREATE OR REPLACE VIEW public.v_damage_ledger
WITH (security_invoker = true) AS
SELECT d.id, d.business_id, d.variant_id, d.date,
       d.quantity                AS quantity,
       d.total_loss              AS loss,
       'damage'::TEXT            AS kind
  FROM public.inventory_damages d
UNION ALL
SELECT r.id, r.business_id, r.variant_id, r.date,
       -r.quantity               AS quantity,
       -r.recovered_value        AS loss,
       'resolution'::TEXT        AS kind
  FROM public.inventory_damage_resolutions r;

GRANT SELECT ON public.v_damage_ledger TO authenticated;

-- The monthly table reported gross damages and would now disagree with the
-- actual-returns card beside it, which reads the net. Restated in full with
-- only the damages source changed.
CREATE OR REPLACE FUNCTION public.get_monthly_performance(
    p_business_id UUID,
    p_year        INTEGER
)
RETURNS TABLE (
    month        INTEGER,
    orders_count BIGINT,
    revenue      NUMERIC,
    cogs         NUMERIC,
    courier_cost NUMERIC,
    opex         NUMERIC,
    ads          NUMERIC,
    damages      NUMERIC,
    net_profit   NUMERIC,
    margin       NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    y_start TIMESTAMPTZ := make_timestamptz(p_year, 1, 1, 0, 0, 0);
    y_end   TIMESTAMPTZ := make_timestamptz(p_year + 1, 1, 1, 0, 0, 0);
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.business_id = p_business_id
          AND bu.user_email = auth.jwt() ->> 'email'
    ) THEN
        RAISE EXCEPTION 'not a member of this business';
    END IF;

    RETURN QUERY
    WITH months AS (
        SELECT generate_series(1, 12) AS m
    ),
    ord AS (
        SELECT EXTRACT(MONTH FROM o.created_at)::INT AS m,
               COUNT(*)                        AS cnt,
               COALESCE(SUM(o.total_amount), 0)          AS revenue,
               COALESCE(SUM(o.total_cost), 0)            AS cogs,
               COALESCE(SUM(o.actual_shipping_cost), 0)  AS courier
        FROM public.orders o
        WHERE o.business_id = p_business_id
          AND lower(btrim(coalesce(o.status, ''))) = 'collected'
          AND o.created_at >= y_start AND o.created_at < y_end
        GROUP BY 1
    ),
    tx AS (
        SELECT EXTRACT(MONTH FROM t.transaction_date)::INT AS m,
               COALESCE(SUM(ABS(t.amount)) FILTER (
                   WHERE lower(btrim(coalesce(t.category, ''))) NOT IN ('purchases', 'ads')), 0) AS opex,
               COALESCE(SUM(ABS(t.amount)) FILTER (
                   WHERE lower(btrim(coalesce(t.category, ''))) = 'ads'), 0) AS ads
        FROM public.transactions t
        WHERE t.business_id = p_business_id
          AND lower(btrim(coalesce(t.type, ''))) = 'expense'
          AND t.transaction_date >= y_start::DATE
          AND t.transaction_date <  y_end::DATE
        GROUP BY 1
    ),
    dmg AS (
        -- Net of recoveries, dated by when each happened.
        SELECT EXTRACT(MONTH FROM d.date)::INT AS m,
               COALESCE(SUM(d.loss), 0)        AS loss
        FROM public.v_damage_ledger d
        WHERE d.business_id = p_business_id
          AND d.date >= y_start::DATE AND d.date < y_end::DATE
        GROUP BY 1
    )
    SELECT
        months.m,
        COALESCE(ord.cnt, 0)::BIGINT,
        ROUND(COALESCE(ord.revenue, 0), 2),
        ROUND(COALESCE(ord.cogs, 0), 2),
        ROUND(COALESCE(ord.courier, 0), 2),
        ROUND(COALESCE(tx.opex, 0), 2),
        ROUND(COALESCE(tx.ads, 0), 2),
        ROUND(COALESCE(dmg.loss, 0), 2),
        ROUND(COALESCE(ord.revenue, 0) - COALESCE(ord.cogs, 0)
              - COALESCE(tx.opex, 0) - COALESCE(tx.ads, 0)
              - COALESCE(ord.courier, 0), 2),
        CASE WHEN COALESCE(ord.revenue, 0) > 0
             THEN ROUND(100.0 * (COALESCE(ord.revenue, 0) - COALESCE(ord.cogs, 0)
                                 - COALESCE(tx.opex, 0) - COALESCE(tx.ads, 0)
                                 - COALESCE(ord.courier, 0))
                        / ord.revenue, 2)
             ELSE NULL
        END
    FROM months
    LEFT JOIN ord ON ord.m = months.m
    LEFT JOIN tx  ON tx.m  = months.m
    LEFT JOIN dmg ON dmg.m = months.m
    ORDER BY months.m;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_monthly_performance(UUID, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- Verify
-- ===========================================================================
--   -- Refused: more than is open.
--   INSERT INTO inventory_damage_resolutions (business_id, variant_id, quantity, resolution, date)
--   VALUES ('<b>', '<variant with 1 damaged>', 5, 'repaired', now());   -- check_violation
--
--   -- Accepted, restocked: stock_qty +1, one 'restock' ledger row, and the
--   -- inventory reconciliation still returns nothing for this variant.
--   INSERT INTO inventory_damage_resolutions
--          (business_id, variant_id, quantity, resolution, restocked, date)
--   VALUES ('<b>', '<v>', 1, 'repaired', true, now());
--
--   SELECT sum(loss) FROM v_damage_ledger WHERE business_id = '<b>';
--   -- 13,083 before any resolution; lower by exactly the recovered_value after.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP VIEW IF EXISTS public.v_damage_ledger;
-- DROP TABLE IF EXISTS public.inventory_damage_resolutions;
-- DROP FUNCTION IF EXISTS public.check_damage_resolution();
-- DROP FUNCTION IF EXISTS public.apply_damage_resolution_stock();
-- (and re-run 20260818_monthly_performance.sql for the previous damages column)
