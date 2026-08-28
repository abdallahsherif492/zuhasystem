-- Migration: net due from each courier, for a period
-- Created At: 2026-08-30
--
-- The settlements screen answers an operational question — which orders is a
-- courier still holding money for, and let me record the transfer when it
-- arrives. The revenues page needs the shorter version of that: for the period
-- I am looking at, what is the net we should receive.
--
-- Net is what the courier collected from the customer, minus what the courier
-- charges us:
--
--     collected = total_amount - paid_amount   (a deposit never reaches them)
--     net       = collected - actual_shipping_cost - cod_fee% of collected
--
-- That arithmetic already exists in v_courier_payouts, which the settlements
-- screen reads. This reuses it rather than restating it, so the two screens
-- cannot drift into disagreeing about what a courier owes.
--
-- Returns are deliberately included and carry a negative payout: a parcel that
-- came back collected nothing and the courier still bills a return fee, so it
-- reduces what is due. Netting it out is the honest figure — reporting only the
-- delivered side would overstate every settlement.
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
    settled_count       BIGINT,    -- already reconciled against a transfer
    unsettled_net       NUMERIC    -- still outstanding
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
        ROUND(COALESCE(SUM(p.collected_amount), 0), 2),
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
-- Verify
-- ===========================================================================
--   SELECT * FROM get_courier_net_due('<business id>', '2026-08-01', '2026-09-01');
--   -- net_due must equal collected_total - shipping_total - COD fees, and
--   -- unsettled_net must never exceed net_due.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP FUNCTION IF EXISTS public.get_courier_net_due(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
