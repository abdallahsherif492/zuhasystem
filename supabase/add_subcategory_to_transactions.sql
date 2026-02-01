-- Add sub_category column to transactions table for more detailed expense tracking
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS sub_category TEXT;
