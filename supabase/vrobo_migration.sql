-- Migration to add vrobo_synced to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vrobo_synced BOOLEAN DEFAULT false;
