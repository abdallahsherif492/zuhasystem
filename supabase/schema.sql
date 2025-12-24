-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Products Table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  category_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Variants Table
CREATE TABLE variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT,
  title TEXT NOT NULL, -- e.g. "Red/XL"
  sale_price NUMERIC NOT NULL,
  cost_price NUMERIC NOT NULL,
  track_inventory BOOLEAN DEFAULT FALSE,
  stock_qty INTEGER DEFAULT 0
);

-- Customers Table
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  governorate TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Orders Table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id), -- Link to customer logic
  customer_info JSONB, -- Snapshot (backup)
  status TEXT DEFAULT 'Pending', -- Pending, Processing, Shipped, Delivered, Cancelled, Returned
  channel TEXT, -- Facebook, Instagram, Tiktok, Website
  tags TEXT[],
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC DEFAULT 0,
  shipping_cost NUMERIC DEFAULT 0,
  total_amount NUMERIC NOT NULL,
  total_cost NUMERIC NOT NULL,
  profit NUMERIC GENERATED ALWAYS AS (total_amount - total_cost) STORED,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Order Items Table
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES variants(id),
  quantity INTEGER NOT NULL,
  price_at_sale NUMERIC NOT NULL,
  cost_at_sale NUMERIC NOT NULL
);

-- Enable Row Level Security (RLS) on all tables (Detailed policies can be added later, for now we allow authenticated access or public if needed)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Simple policies for internal tool (Allow all operations for authenticated users)
CREATE POLICY "Enable all for authenticated users" ON products FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON variants FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON orders FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON order_items FOR ALL USING (auth.role() = 'authenticated');

-- Transactions Table for Accounting
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_date DATE NOT NULL,
  type TEXT NOT NULL, -- 'investment', 'revenue', 'expense'
  category TEXT, -- 'ads', 'website', 'purchases', 'orders_collection', 'deposit', 'other'
  amount NUMERIC NOT NULL, -- Positive for money in, Negative for money out (logic handled in app but good to know)
  description TEXT,
  account_name TEXT NOT NULL, -- 'Mohamed Adel', 'Abdallah Sherif'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated users" ON transactions FOR ALL USING (auth.role() = 'authenticated');
