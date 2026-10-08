-- Migration: confirmation attempts on store orders
-- Created At: 2026-10-06
--
-- A Waiting order had one state, so the order nobody had called yet and the
-- order three moderators had failed to reach looked the same on the Platform
-- Orders page. Now a failed attempt is recorded — with a reason, which is
-- required — and the page splits the list into new orders and orders to try
-- again.
--
--   order_confirmation_attempts   every failed attempt: who, when, why.
--   orders.confirm_attempts,      a summary of the latest one on the order
--   orders.last_attempt_*         itself, so the list loads and syncs in the
--                                 one query it already makes.
--
-- The order's status does not change: it stays Waiting until it is moved to
-- Pending or cancelled, exactly as before.

-- ===========================================================================
-- 1. Summary on the order
-- ===========================================================================
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS confirm_attempts    INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_attempt_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_attempt_reason TEXT,
    ADD COLUMN IF NOT EXISTS last_attempt_note   TEXT,
    ADD COLUMN IF NOT EXISTS last_attempt_by     TEXT;

-- ===========================================================================
-- 2. History
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.order_confirmation_attempts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    order_id     UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    reason       TEXT NOT NULL CHECK (reason IN (
                     'no_answer', 'phone_off', 'wrong_number', 'call_later', 'thinking',
                     'whatsapp_pending', 'wants_changes', 'price', 'other')),
    note         TEXT,
    attempted_by TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_confirmation_attempts_order
    ON public.order_confirmation_attempts (order_id, created_at);

ALTER TABLE public.order_confirmation_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS confirmation_attempts_read ON public.order_confirmation_attempts;
CREATE POLICY confirmation_attempts_read ON public.order_confirmation_attempts FOR SELECT TO authenticated
    USING (business_id IN (SELECT public.get_my_business_ids()) OR public.am_i_admin_of_business(business_id));
GRANT SELECT ON public.order_confirmation_attempts TO authenticated;
-- Written only through record_confirmation_attempt().

-- ===========================================================================
-- 3. Recording one
-- ===========================================================================
-- Returns the order's new summary, or {"status": "gone"} when the order is no
-- longer Waiting (a colleague moved or cancelled it first) — then nothing is
-- written.
CREATE OR REPLACE FUNCTION public.record_confirmation_attempt(p_order_id UUID, p_reason TEXT, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    o public.orders;
    v_by TEXT := auth.jwt() ->> 'email';
    v_note TEXT := NULLIF(trim(COALESCE(p_note, '')), '');
    v_result JSONB;
BEGIN
    SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'gone');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = o.business_id AND lower(bu.user_email) = lower(v_by)) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF lower(trim(COALESCE(o.status, ''))) <> 'waiting' THEN
        RETURN jsonb_build_object('status', 'gone');
    END IF;
    IF p_reason = 'other' AND v_note IS NULL THEN
        RAISE EXCEPTION 'اكتب سبب فشل التأكيد.' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.order_confirmation_attempts (business_id, order_id, reason, note, attempted_by)
    VALUES (o.business_id, o.id, p_reason, v_note, v_by);

    UPDATE public.orders
       SET confirm_attempts    = COALESCE(confirm_attempts, 0) + 1,
           last_attempt_at     = now(),
           last_attempt_reason = p_reason,
           last_attempt_note   = v_note,
           last_attempt_by     = v_by
     WHERE id = o.id
    RETURNING jsonb_build_object(
        'status', 'done',
        'confirm_attempts', confirm_attempts,
        'last_attempt_at', last_attempt_at,
        'last_attempt_reason', last_attempt_reason,
        'last_attempt_note', last_attempt_note,
        'last_attempt_by', last_attempt_by)
    INTO v_result;

    RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.record_confirmation_attempt(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_confirmation_attempt(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Rollback:
--   DROP FUNCTION IF EXISTS public.record_confirmation_attempt(UUID, TEXT, TEXT);
--   DROP TABLE IF EXISTS public.order_confirmation_attempts;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS confirm_attempts, DROP COLUMN IF EXISTS last_attempt_at,
--       DROP COLUMN IF EXISTS last_attempt_reason, DROP COLUMN IF EXISTS last_attempt_note, DROP COLUMN IF EXISTS last_attempt_by;
