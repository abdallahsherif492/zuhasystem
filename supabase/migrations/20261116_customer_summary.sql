-- ===========================================================================
-- Customers page: one row per phone, worked out in the database
-- ===========================================================================
-- The page loaded every order with its items into the browser to group them
-- by phone. PostgREST stops at 1,000 rows without saying so, so it showed the
-- customers of an arbitrary thousand orders out of 16,000, in about two
-- seconds. This returns every customer, already grouped, a page at a time.
-- Safe to run more than once.

CREATE OR REPLACE FUNCTION public.get_customer_summary(p_business_id UUID)
RETURNS TABLE (
    phone          TEXT,
    name           TEXT,
    governorate    TEXT,
    first_order_at TIMESTAMPTZ,
    last_order_at  TIMESTAMPTZ,
    total_orders   INTEGER,
    product_ids    UUID[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.business_users bu
                    WHERE bu.business_id = p_business_id
                      AND lower(bu.user_email) = lower(auth.jwt() ->> 'email'))
       AND NOT public.am_i_admin_of_business(p_business_id) THEN
        RAISE EXCEPTION 'not a member of this business' USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH o AS (
        SELECT o.id, o.created_at, btrim(o.customer_info ->> 'phone') AS phone,
               o.customer_info ->> 'name' AS name, o.customer_info ->> 'governorate' AS gov
          FROM public.orders o
         WHERE o.business_id = p_business_id
           AND COALESCE(btrim(o.customer_info ->> 'phone'), '') <> ''
           AND COALESCE(o.order_type, 'new') <> 'missed'
    ),
    latest AS (
        -- The name and governorate from their most recent order.
        SELECT DISTINCT ON (o.phone) o.phone, o.name, o.gov
          FROM o ORDER BY o.phone, o.created_at DESC
    ),
    agg AS (
        SELECT o.phone, min(o.created_at) AS first_at, max(o.created_at) AS last_at, count(*)::INT AS n
          FROM o GROUP BY o.phone
    ),
    prods AS (
        SELECT o.phone, array_agg(DISTINCT v.product_id) AS ids
          FROM o
          JOIN public.order_items oi ON oi.order_id = o.id
          JOIN public.variants v ON v.id = oi.variant_id
         GROUP BY o.phone
    )
    SELECT a.phone, l.name, l.gov, a.first_at, a.last_at, a.n, COALESCE(p.ids, '{}')
      FROM agg a
      JOIN latest l ON l.phone = a.phone
      LEFT JOIN prods p ON p.phone = a.phone
     ORDER BY a.last_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.get_customer_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_summary(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Rollback: DROP FUNCTION IF EXISTS public.get_customer_summary(UUID);
