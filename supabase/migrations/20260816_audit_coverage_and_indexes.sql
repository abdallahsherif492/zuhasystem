-- Migration: automatic audit coverage, and indexes to page 12k+ log rows
-- Created At: 2026-08-16
--
-- Two problems with the actions log.
--
-- 1. Coverage. Logging is a call the developer has to remember, and roughly
--    forty files mutate data without one. Customers, suppliers, supplier
--    invoices, couriers, treasuries, team membership and damages are edited
--    with no trace at all. Adding calls to each site fixes today and breaks
--    again the next time someone writes a new screen, so the tables below get
--    a trigger instead: coverage no longer depends on remembering, and it
--    catches writes that never go through the app at all — webhooks, the cron,
--    and the SQL editor.
--
-- 2. Volume. There are already 12,165 rows and the newest 1,000 span under two
--    days, so the page's 300-row fetch was showing a few hours of history and
--    filtering it in the browser. Filtering and paging move to SQL, which needs
--    indexes to stay quick.
--
-- Orders, products and transactions are deliberately NOT given triggers: the
-- app logs those already with far better descriptions than a trigger can build
-- ("Platform Order #1234 (Ahmed)"), and a trigger would duplicate every one.

-- ===========================================================================
-- 1. Indexes
-- ===========================================================================
-- Every query on this page filters by business and sorts newest-first.
CREATE INDEX IF NOT EXISTS idx_actions_log_business_created
    ON public.actions_log (business_id, created_at DESC);

-- The dropdown filters narrow on these before the sort.
CREATE INDEX IF NOT EXISTS idx_actions_log_entity_type
    ON public.actions_log (business_id, entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_log_action_type
    ON public.actions_log (business_id, action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_log_user
    ON public.actions_log (business_id, user_email, created_at DESC);

-- Free-text search runs ILIKE '%…%' over the name, which no btree can serve.
-- pg_trgm makes those leading-wildcard matches indexable.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_actions_log_entity_name_trgm
    ON public.actions_log USING gin (entity_name gin_trgm_ops);

-- ===========================================================================
-- 2. One trigger, reused
-- ===========================================================================
-- Arguments: TG_ARGV[0] entity_type to record, TG_ARGV[1] the column to use as
-- the human-readable name (may be omitted).
--
-- The whole body is wrapped so that a failure here can never take down the
-- write it is describing. An audit trail that stops people saving customers is
-- worse than one with a gap in it.
CREATE OR REPLACE FUNCTION public.log_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_business UUID;
    v_entity   TEXT := TG_ARGV[0];
    v_namecol  TEXT := CASE WHEN TG_NARGS > 1 THEN TG_ARGV[1] ELSE NULL END;
    v_action   TEXT;
    v_row      JSONB;
    v_old      JSONB;
    v_changes  JSONB;
    v_name     TEXT;
    v_email    TEXT;
BEGIN
    BEGIN
        IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD); ELSE v_row := to_jsonb(NEW); END IF;
        IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;

        -- businesses is its own tenant; everything else carries business_id.
        IF TG_TABLE_NAME = 'businesses' THEN
            v_business := NULLIF(v_row->>'id', '')::UUID;
        ELSE
            v_business := NULLIF(v_row->>'business_id', '')::UUID;
        END IF;

        -- Nothing useful to file it under. Rather than invent a bucket, skip.
        IF v_business IS NULL THEN
            RETURN COALESCE(NEW, OLD);
        END IF;

        v_action := CASE TG_OP
                        WHEN 'INSERT' THEN 'create'
                        WHEN 'DELETE' THEN 'delete'
                        ELSE 'edit'
                    END;

        IF TG_OP = 'UPDATE' THEN
            -- Only the columns that actually changed. Timestamps are excluded
            -- because they move on every write and would bury the real edit;
            -- an UPDATE that touched nothing else is not worth a row at all.
            SELECT jsonb_agg(jsonb_build_object(
                       'field', k,
                       'old_value', v_old -> k,
                       'new_value', v_row -> k))
              INTO v_changes
              FROM jsonb_object_keys(v_row) AS t(k)
             WHERE (v_old -> k) IS DISTINCT FROM (v_row -> k)
               AND k NOT IN ('updated_at', 'created_at');

            IF v_changes IS NULL THEN
                RETURN NEW;
            END IF;
        END IF;

        IF v_namecol IS NOT NULL THEN
            v_name := v_row ->> v_namecol;
        END IF;
        v_name := COALESCE(NULLIF(v_name, ''),
                           v_entity || ' ' || left(COALESCE(v_row ->> 'id', ''), 8));

        -- Null outside a request (cron, webhook, SQL editor) — those are System.
        BEGIN
            v_email := NULLIF(auth.jwt() ->> 'email', '');
        EXCEPTION WHEN OTHERS THEN
            v_email := NULL;
        END;

        INSERT INTO public.actions_log (
            business_id, user_email, action_type, entity_type,
            entity_id, entity_name, changes, metadata, created_at
        ) VALUES (
            v_business,
            COALESCE(v_email, 'System'),
            v_action,
            v_entity,
            COALESCE(v_row ->> 'id', ''),
            v_name,
            COALESCE(v_changes, '[]'::JSONB),
            jsonb_build_object('source', 'trigger', 'table', TG_TABLE_NAME),
            now()
        );
    EXCEPTION WHEN OTHERS THEN
        -- Never block the underlying write.
        RAISE WARNING 'log_row_change failed on %: %', TG_TABLE_NAME, SQLERRM;
    END;

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- ===========================================================================
-- 3. Attach
-- ===========================================================================
-- Deliberately excludes orders, products and transactions — already logged by
-- the app with better names, and a trigger would double every entry.
--
-- variants is excluded too, and that one is worth spelling out: stock moves on
-- variants every time an order changes status, so a trigger there would add a
-- row per line per status change and drown everything else. Manual recounts are
-- logged from the inventory screen instead, where the intent is known.
DO $$
DECLARE
    spec RECORD;
BEGIN
    FOR spec IN
        SELECT * FROM (VALUES
            ('customers',           'customer',   'name'),
            ('suppliers',           'supplier',   'name'),
            ('supplier_invoices',   'invoice',    'invoice_number'),
            ('shipping_companies',  'shipping',   'name'),
            ('financial_accounts',  'treasury',   'name'),
            ('business_users',      'team',       'user_email'),
            ('inventory_damages',   'inventory',  NULL),
            ('moderator_targets',   'target',     NULL),
            ('businesses',          'settings',   'name')
        ) AS t(tbl, entity, namecol)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = spec.tbl AND c.relkind = 'r'
        ) THEN
            RAISE NOTICE 'skipping %: table not found', spec.tbl;
            CONTINUE;
        END IF;

        EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON public.%1$I', spec.tbl);
        EXECUTE format(
            'CREATE TRIGGER trg_audit_%1$s
             AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
             FOR EACH ROW EXECUTE FUNCTION public.log_row_change(%2$L%3$s)',
            spec.tbl,
            spec.entity,
            CASE WHEN spec.namecol IS NULL THEN '' ELSE ', ' || quote_literal(spec.namecol) END
        );
        RAISE NOTICE 'auditing %', spec.tbl;
    END LOOP;
END $$;

-- ===========================================================================
-- 4. Distinct values for the filter dropdowns
-- ===========================================================================
-- The page must not read every row just to discover which users and entity
-- types exist. DISTINCT over the indexes above answers it without a scan.
CREATE OR REPLACE FUNCTION public.get_actions_log_facets(p_business_id UUID)
RETURNS TABLE (kind TEXT, value TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT 'user', user_email FROM public.actions_log
     WHERE business_id = p_business_id AND user_email IS NOT NULL
     GROUP BY user_email
    UNION ALL
    SELECT 'entity', entity_type FROM public.actions_log
     WHERE business_id = p_business_id AND entity_type IS NOT NULL
     GROUP BY entity_type
    UNION ALL
    SELECT 'action', action_type FROM public.actions_log
     WHERE business_id = p_business_id AND action_type IS NOT NULL
     GROUP BY action_type;
$$;

GRANT EXECUTE ON FUNCTION public.get_actions_log_facets(UUID) TO authenticated;

-- ===========================================================================
-- Verify
-- ===========================================================================
--   UPDATE customers SET name = name WHERE id = '<id>';   -- no row: nothing changed
--   UPDATE customers SET notes = 'x' WHERE id = '<id>';   -- one row, changes = [notes]
--   SELECT * FROM actions_log WHERE metadata->>'source' = 'trigger' ORDER BY created_at DESC LIMIT 5;

-- ===========================================================================
-- Rollback
-- ===========================================================================
-- DO $$ DECLARE t TEXT; BEGIN
--   FOREACH t IN ARRAY ARRAY['customers','suppliers','supplier_invoices',
--     'shipping_companies','financial_accounts','business_users',
--     'inventory_damages','moderator_targets','businesses'] LOOP
--     EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON public.%1$I', t);
--   END LOOP; END $$;
-- DROP FUNCTION IF EXISTS public.log_row_change();
-- DROP FUNCTION IF EXISTS public.get_actions_log_facets(UUID);
