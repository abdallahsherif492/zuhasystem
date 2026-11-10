-- ===========================================================================
-- Investment withdrawal ("سحب استثمار")
-- ===========================================================================
-- Money the owners take out of the business. It is a transaction of type
-- 'withdrawal' with a negative amount:
--   * treasury balances are SUM(amount) per account (get_treasury_balances),
--     so it lowers the treasury it leaves;
--   * every operating-expense figure counts type = 'expense' only (dashboard
--     money, Actual Returns, insights, monthly performance, overhead rates),
--     so it is never an expense.
--
-- Nothing else needs changing. This file only makes sure an old CHECK on
-- transactions.type, if the database still has one, lets the new type in:
-- it is replaced by one that allows every type already in use plus
-- 'withdrawal'. If there is no such check, this does nothing.
-- Safe to run more than once.

DO $$
DECLARE
    c       RECORD;
    v_types TEXT;
BEGIN
    FOR c IN
        SELECT conname, pg_get_constraintdef(oid) AS def
          FROM pg_constraint
         WHERE conrelid = 'public.transactions'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%type%'
    LOOP
        IF c.def ILIKE '%withdrawal%' THEN
            CONTINUE;
        END IF;
        EXECUTE format('ALTER TABLE public.transactions DROP CONSTRAINT %I', c.conname);

        SELECT string_agg(quote_literal(t), ', ' ORDER BY t) INTO v_types
          FROM (
              SELECT DISTINCT type AS t FROM public.transactions WHERE type IS NOT NULL
              UNION
              SELECT unnest(ARRAY['revenue', 'expense', 'investment', 'withdrawal', 'transfer_in', 'transfer_out'])
          ) x;
        EXECUTE format('ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check CHECK (type IN (%s))', v_types);
        RAISE NOTICE 'transactions.type check replaced: %', v_types;
    END LOOP;
END $$;

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.transactions'::regclass AND contype = 'c';
--
-- Rollback: nothing to undo unless a check was replaced; then drop
-- transactions_type_check and, if wanted, re-add the old one from the NOTICE.
