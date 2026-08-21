-- Migration: month-by-month performance for a whole year
-- Created At: 2026-08-18
--
-- The actual-returns page answers "how did the selected range do". It could
-- not answer "how has this year gone, month by month", which is the question
-- you ask when deciding whether things are improving.
--
-- Aggregated in SQL rather than in the browser. A year of collected orders
-- plus every expense transaction is a lot to ship over the wire to produce
-- twelve rows, and the page already pages through results to build its daily
-- chart — doing that again for a year would be the slowest thing on the page.
--
-- The arithmetic deliberately mirrors the page's own, line for line, so the
-- monthly table can never disagree with the cards above it:
--
--   net = revenue - cogs - opex - ads - courier
--
-- Damages are returned but NOT subtracted, because the page does not subtract
-- them either — it reports them alongside. Changing that here would quietly
-- make two numbers on one screen contradict each other.
CREATE OR REPLACE FUNCTION public.get_monthly_performance(
    p_business_id UUID,
    p_year        INTEGER
)
RETURNS TABLE (
    month        INTEGER,
    orders_count BIGINT,
    revenue      NUMERIC,
    cogs         NUMERIC,
    courier_cost NUMERIC,
    opex         NUMERIC,
    ads          NUMERIC,
    damages      NUMERIC,
    net_profit   NUMERIC,
    margin       NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    y_start TIMESTAMPTZ := make_timestamptz(p_year, 1, 1, 0, 0, 0);
    y_end   TIMESTAMPTZ := make_timestamptz(p_year + 1, 1, 1, 0, 0, 0);
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.business_id = p_business_id
          AND bu.user_email = auth.jwt() ->> 'email'
    ) THEN
        RAISE EXCEPTION 'not a member of this business';
    END IF;

    RETURN QUERY
    WITH months AS (
        -- Every month of the year, so a quiet month shows as a zero row
        -- instead of disappearing and making the chart look continuous.
        SELECT generate_series(1, 12) AS m
    ),
    ord AS (
        SELECT EXTRACT(MONTH FROM o.created_at)::INT AS m,
               COUNT(*)                        AS cnt,
               COALESCE(SUM(o.total_amount), 0)          AS revenue,
               COALESCE(SUM(o.total_cost), 0)            AS cogs,
               COALESCE(SUM(o.actual_shipping_cost), 0)  AS courier
        FROM public.orders o
        WHERE o.business_id = p_business_id
          AND lower(btrim(coalesce(o.status, ''))) = 'collected'
          AND o.created_at >= y_start AND o.created_at < y_end
        GROUP BY 1
    ),
    tx AS (
        SELECT EXTRACT(MONTH FROM t.transaction_date)::INT AS m,
               -- Purchases are stock, not an operating cost; the page excludes
               -- them and so does this.
               COALESCE(SUM(ABS(t.amount)) FILTER (
                   WHERE lower(btrim(coalesce(t.category, ''))) NOT IN ('purchases', 'ads')), 0) AS opex,
               COALESCE(SUM(ABS(t.amount)) FILTER (
                   WHERE lower(btrim(coalesce(t.category, ''))) = 'ads'), 0) AS ads
        FROM public.transactions t
        WHERE t.business_id = p_business_id
          AND lower(btrim(coalesce(t.type, ''))) = 'expense'
          AND t.transaction_date >= y_start::DATE
          AND t.transaction_date <  y_end::DATE
        GROUP BY 1
    ),
    dmg AS (
        SELECT EXTRACT(MONTH FROM d.date)::INT AS m,
               COALESCE(SUM(d.total_loss), 0)  AS loss
        FROM public.inventory_damages d
        WHERE d.business_id = p_business_id
          AND d.date >= y_start::DATE AND d.date < y_end::DATE
        GROUP BY 1
    )
    SELECT
        months.m,
        COALESCE(ord.cnt, 0)::BIGINT,
        ROUND(COALESCE(ord.revenue, 0), 2),
        ROUND(COALESCE(ord.cogs, 0), 2),
        ROUND(COALESCE(ord.courier, 0), 2),
        ROUND(COALESCE(tx.opex, 0), 2),
        ROUND(COALESCE(tx.ads, 0), 2),
        ROUND(COALESCE(dmg.loss, 0), 2),
        ROUND(COALESCE(ord.revenue, 0) - COALESCE(ord.cogs, 0)
              - COALESCE(tx.opex, 0) - COALESCE(tx.ads, 0)
              - COALESCE(ord.courier, 0), 2),
        CASE WHEN COALESCE(ord.revenue, 0) > 0
             THEN ROUND(100.0 * (COALESCE(ord.revenue, 0) - COALESCE(ord.cogs, 0)
                                 - COALESCE(tx.opex, 0) - COALESCE(tx.ads, 0)
                                 - COALESCE(ord.courier, 0))
                        / ord.revenue, 2)
             ELSE NULL
        END
    FROM months
    LEFT JOIN ord ON ord.m = months.m
    LEFT JOIN tx  ON tx.m  = months.m
    LEFT JOIN dmg ON dmg.m = months.m
    ORDER BY months.m;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_monthly_performance(UUID, INTEGER) TO authenticated;

-- Which years actually hold data, so the year picker offers real options
-- rather than a hardcoded range that goes stale or shows empty years.
CREATE OR REPLACE FUNCTION public.get_business_active_years(p_business_id UUID)
RETURNS TABLE (year INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT DISTINCT EXTRACT(YEAR FROM created_at)::INT
    FROM public.orders
    WHERE business_id = p_business_id
      AND EXISTS (
          SELECT 1 FROM public.business_users bu
          WHERE bu.business_id = p_business_id
            AND bu.user_email = auth.jwt() ->> 'email'
      )
    ORDER BY 1 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_business_active_years(UUID) TO authenticated;

-- ===========================================================================
-- Verify
-- ===========================================================================
--   SELECT * FROM get_monthly_performance('<business id>', 2026);
--   -- 12 rows; SUM(revenue) must equal the page's revenue for 01 Jan–31 Dec.
