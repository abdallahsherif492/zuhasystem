-- Migration: ad spend per ad, linked to products
-- Created At: 2026-09-26
--
-- ads_expenses only knows how much was spent on a day. A media buyer needs to
-- know what each product's ads cost and what each product's orders cost, and
-- that needs the spend per ad. Ads are named after the product they sell
-- ("Portable washer PW2"), so an ad report exported from Meta or TikTok can be
-- tied back to the catalogue.
--
--   ad_spend          one row per ad per reporting period (a day, usually),
--                     per ad channel: messages, website or tiktok.
--   ad_spend_uploads  every file uploaded, for the history and for undoing one.
--   ad_product_links  which product an ad sells, by ad name. Kept per name, not
--                     per row, so next week's report links itself.
--
-- Uploading a report replaces what was there for that channel over the dates
-- the file covers, so uploading an overlapping or corrected export never
-- counts a day twice. The day totals are also written to ads_expenses under
-- their own platform name, so the Insights page and the dashboard see the
-- same spend without a second upload.

-- ===========================================================================
-- 1. Tables
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.ad_spend_uploads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    channel     TEXT NOT NULL CHECK (channel IN ('messages', 'website', 'tiktok')),
    file_name   TEXT,
    date_from   DATE NOT NULL,
    date_to     DATE NOT NULL,
    row_count   INTEGER NOT NULL DEFAULT 0,
    total_spend NUMERIC NOT NULL DEFAULT 0,
    vat_rate    NUMERIC NOT NULL DEFAULT 0,
    created_by  UUID DEFAULT auth.uid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_spend (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    upload_id    UUID REFERENCES public.ad_spend_uploads(id) ON DELETE CASCADE,
    channel      TEXT NOT NULL CHECK (channel IN ('messages', 'website', 'tiktok')),
    ad_name      TEXT NOT NULL,
    -- A daily report has date_from = date_to. A report exported without the
    -- day breakdown covers a range; its spend is spread evenly over the range
    -- wherever a period is filtered.
    date_from    DATE NOT NULL,
    date_to      DATE NOT NULL CHECK (date_to >= date_from),
    spend        NUMERIC NOT NULL DEFAULT 0,  -- VAT included when the upload added it
    spend_raw    NUMERIC NOT NULL DEFAULT 0,  -- as the report states it
    impressions  BIGINT  NOT NULL DEFAULT 0,
    reach        BIGINT  NOT NULL DEFAULT 0,
    clicks       BIGINT  NOT NULL DEFAULT 0,
    -- Messaging conversations, purchases or conversions: whatever the report's
    -- result column was.
    results      NUMERIC NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_spend_period ON public.ad_spend (business_id, channel, date_from);
CREATE INDEX IF NOT EXISTS idx_ad_spend_upload ON public.ad_spend (upload_id);

CREATE TABLE IF NOT EXISTS public.ad_product_links (
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    ad_key      TEXT NOT NULL,             -- lower-cased, trimmed ad name
    ad_name     TEXT NOT NULL,
    -- NULL = the ad is not for one product (a page ad, an offer on the whole
    -- store). Its spend still counts in the totals, under "general".
    product_id  UUID REFERENCES public.products(id) ON DELETE CASCADE,
    source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('auto', 'manual')),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id, ad_key)
);

-- ===========================================================================
-- 2. Access: members of the business, like every other business table
-- ===========================================================================
ALTER TABLE public.ad_spend_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_spend         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_product_links ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['ad_spend_uploads', 'ad_spend', 'ad_product_links'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_member', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL
                 USING (business_id IN (SELECT public.get_my_business_ids()) OR public.am_i_admin_of_business(business_id))
                 WITH CHECK (business_id IN (SELECT public.get_my_business_ids()) OR public.am_i_admin_of_business(business_id))',
            t || '_member', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END LOOP;
END $$;

-- ===========================================================================
-- 3. ads_expenses: one row per business, day and platform
-- ===========================================================================
-- The original table was unique on (ad_date, platform) alone, from before
-- there was more than one business: a second store could not record Facebook
-- spend on a day the first already had. The app already upserts on
-- (business_id, ad_date, platform), so that is the key it gets.
ALTER TABLE public.ads_expenses DROP CONSTRAINT IF EXISTS ads_expenses_ad_date_platform_key;
CREATE UNIQUE INDEX IF NOT EXISTS ads_expenses_business_day_platform
    ON public.ads_expenses (business_id, ad_date, platform);

-- ===========================================================================
-- 4. Upload a report
-- ===========================================================================
-- p_rows: [{ad_name, date_from, date_to, spend_raw, impressions, reach, clicks, results}]
-- Runs as the caller, so the policies above decide what it may touch. One
-- transaction: the old rows for the file's dates go, the new ones come in and
-- the day totals are rewritten, or nothing changes.
CREATE OR REPLACE FUNCTION public.import_ad_spend(
    p_business_id UUID,
    p_channel     TEXT,
    p_file_name   TEXT,
    p_vat_rate    NUMERIC,
    p_rows        JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_upload UUID;
    v_from   DATE;
    v_to     DATE;
BEGIN
    IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
        RAISE EXCEPTION 'No rows to import';
    END IF;

    SELECT min((r->>'date_from')::date), max((r->>'date_to')::date)
      INTO v_from, v_to
      FROM jsonb_array_elements(p_rows) r;

    -- Whatever this channel had inside the file's dates is replaced.
    DELETE FROM public.ad_spend
     WHERE business_id = p_business_id AND channel = p_channel
       AND date_from >= v_from AND date_to <= v_to;

    INSERT INTO public.ad_spend_uploads (business_id, channel, file_name, date_from, date_to, row_count, total_spend, vat_rate)
    VALUES (p_business_id, p_channel, p_file_name, v_from, v_to, jsonb_array_length(p_rows), 0, COALESCE(p_vat_rate, 0))
    RETURNING id INTO v_upload;

    INSERT INTO public.ad_spend (business_id, upload_id, channel, ad_name, date_from, date_to,
                                 spend_raw, spend, impressions, reach, clicks, results)
    SELECT p_business_id, v_upload, p_channel,
           r->>'ad_name', (r->>'date_from')::date, (r->>'date_to')::date,
           COALESCE((r->>'spend_raw')::numeric, 0),
           round(COALESCE((r->>'spend_raw')::numeric, 0) * (1 + COALESCE(p_vat_rate, 0)), 2),
           COALESCE((r->>'impressions')::bigint, 0), COALESCE((r->>'reach')::bigint, 0),
           COALESCE((r->>'clicks')::bigint, 0),      COALESCE((r->>'results')::numeric, 0)
      FROM jsonb_array_elements(p_rows) r;

    -- Totals of this upload, and of earlier ones whose rows it just replaced.
    -- An earlier upload left with no rows is dropped from the history.
    UPDATE public.ad_spend_uploads u
       SET total_spend = x.spend, row_count = x.n
      FROM (SELECT u2.id, COALESCE(sum(s.spend), 0) AS spend, count(s.id)::int AS n
              FROM public.ad_spend_uploads u2
              LEFT JOIN public.ad_spend s ON s.upload_id = u2.id
             WHERE u2.business_id = p_business_id AND u2.channel = p_channel
             GROUP BY u2.id) x
     WHERE u.id = x.id;
    DELETE FROM public.ad_spend_uploads
     WHERE business_id = p_business_id AND channel = p_channel AND row_count = 0 AND id <> v_upload;

    PERFORM public.sync_ad_spend_days(p_business_id, p_channel, v_from, v_to);
    RETURN v_upload;
END $$;

-- Rewrites the ads_expenses day totals of one channel from ad_spend.
CREATE OR REPLACE FUNCTION public.sync_ad_spend_days(
    p_business_id UUID, p_channel TEXT, p_from DATE, p_to DATE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_platform TEXT := CASE p_channel
        WHEN 'messages' THEN 'Meta - Messages'
        WHEN 'website'  THEN 'Meta - Website'
        ELSE 'TikTok Ads' END;
BEGIN
    DELETE FROM public.ads_expenses
     WHERE business_id = p_business_id AND platform = v_platform
       AND ad_date BETWEEN p_from AND p_to;

    INSERT INTO public.ads_expenses (business_id, ad_date, amount, currency, platform)
    SELECT p_business_id, d::date,
           sum(s.spend / (s.date_to - s.date_from + 1)), 'EGP', v_platform
      FROM generate_series(p_from, p_to, interval '1 day') d
      JOIN public.ad_spend s
        ON s.business_id = p_business_id AND s.channel = p_channel
       AND d::date BETWEEN s.date_from AND s.date_to
     GROUP BY d
    HAVING sum(s.spend) > 0;
END $$;

-- Undo an upload: its rows go, and the day totals are rewritten.
CREATE OR REPLACE FUNCTION public.delete_ad_spend_upload(p_upload_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE u public.ad_spend_uploads;
BEGIN
    SELECT * INTO u FROM public.ad_spend_uploads WHERE id = p_upload_id;
    IF NOT FOUND THEN RETURN; END IF;
    DELETE FROM public.ad_spend_uploads WHERE id = p_upload_id;  -- rows cascade
    PERFORM public.sync_ad_spend_days(u.business_id, u.channel, u.date_from, u.date_to);
END $$;

GRANT EXECUTE ON FUNCTION public.import_ad_spend(UUID, TEXT, TEXT, NUMERIC, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_ad_spend_days(UUID, TEXT, DATE, DATE)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_ad_spend_upload(UUID)                      TO authenticated;

-- ===========================================================================
-- Rollback
-- ===========================================================================
--   DELETE FROM public.ads_expenses WHERE platform IN ('Meta - Messages', 'Meta - Website', 'TikTok Ads');
--   DROP FUNCTION IF EXISTS public.delete_ad_spend_upload(UUID);
--   DROP FUNCTION IF EXISTS public.import_ad_spend(UUID, TEXT, TEXT, NUMERIC, JSONB);
--   DROP FUNCTION IF EXISTS public.sync_ad_spend_days(UUID, TEXT, DATE, DATE);
--   DROP TABLE IF EXISTS public.ad_spend, public.ad_product_links, public.ad_spend_uploads;
