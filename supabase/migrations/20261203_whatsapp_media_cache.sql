-- ===========================================================================
-- WhatsApp: pictures uploaded to Meta, remembered
-- ===========================================================================
-- A product's picture (or several products side by side) goes into a
-- template as a Meta media id. Making one meant downloading the pictures,
-- putting them together and uploading them: seconds of paid function time on
-- every message. Meta keeps an upload for 30 days, so the id is kept here and
-- used again for 20 (src/lib/whatsapp/media-cache.ts). Only the server reads it.
-- Safe to run again.

CREATE TABLE IF NOT EXISTS public.whatsapp_media_cache (
    phone_number_id TEXT NOT NULL,
    -- The picture's link, or "collage:" and a hash of the links side by side.
    key             TEXT NOT NULL,
    media_id        TEXT NOT NULL,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (phone_number_id, key)
);
ALTER TABLE public.whatsapp_media_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_media_cache FROM anon, authenticated;
