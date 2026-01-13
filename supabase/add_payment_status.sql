-- Add Payment Status Columns
ALTER TABLE orders 
ADD COLUMN payment_status TEXT DEFAULT 'Not Paid', -- 'Not Paid', 'Partially Paid', 'Paid'
ADD COLUMN paid_amount NUMERIC DEFAULT 0;

-- Update existing rows if needed (Optional, defaults handle it)
