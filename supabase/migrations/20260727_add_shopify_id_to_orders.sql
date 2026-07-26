-- Add shopify_id column to orders table if not existing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_id TEXT;
