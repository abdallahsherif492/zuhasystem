-- Migration: COD settlement / courier reconciliation
-- Created At: 2026-07-30
--
-- Couriers collect cash on delivery and transfer it weeks later, minus shipping,
-- a collection percentage, and fees on returned parcels. Nothing recorded a
-- payout ever arriving, so there was no way to answer: how much is sitting with
-- each courier, was the transfer that landed short, which orders are still
-- unpaid. Merchants reconcile this in Excel today.
--
-- Note: `Collected` in this system means delivered/confirmed, NOT money
-- received. Settlement is therefore tracked separately rather than by
-- overloading order status.

-- ===========================================================================
-- 1. Fee model per courier
-- ===========================================================================
-- Both default to 0 so every expected figure is unchanged until a real fee is
-- entered — no silent reinterpretation of existing orders.
ALTER TABLE public.shipping_companies
    ADD COLUMN IF NOT EXISTS cod_fee_percent NUMERIC(6,3) NOT NULL DEFAULT 0;

ALTER TABLE public.shipping_companies
    ADD COLUMN IF NOT EXISTS return_fee NUMERIC(10,2) NOT NULL DEFAULT 0;

-- ===========================================================================
-- 2. Settlements
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.shipping_settlements (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id          UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    shipping_company_id  UUID REFERENCES public.shipping_companies(id) ON DELETE SET NULL,
    settlement_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    reference            TEXT,                 -- bank / transfer reference
    expected_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    received_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- Positive = courier paid more than expected, negative = short.
    difference           NUMERIC(12,2) GENERATED ALWAYS AS (received_amount - expected_amount) STORED,
    order_count          INTEGER NOT NULL DEFAULT 0,
    account_name         TEXT,                 -- treasury the money landed in
    notes                TEXT,
    created_by           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlements_business ON public.shipping_settlements(business_id);
CREATE INDEX IF NOT EXISTS idx_settlements_company  ON public.shipping_settlements(shipping_company_id);

-- An order is outstanding while settlement_id IS NULL. A FK rather than a
-- boolean so each order traces to the exact payout that covered it, and a
-- courier settling some orders now and the rest later works naturally.
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS settlement_id UUID REFERENCES public.shipping_settlements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_settlement ON public.orders(settlement_id);

-- Left permissive to match every other tenant table in this project. Note the
-- app filters business_id on every query (see commit cfbaf9f).
ALTER TABLE public.shipping_settlements DISABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- 3. Which statuses are settleable
-- ===========================================================================
-- Money is with the courier once the parcel reached the customer. Collected and
-- Delivered both mean that here. Shipped / Returning / Hold To redeliver are
-- still in transit — nothing to settle yet. Returned means the parcel came back:
-- no cash, but the courier still bills a return fee.
CREATE OR REPLACE FUNCTION public.is_cod_collected(p_status TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(btrim(coalesce(p_status,''))) IN ('delivered','collected');
$$;

CREATE OR REPLACE FUNCTION public.is_cod_returned(p_status TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(btrim(coalesce(p_status,''))) IN ('returned');
$$;

-- ===========================================================================
-- 4. Expected payout, defined once
-- ===========================================================================
-- Every screen and report reads this, so the arithmetic can never diverge
-- between the outstanding card, the settlement form, and history.
--
--   collected = total_amount - paid_amount   (a deposit never reaches the courier)
--   delivered : collected - actual_shipping_cost - cod_fee% * collected
--   returned  : -return_fee                  (we owe them)
CREATE OR REPLACE VIEW public.v_courier_payouts AS
SELECT
    o.id                AS order_id,
    o.business_id,
    o.shipping_company_id,
    sc.name             AS company_name,
    o.status,
    o.created_at,
    o.settlement_id,
    o.customer_info,
    o.total_amount,
    o.paid_amount,
    o.actual_shipping_cost,
    GREATEST(COALESCE(o.total_amount,0) - COALESCE(o.paid_amount,0), 0) AS collected_amount,
    CASE
        WHEN public.is_cod_collected(o.status) THEN
            ROUND(
                GREATEST(COALESCE(o.total_amount,0) - COALESCE(o.paid_amount,0), 0)
                - COALESCE(o.actual_shipping_cost,0)
                - (GREATEST(COALESCE(o.total_amount,0) - COALESCE(o.paid_amount,0), 0)
                   * COALESCE(sc.cod_fee_percent,0) / 100.0)
            , 2)
        WHEN public.is_cod_returned(o.status) THEN
            -ROUND(COALESCE(sc.return_fee,0), 2)
        ELSE 0
    END AS expected_payout
FROM public.orders o
JOIN public.shipping_companies sc ON sc.id = o.shipping_company_id
WHERE o.shipping_company_id IS NOT NULL
  AND (public.is_cod_collected(o.status) OR public.is_cod_returned(o.status));

-- ===========================================================================
-- 5. Outstanding per courier — aggregated in SQL
-- ===========================================================================
-- ~7.6k orders: this must not be summed in the browser.
CREATE OR REPLACE FUNCTION public.get_courier_outstanding(p_business_id UUID)
RETURNS TABLE (
    shipping_company_id UUID,
    company_name        TEXT,
    order_count         BIGINT,
    collected_total     NUMERIC,
    expected_total      NUMERIC,
    oldest_order_at     TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.shipping_company_id, p.company_name, COUNT(*),
           COALESCE(SUM(p.collected_amount),0),
           COALESCE(SUM(p.expected_payout),0),
           MIN(p.created_at)
    FROM public.v_courier_payouts p
    WHERE p.business_id = p_business_id
      AND p.settlement_id IS NULL
    GROUP BY p.shipping_company_id, p.company_name
    ORDER BY COALESCE(SUM(p.expected_payout),0) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_courier_outstanding(UUID) TO authenticated;

-- Aging buckets for money a courier has been holding too long.
CREATE OR REPLACE FUNCTION public.get_courier_aging(p_business_id UUID)
RETURNS TABLE (
    shipping_company_id UUID,
    company_name        TEXT,
    bucket              TEXT,
    order_count         BIGINT,
    expected_total      NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.shipping_company_id, p.company_name,
           CASE
               WHEN p.created_at > NOW() - INTERVAL '7 days'  THEN '0-7'
               WHEN p.created_at > NOW() - INTERVAL '15 days' THEN '8-15'
               WHEN p.created_at > NOW() - INTERVAL '30 days' THEN '16-30'
               ELSE '30+'
           END,
           COUNT(*), COALESCE(SUM(p.expected_payout),0)
    FROM public.v_courier_payouts p
    WHERE p.business_id = p_business_id AND p.settlement_id IS NULL
    GROUP BY 1,2,3
    ORDER BY 2,3;
$$;

GRANT EXECUTE ON FUNCTION public.get_courier_aging(UUID) TO authenticated;

-- ===========================================================================
-- 6. Record a settlement atomically
-- ===========================================================================
-- Creates the settlement, stamps the covered orders, and posts the RECEIVED
-- amount to the treasury. Expected is stored for the audit trail but never
-- enters the books — the shortfall is a reconciliation figure, not income.
--
-- Only ever claims orders that are still unsettled and belong to this business
-- and courier, so a stale browser tab cannot re-settle an order that another
-- user already covered.
CREATE OR REPLACE FUNCTION public.record_courier_settlement(
    p_business_id         UUID,
    p_shipping_company_id UUID,
    p_order_ids           UUID[],
    p_received_amount     NUMERIC,
    p_settlement_date     DATE DEFAULT CURRENT_DATE,
    p_reference           TEXT DEFAULT NULL,
    p_account_name        TEXT DEFAULT NULL,
    p_notes               TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_email    TEXT := auth.jwt() ->> 'email';
    v_expected NUMERIC := 0;
    v_count    INTEGER := 0;
    v_id       UUID;
BEGIN
    IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'اختار الأوردرات اللي التحويل بيغطيها الأول.' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(SUM(expected_payout),0), COUNT(*)
      INTO v_expected, v_count
    FROM public.v_courier_payouts
    WHERE business_id = p_business_id
      AND shipping_company_id = p_shipping_company_id
      AND settlement_id IS NULL
      AND order_id = ANY(p_order_ids);

    IF v_count = 0 THEN
        RAISE EXCEPTION 'الأوردرات دي متسوّية بالفعل أو مش بتاعة شركة الشحن دي.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.shipping_settlements
        (business_id, shipping_company_id, settlement_date, reference,
         expected_amount, received_amount, order_count, account_name, notes, created_by)
    VALUES
        (p_business_id, p_shipping_company_id, COALESCE(p_settlement_date, CURRENT_DATE), p_reference,
         v_expected, COALESCE(p_received_amount,0), v_count, p_account_name, p_notes, v_email)
    RETURNING id INTO v_id;

    UPDATE public.orders
    SET settlement_id = v_id
    WHERE business_id = p_business_id
      AND shipping_company_id = p_shipping_company_id
      AND settlement_id IS NULL
      AND id = ANY(p_order_ids);

    -- Post the money actually received into the treasury.
    IF COALESCE(p_received_amount,0) <> 0 AND p_account_name IS NOT NULL THEN
        INSERT INTO public.transactions
            (business_id, transaction_date, type, category, sub_category, amount, description, account_name)
        VALUES
            (p_business_id, COALESCE(p_settlement_date, CURRENT_DATE)::timestamptz,
             'revenue', 'COD Settlement',
             (SELECT name FROM public.shipping_companies WHERE id = p_shipping_company_id),
             p_received_amount,
             'تحويل تحصيل من ' ||
                COALESCE((SELECT name FROM public.shipping_companies WHERE id = p_shipping_company_id), 'شركة شحن') ||
                ' — ' || v_count || ' أوردر' ||
                CASE WHEN p_reference IS NOT NULL THEN ' (' || p_reference || ')' ELSE '' END,
             p_account_name);
    END IF;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_courier_settlement(
    UUID, UUID, UUID[], NUMERIC, DATE, TEXT, TEXT, TEXT
) TO authenticated;

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.record_courier_settlement(UUID,UUID,UUID[],NUMERIC,DATE,TEXT,TEXT,TEXT);
-- DROP FUNCTION IF EXISTS public.get_courier_aging(UUID);
-- DROP FUNCTION IF EXISTS public.get_courier_outstanding(UUID);
-- DROP VIEW IF EXISTS public.v_courier_payouts;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS settlement_id;
-- DROP TABLE IF EXISTS public.shipping_settlements;
-- ALTER TABLE public.shipping_companies DROP COLUMN IF EXISTS cod_fee_percent, DROP COLUMN IF EXISTS return_fee;
