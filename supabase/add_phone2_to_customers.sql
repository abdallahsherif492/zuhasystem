-- Add phone2 column to customers table for alternate contact number
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone2 TEXT;
