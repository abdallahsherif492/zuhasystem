-- Migration: filter the orders list by payment status
-- Created At: 2026-08-28
--
-- The list could already be narrowed by order status, channel, governorate,
-- product and date, but not by whether the order had been paid for — so
-- "show me everything with a deposit still owed" had no answer on the screen
-- people actually work from.
--
-- The return type is unchanged; the signature gains a parameter, so this has to
-- be dropped rather than replaced. Regenerated from
-- supabase/orders_pagination_rpc.sql with the new filter added and nothing else
-- touched. The parameter goes last and binds to $11 so every existing
-- positional argument keeps its number.

DROP FUNCTION IF EXISTS get_orders_paginated(
    UUID, INT, INT, TEXT, TEXT[], TEXT[], TEXT[], UUID[], TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN
);
DROP FUNCTION IF EXISTS get_orders_paginated(
    UUID, INT, INT, TEXT, TEXT[], TEXT[], TEXT[], UUID[], TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TEXT[]
);

-- Function to get paginated and filtered orders
CREATE OR REPLACE FUNCTION get_orders_paginated(
    p_business_id UUID,
    p_page_number INT DEFAULT 1,
    p_page_size INT DEFAULT 50,
    p_search TEXT DEFAULT NULL,
    p_status TEXT[] DEFAULT NULL,
    p_channel TEXT[] DEFAULT NULL,
    p_gov TEXT[] DEFAULT NULL,
    p_products UUID[] DEFAULT NULL,
    p_from_date TIMESTAMPTZ DEFAULT NULL,
    p_to_date TIMESTAMPTZ DEFAULT NULL,
    p_export_all BOOLEAN DEFAULT FALSE, -- If TRUE, ignores pagination and returns all matches
    p_payment_status TEXT[] DEFAULT NULL
)
RETURNS TABLE (
    total_count BIGINT,
    id UUID,
    created_at TIMESTAMPTZ,
    status TEXT,
    total_amount NUMERIC,
    total_cost NUMERIC,
    profit NUMERIC,
    actual_shipping_cost NUMERIC,
    shipping_cost_estimated BOOLEAN,
    customer_info JSONB,
    channel TEXT,
    shipping_cost NUMERIC,
    tags TEXT[],
    notes TEXT,
    payment_status TEXT,
    paid_amount NUMERIC,
    items JSONB
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := '
        WITH filtered_orders AS (
            SELECT o.*
            FROM orders o
            WHERE o.business_id = $1
    ';

    -- From Date
    IF p_from_date IS NOT NULL THEN
        v_sql := v_sql || ' AND o.created_at >= $9 ';
    END IF;

    -- To Date
    IF p_to_date IS NOT NULL THEN
        v_sql := v_sql || ' AND o.created_at <= $10 ';
    END IF;

    -- Status
    IF array_length(p_status, 1) > 0 THEN
        v_sql := v_sql || ' AND o.status = ANY($4) ';
    END IF;

    -- Channel
    IF array_length(p_channel, 1) > 0 THEN
        v_sql := v_sql || ' AND o.channel = ANY($5) ';
    END IF;

    -- Payment status
    -- Normalised on both sides: the column holds 'Paid', 'Partially Paid' and
    -- 'Not Paid', but older rows have null or an empty string, and those mean
    -- unpaid rather than "no answer". Filtering on the raw column would leave
    -- them out of every bucket and unreachable from this screen.
    IF array_length(p_payment_status, 1) > 0 THEN
        v_sql := v_sql || ' AND (
            CASE lower(btrim(coalesce(o.payment_status, '''')))
                WHEN ''paid''           THEN ''Paid''
                WHEN ''partially paid'' THEN ''Partially Paid''
                WHEN ''partial''        THEN ''Partially Paid''
                ELSE ''Not Paid''
            END = ANY($11)
        ) ';
    END IF;

    -- Search
    IF p_search IS NOT NULL AND p_search <> '' THEN
        -- Safely cast id to text for partial match, and search JSON fields
        v_sql := v_sql || ' AND (
            o.id::TEXT ILIKE ''%'' || $3 || ''%'' OR
            (o.customer_info->>''name'') ILIKE ''%'' || $3 || ''%'' OR
            (o.customer_info->>''phone'') ILIKE ''%'' || $3 || ''%'' OR
            o.channel ILIKE ''%'' || $3 || ''%''
        ) ';
    END IF;

    -- Governorate
    IF array_length(p_gov, 1) > 0 THEN
        IF 'ALL_EXCEPT_CAIRO_GIZA' = ANY(p_gov) THEN
            v_sql := v_sql || ' AND (
                (o.customer_info->>''governorate'' NOT IN (''Cairo'', ''Giza'')) 
                OR 
                (o.customer_info->>''governorate'' = ANY($6))
            ) ';
        ELSE
            v_sql := v_sql || ' AND (o.customer_info->>''governorate'' = ANY($6)) ';
        END IF;
    END IF;

    -- Products
    IF array_length(p_products, 1) > 0 THEN
        v_sql := v_sql || ' AND EXISTS (
            SELECT 1 FROM order_items oi 
            JOIN variants v ON oi.variant_id = v.id 
            WHERE oi.order_id = o.id AND v.product_id = ANY($7)
        ) ';
    END IF;

    v_sql := v_sql || '
        )
        SELECT 
            count(*) OVER() AS total_count,
            fo.id,
            fo.created_at,
            fo.status,
            fo.total_amount,
            fo.total_cost,
            fo.profit,
            fo.actual_shipping_cost,
            COALESCE(fo.shipping_cost_estimated, false),
            fo.customer_info,
            fo.channel,
            fo.shipping_cost,
            fo.tags,
            fo.notes,
            fo.payment_status,
            fo.paid_amount,
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        ''quantity'', oi.quantity,
                        ''variant'', jsonb_build_object(
                            ''title'', v.title,
                            ''product'', jsonb_build_object(
                                ''id'', p.id,
                                ''name'', p.name
                            )
                        )
                    )
                )
                FROM order_items oi
                JOIN variants v ON v.id = oi.variant_id
                JOIN products p ON p.id = v.product_id
                WHERE oi.order_id = fo.id
            ) AS items
        FROM filtered_orders fo
        ORDER BY fo.created_at DESC
    ';

    IF NOT p_export_all THEN
        v_sql := v_sql || ' LIMIT $2 OFFSET (($8 - 1) * $2) ';
    END IF;

    RETURN QUERY EXECUTE v_sql USING 
        p_business_id,        -- $1
        p_page_size,          -- $2
        p_search,             -- $3
        p_status,             -- $4
        p_channel,            -- $5
        p_gov,                -- $6
        p_products,           -- $7
        p_page_number,        -- $8
        p_from_date,          -- $9
        p_to_date,            -- $10
        p_payment_status;     -- $11

END;
$$;
