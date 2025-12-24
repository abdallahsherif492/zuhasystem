
-- Transactions Table for Accounting
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_date DATE NOT NULL,
  type TEXT NOT NULL, -- 'investment', 'revenue', 'expense'
  category TEXT, -- 'ads', 'website', 'purchases', 'orders_collection', 'deposit', 'other'
  amount NUMERIC NOT NULL, -- Positive for money in, Negative for money out
  description TEXT,
  account_name TEXT NOT NULL, -- 'Mohamed Adel', 'Abdallah Sherif'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
