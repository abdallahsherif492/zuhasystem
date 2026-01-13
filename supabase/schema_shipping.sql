-- Shipping Companies / Couriers Table
CREATE TABLE shipping_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('Company', 'Courier', 'Office')) DEFAULT 'Company',
  phone TEXT,
  rates JSONB DEFAULT '{}'::JSONB, -- Key: Governorate Name, Value: Cost (Numeric)
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add relation to Orders
ALTER TABLE orders 
ADD COLUMN shipping_company_id UUID REFERENCES shipping_companies(id);

-- Index
CREATE INDEX idx_orders_shipping_company ON orders(shipping_company_id);
