-- Add Payment Status Columns
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'Not Paid', 
ADD COLUMN IF NOT EXISTS paid_amount NUMERIC DEFAULT 0;

-- Update existing rows if needed (Optional, defaults handle it)
