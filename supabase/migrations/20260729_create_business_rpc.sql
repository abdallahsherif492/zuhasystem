-- Migration: create a business through a definer function
-- Created At: 2026-07-29
--
-- Fixes onboarding failing with:
--   new row violates row-level security policy for table "businesses" (42501)
--
-- Three separate problems made the client-side insert unworkable:
--
--  1. RLS is enabled on businesses, but the INSERT policy that was supposed to
--     accompany it lives in supabase/onboarding_rls.sql — a loose file that was
--     never part of the tracked migrations and is evidently not applied.
--
--  2. Even with that policy, the call is `.insert(...).select("id")`.
--     PostgreSQL applies SELECT policies to a RETURNING clause, and the SELECT
--     policy on businesses requires a matching row in business_users — which
--     cannot exist yet, because the link is only created on the next line.
--     So the insert would succeed and then fail to return its own id.
--
--  3. The business and its owner link were two separate statements. If the
--     second failed, the result was a business nobody belongs to: invisible in
--     every UI, but still counted and still billable.
--
-- Doing the whole thing in one definer function resolves all three, makes it
-- atomic, and moves the per-account business quota server-side where it cannot
-- be skipped by calling the REST API directly.

CREATE OR REPLACE FUNCTION public.create_business_with_owner(
    p_name    TEXT,
    p_plan_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email       TEXT := auth.jwt() ->> 'email';
    v_uid         UUID := auth.uid();
    v_name        TEXT := btrim(coalesce(p_name, ''));
    v_max         INTEGER;
    v_owned       INTEGER;
    v_business_id UUID;
BEGIN
    IF v_email IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to create a business.'
            USING ERRCODE = '28000';
    END IF;

    IF v_name = '' THEN
        RAISE EXCEPTION 'Business name is required.'
            USING ERRCODE = '22023';
    END IF;

    IF length(v_name) > 120 THEN
        RAISE EXCEPTION 'Business name is too long.'
            USING ERRCODE = '22023';
    END IF;

    -- Quota, enforced here rather than in the browser where it was advisory.
    SELECT coalesce(max_businesses, 1) INTO v_max
    FROM public.user_permissions
    WHERE email = v_email;

    v_max := coalesce(v_max, 1);

    SELECT count(*) INTO v_owned
    FROM public.business_users
    WHERE user_email = v_email AND role = 'owner';

    IF v_owned >= v_max THEN
        RAISE EXCEPTION 'You have reached the maximum of % business profile(s) for your account.', v_max
            USING ERRCODE = 'P0001';
    END IF;

    -- Trial dates are filled in by the set_new_business_free_trial trigger.
    INSERT INTO public.businesses (name, subscription_status, plan_id)
    VALUES (v_name, 'trial', p_plan_id)
    RETURNING id INTO v_business_id;

    INSERT INTO public.business_users (business_id, user_id, user_email, role)
    VALUES (v_business_id, v_uid, v_email, 'owner');

    RETURN v_business_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_business_with_owner(TEXT, UUID) TO authenticated;

-- Deliberately not granted to anon: creating a tenant requires a real account.
REVOKE EXECUTE ON FUNCTION public.create_business_with_owner(TEXT, UUID) FROM anon;
