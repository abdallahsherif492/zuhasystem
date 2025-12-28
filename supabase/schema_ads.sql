-- Ads Expenses Table
-- Stores daily ad spend imported from CSV
CREATE TABLE ads_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_date DATE NOT NULL, -- Corresponds to 'Day' in CSV
  amount NUMERIC NOT NULL, -- Corresponds to 'Amount spent'
  currency TEXT DEFAULT 'EGP', -- Corresponds to 'Currency'
  platform TEXT DEFAULT 'Facebook', -- Can be expanded later
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Prevent duplicate entries for the same day/platform to avoid double counting
  UNIQUE(ad_date, platform)
);

-- RLS
ALTER TABLE ads_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated users" ON ads_expenses FOR ALL USING (auth.role() = 'authenticated');
