-- Make a transaction findable from the order it belongs to.
--
-- transactions.order_id was added by 20260827 as a bare UUID so the
-- reconciliation could be backfilled without risking a constraint failure on
-- historical rows. That worked, but it left the column invisible to PostgREST:
-- with no foreign key there is no relationship in the schema cache, so the
-- accounting screen cannot embed the order and therefore cannot search by the
-- order number or the customer's name. Today the only thing in a deposit's
-- description is the EasyOrders UUID, which appears nowhere else in the system,
-- so an order like f5149ec7 is genuinely unfindable in Accounting.
--
-- The backfill has since run and the data is clean enough to constrain: 1,319
-- transactions carry an order_id and exactly one of them points at an order
-- that no longer exists.

-- That one row first, or the constraint cannot be validated. The description
-- keeps the full id, the customer name and the phone, so nothing is lost —
-- only the pointer to a row that is gone.
UPDATE public.transactions t
   SET order_id = NULL
 WHERE t.order_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = t.order_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'transactions_order_id_fkey'
           AND conrelid = 'public.transactions'::regclass
    ) THEN
        -- SET NULL rather than CASCADE: deleting an order must never silently
        -- remove money from the treasury. The transaction stays, it just stops
        -- claiming to belong to something that no longer exists.
        ALTER TABLE public.transactions
            ADD CONSTRAINT transactions_order_id_fkey
            FOREIGN KEY (order_id) REFERENCES public.orders (id)
            ON DELETE SET NULL;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- Verify:
--   SELECT count(*) FROM transactions WHERE order_id IS NOT NULL;   -- 1318
--   /rest/v1/transactions?select=id,orders(id,customer_info)&limit=1
--     should now embed instead of returning PGRST200.
