-- Migration: let platform admins actually see the platform
-- Created At: 2026-07-31
--
-- Symptom: the System Admin dashboard shows only the stores belonging to the
-- admin's own account. There are 12 businesses and 18 memberships in the
-- database; the owner of the platform can see a fraction of them, so every
-- number on that dashboard is wrong.
--
-- Cause: the admin queries are correct — they carry no business filter — but
-- RLS on `businesses` has no system-admin bypass. supabase/system_admin_rls.sql
-- even says "We already added SELECT access for System Admins in
-- onboarding_rls.sql", and that file was never applied. (Same file held the
-- INSERT policy whose absence broke business creation.) Businesses being
-- invisible cascades: the dashboard maps orders and users onto stores it
-- cannot read, so the whole page collapses to one tenant.
--
-- Second cause, and the reason this is easy to get wrong again: the codebase
-- disagrees with itself about who a system admin is.
--   * BusinessContext        -> business_users.role ILIKE '%super%'
--   * existing RLS policies  -> a row in system_admins
--   * is_super_admin()       -> user_permissions.super_admin
-- Granting only one of those leaves admins who qualify under another still
-- locked out. The helper below accepts all three, so the app and the database
-- can no longer disagree.

-- ===========================================================================
-- 1. One definition of "platform admin"
-- ===========================================================================
-- SECURITY DEFINER so a policy on business_users can consult business_users
-- without re-entering RLS and recursing. STABLE so it is evaluated once per
-- statement rather than per row.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        EXISTS (SELECT 1 FROM public.system_admins
                 WHERE user_email = auth.jwt() ->> 'email')
     OR EXISTS (SELECT 1 FROM public.business_users
                 WHERE user_email = auth.jwt() ->> 'email'
                   AND role ILIKE '%super%')
     OR EXISTS (SELECT 1 FROM public.user_permissions
                 WHERE email = auth.jwt() ->> 'email'
                   AND super_admin = true);
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- ===========================================================================
-- 2. Platform-wide read for admins
-- ===========================================================================
-- Added as separate PERMISSIVE policies rather than by editing the existing
-- ones: PostgreSQL ORs permissive policies together, so each tenant's own
-- access is untouched and this can be dropped again without having to
-- reconstruct what was there before.
-- This block must NEVER enable RLS on a table that does not already have it.
-- `customers`, for one, currently runs with RLS off and no policies at all:
-- switching it on would leave only the admin policy below and lock every
-- normal user out of their own customers. A policy is only useful where RLS is
-- already restricting reads; where it is off, admins can read the table
-- already and nothing is needed.
DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        'businesses', 'business_users', 'user_permissions',
        'support_tickets', 'ticket_replies', 'support_conversations',
        'support_chat_messages', 'payment_requests', 'revenue_transactions',
        'audit_logs', 'orders', 'customers', 'products'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        -- Skip anything not present in this database rather than aborting the
        -- whole migration; these tables arrived across many ad-hoc scripts.
        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
        ) THEN
            RAISE NOTICE 'skipping %: table not found', t;
            CONTINUE;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
        ) THEN
            RAISE NOTICE 'skipping %: RLS is off, already visible to admins', t;
            CONTINUE;
        END IF;

        EXECUTE format('DROP POLICY IF EXISTS "Platform admins can read all" ON public.%I', t);
        EXECUTE format(
            'CREATE POLICY "Platform admins can read all" ON public.%I
                 FOR SELECT TO authenticated
                 USING (public.is_platform_admin())', t);
        RAISE NOTICE 'granted admin read on %', t;
    END LOOP;
END $$;

-- ===========================================================================
-- 3. Platform-wide write where the admin screens actually mutate
-- ===========================================================================
-- Deliberately narrower than the read grant: only the tables the System Admin
-- UI edits. The existing "System Admins can update businesses" policy from
-- system_admin_rls.sql is left in place rather than replaced — permissive
-- policies are OR'd, so adding alongside it widens access to all three admin
-- definitions while keeping rollback a plain DROP of what this file created.
DROP POLICY IF EXISTS "Platform admins can update businesses" ON public.businesses;
CREATE POLICY "Platform admins can update businesses"
ON public.businesses FOR UPDATE TO authenticated
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Platform admins can delete businesses" ON public.businesses;
CREATE POLICY "Platform admins can delete businesses"
ON public.businesses FOR DELETE TO authenticated
USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Platform admins can manage payment requests" ON public.payment_requests;
CREATE POLICY "Platform admins can manage payment requests"
ON public.payment_requests FOR UPDATE TO authenticated
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Platform admins can manage memberships" ON public.business_users;
CREATE POLICY "Platform admins can manage memberships"
ON public.business_users FOR ALL TO authenticated
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT public.is_platform_admin();        -- true when signed in as an admin
--   SELECT count(*) FROM businesses;          -- must match the real total (12)
--   SELECT count(*) FROM business_users;      -- must match the real total (18)
-- Run these while signed in as the admin, not with the service role — the
-- service role bypasses RLS and will always show everything.

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DO $$ DECLARE t TEXT; BEGIN
--   FOREACH t IN ARRAY ARRAY['businesses','business_users','user_permissions',
--     'support_tickets','ticket_replies','support_conversations',
--     'support_chat_messages','payment_requests','revenue_transactions',
--     'audit_logs','orders','customers','products'] LOOP
--     EXECUTE format('DROP POLICY IF EXISTS "Platform admins can read all" ON public.%I', t);
--   END LOOP; END $$;
-- DROP POLICY IF EXISTS "Platform admins can update businesses" ON public.businesses;
-- DROP POLICY IF EXISTS "Platform admins can delete businesses" ON public.businesses;
-- DROP POLICY IF EXISTS "Platform admins can manage payment requests" ON public.payment_requests;
-- DROP POLICY IF EXISTS "Platform admins can manage memberships" ON public.business_users;
