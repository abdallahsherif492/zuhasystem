-- Migration: count unattributed orders in the meter, and lock targets down
-- Created At: 2026-08-03
--
-- Two corrections to 20260802_moderator_league.sql.
--
-- 1. The month's progress bar was reading only orders that had a moderator on
--    them. Every order placed before attribution existed — and any confirmed
--    since without someone picked — was missing from it, so a business at 900
--    orders for the month showed almost zero against its 2000 target. The
--    target is about the month's work, not about how much of it has been
--    labelled, so the totals must cover every order and the standings can stay
--    limited to the ones that were claimed.
--
-- 2. Anyone in the business could set the targets. A moderator being measured
--    against a number should not be able to move it.

-- ===========================================================================
-- 1. Return unattributed orders as their own group
-- ===========================================================================
-- The closed_by IS NOT NULL filter is gone. Unattributed orders now come back
-- as a single row with closed_by NULL, which lets one query feed both the
-- meter (all rows) and the standings (named rows only) — the two can never
-- disagree, which they would if they were counted separately.
CREATE OR REPLACE FUNCTION public.get_moderator_league(
    p_business_id UUID,
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    closed_by        TEXT,
    orders_count     BIGINT,
    items_count      BIGINT,
    items_per_order  NUMERIC,
    sales_value      NUMERIC,
    delivered_count  BIGINT,
    returned_count   BIGINT,
    delivery_rate    NUMERIC
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
    WITH scoped AS (
        SELECT o.id, o.closed_by, o.status, o.total_amount
        FROM public.orders o
        WHERE o.business_id = p_business_id
          AND o.created_at >= p_from
          AND o.created_at <  p_to
          -- A cancelled order was never sold; leaving it in would let someone
          -- climb the board by confirming orders that go nowhere.
          AND lower(btrim(coalesce(o.status,''))) <> 'cancelled'
    ),
    -- Summed per order first. Joining items straight onto orders would
    -- multiply total_amount by the number of lines — on real data that
    -- overstated sales by 37%.
    item_counts AS (
        SELECT oi.order_id, COALESCE(SUM(oi.quantity), 0) AS qty
        FROM public.order_items oi
        JOIN scoped s ON s.id = oi.order_id
        GROUP BY oi.order_id
    )
    SELECT
        s.closed_by,
        COUNT(*)::BIGINT,
        COALESCE(SUM(ic.qty), 0)::BIGINT,
        ROUND(COALESCE(SUM(ic.qty), 0)::NUMERIC / NULLIF(COUNT(*), 0), 2),
        ROUND(COALESCE(SUM(s.total_amount), 0)::NUMERIC, 2),
        (COUNT(*) FILTER (WHERE public.is_delivery_success(s.status)))::BIGINT,
        (COUNT(*) FILTER (WHERE public.is_delivery_failure(s.status)))::BIGINT,
        ROUND(
            100.0 * COUNT(*) FILTER (WHERE public.is_delivery_success(s.status))
            / NULLIF(COUNT(*) FILTER (
                WHERE public.is_delivery_success(s.status)
                   OR public.is_delivery_failure(s.status)
              ), 0)
        , 2)
    FROM scoped s
    LEFT JOIN item_counts ic ON ic.order_id = s.id
    GROUP BY s.closed_by
    -- Unattributed last regardless of size, so it never sits at the top of
    -- what is meant to be a ranking of people.
    ORDER BY (s.closed_by IS NULL), COUNT(*) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_moderator_league(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ===========================================================================
-- 2. Only owners and admins set the targets
-- ===========================================================================
-- Reading stays open to the whole business: moderators should see what they
-- are working towards. Writing does not.
--
-- Role values are inconsistent across the app's history — 'super_admin' from
-- the seed data, 'super admin' from the team screen's dropdown, plus 'owner'
-- and 'admin'. Normalising the underscore covers all of them without needing a
-- data migration.
CREATE OR REPLACE FUNCTION public.can_set_moderator_targets(p_business_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.business_id = p_business_id
          AND bu.user_email = auth.jwt() ->> 'email'
          AND lower(replace(bu.role, '_', ' ')) IN ('owner', 'admin', 'super admin')
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_set_moderator_targets(UUID) TO authenticated;

-- Replaces the FOR ALL policy from 20260802, which let any member write.
DROP POLICY IF EXISTS "Members can write their targets" ON public.moderator_targets;

DROP POLICY IF EXISTS "Owners can write targets" ON public.moderator_targets;
CREATE POLICY "Owners can write targets"
ON public.moderator_targets FOR ALL TO authenticated
USING (public.can_set_moderator_targets(business_id))
WITH CHECK (public.can_set_moderator_targets(business_id));

-- The read policy from 20260802 stays as it is: every member of the business
-- can see the targets, which is what makes them worth having.

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT * FROM public.get_moderator_league(
--       '<business id>', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month');
--   -- expect one row per moderator plus one row with closed_by IS NULL
--
--   SELECT public.can_set_moderator_targets('<business id>');  -- true for owners only

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DROP POLICY IF EXISTS "Owners can write targets" ON public.moderator_targets;
-- DROP FUNCTION IF EXISTS public.can_set_moderator_targets(UUID);
-- -- and re-apply get_moderator_league from 20260802 for the old filtered form.
