-- ===========================================================================
-- Confirmation queue: when to call again, and who is on the phone
-- ===========================================================================
-- 1. next_attempt_at: when a Waiting order should be called again, set by
--    record_confirmation_attempt from what happened:
--      no answer / phone off / other: 1st +1h, 2nd +3h, 3rd +1 day,
--        4th: no time, the order needs a decision (cancel or a last try);
--      wrong number: needs a decision straight away;
--      "call me later": the time the customer gave (else +3h);
--      WhatsApp sent: +2h;  thinking / wants changes / price: +1 day.
-- 2. claimed_by / claimed_at: "I'm calling this one", so two moderators do not
--    call the same customer. A claim lasts 10 minutes and is dropped when an
--    attempt is recorded or the order leaves Waiting.
-- Safe to run more than once.

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS claimed_by      TEXT,
    ADD COLUMN IF NOT EXISTS claimed_at      TIMESTAMPTZ;

-- The old three-argument version goes: two versions side by side make
-- PostgREST refuse to pick one. Callers passing three arguments still work.
DROP FUNCTION IF EXISTS public.record_confirmation_attempt(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.record_confirmation_attempt(
    p_order_id UUID, p_reason TEXT, p_note TEXT, p_next_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    o public.orders;
    v_by TEXT := auth.jwt() ->> 'email';
    v_note TEXT := NULLIF(trim(COALESCE(p_note, '')), '');
    v_n INTEGER;
    v_next TIMESTAMPTZ;
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

    v_n := COALESCE(o.confirm_attempts, 0) + 1;
    v_next := CASE
        WHEN p_reason = 'wrong_number' THEN NULL
        WHEN p_reason = 'call_later' THEN COALESCE(p_next_at, now() + interval '3 hours')
        WHEN p_reason = 'whatsapp_pending' THEN now() + interval '2 hours'
        WHEN p_reason IN ('thinking', 'wants_changes', 'price') THEN now() + interval '1 day'
        WHEN v_n = 1 THEN now() + interval '1 hour'
        WHEN v_n = 2 THEN now() + interval '3 hours'
        WHEN v_n = 3 THEN now() + interval '1 day'
        ELSE NULL
    END;

    UPDATE public.orders
       SET confirm_attempts    = v_n,
           last_attempt_at     = now(),
           last_attempt_reason = p_reason,
           last_attempt_note   = v_note,
           last_attempt_by     = v_by,
           next_attempt_at     = v_next,
           claimed_by          = NULL,
           claimed_at          = NULL
     WHERE id = o.id
    RETURNING jsonb_build_object(
        'status', 'done',
        'confirm_attempts', confirm_attempts,
        'last_attempt_at', last_attempt_at,
        'last_attempt_reason', last_attempt_reason,
        'last_attempt_note', last_attempt_note,
        'last_attempt_by', last_attempt_by,
        'next_attempt_at', next_attempt_at,
        'claimed_by', claimed_by,
        'claimed_at', claimed_at)
    INTO v_result;

    RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.record_confirmation_attempt(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_confirmation_attempt(UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- "I'm calling this one." Returns who holds it; someone else's claim younger
-- than 10 minutes is kept unless p_force. p_release drops my own claim.
CREATE OR REPLACE FUNCTION public.claim_order(p_order_id UUID, p_force BOOLEAN DEFAULT false, p_release BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    o public.orders;
    v_me TEXT := lower(auth.jwt() ->> 'email');
BEGIN
    SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'gone'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = o.business_id AND lower(bu.user_email) = v_me) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF lower(trim(COALESCE(o.status, ''))) <> 'waiting' THEN RETURN jsonb_build_object('status', 'gone'); END IF;

    IF p_release THEN
        IF lower(COALESCE(o.claimed_by, '')) = v_me THEN
            UPDATE public.orders SET claimed_by = NULL, claimed_at = NULL WHERE id = o.id;
        END IF;
        RETURN jsonb_build_object('status', 'done', 'claimed_by', NULL, 'mine', false);
    END IF;

    IF o.claimed_by IS NOT NULL AND lower(o.claimed_by) <> v_me
       AND o.claimed_at > now() - interval '10 minutes' AND NOT p_force THEN
        RETURN jsonb_build_object('status', 'taken', 'claimed_by', o.claimed_by, 'claimed_at', o.claimed_at, 'mine', false);
    END IF;

    UPDATE public.orders SET claimed_by = v_me, claimed_at = now() WHERE id = o.id;
    RETURN jsonb_build_object('status', 'done', 'claimed_by', v_me, 'claimed_at', now(), 'mine', true);
END $$;
REVOKE ALL ON FUNCTION public.claim_order(UUID, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_order(UUID, BOOLEAN, BOOLEAN) TO authenticated;

-- An order that leaves Waiting is nobody's call any more.
CREATE OR REPLACE FUNCTION public.orders_drop_claim()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF lower(btrim(COALESCE(NEW.status, ''))) <> 'waiting' THEN
        NEW.claimed_by := NULL;
        NEW.claimed_at := NULL;
        NEW.next_attempt_at := NULL;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_orders_drop_claim ON public.orders;
CREATE TRIGGER trg_orders_drop_claim
    BEFORE UPDATE OF status ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.orders_drop_claim();

-- Orders already tried before this file: their next time from the same rules.
UPDATE public.orders o
   SET next_attempt_at = CASE
        WHEN o.last_attempt_reason = 'wrong_number' THEN NULL
        WHEN o.last_attempt_reason = 'call_later' THEN o.last_attempt_at + interval '3 hours'
        WHEN o.last_attempt_reason = 'whatsapp_pending' THEN o.last_attempt_at + interval '2 hours'
        WHEN o.last_attempt_reason IN ('thinking', 'wants_changes', 'price') THEN o.last_attempt_at + interval '1 day'
        WHEN o.confirm_attempts = 1 THEN o.last_attempt_at + interval '1 hour'
        WHEN o.confirm_attempts = 2 THEN o.last_attempt_at + interval '3 hours'
        WHEN o.confirm_attempts = 3 THEN o.last_attempt_at + interval '1 day'
        ELSE NULL END
 WHERE lower(btrim(COALESCE(o.status, ''))) = 'waiting'
   AND COALESCE(o.confirm_attempts, 0) > 0
   AND o.next_attempt_at IS NULL;

NOTIFY pgrst, 'reload schema';

-- Rollback:
-- DROP TRIGGER IF EXISTS trg_orders_drop_claim ON public.orders; DROP FUNCTION IF EXISTS public.orders_drop_claim();
-- DROP FUNCTION IF EXISTS public.claim_order(UUID, BOOLEAN, BOOLEAN);
-- (record_confirmation_attempt: re-create the 3-argument version from 20261006 after dropping this one)
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS next_attempt_at, DROP COLUMN IF EXISTS claimed_by, DROP COLUMN IF EXISTS claimed_at;
