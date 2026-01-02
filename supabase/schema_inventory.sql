-- Inventory Transactions Table
CREATE TABLE inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID REFERENCES variants(id) ON DELETE CASCADE NOT NULL,
  quantity_change INTEGER NOT NULL, -- Positive for add, Negative for subtract
  transaction_type TEXT NOT NULL, -- 'sale', 'return', 'adjustment', 'restock'
  reference_id UUID, -- order_id or other reference
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster history lookup
CREATE INDEX idx_inventory_variant ON inventory_transactions(variant_id);
CREATE INDEX idx_inventory_created_at ON inventory_transactions(created_at);
