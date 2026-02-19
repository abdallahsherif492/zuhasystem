-- RPC to decrement stock
-- RPC to decrement stock
CREATE OR REPLACE FUNCTION decrement_stock(row_id UUID, amount INT, is_open BOOLEAN DEFAULT FALSE)
RETURNS VOID AS $$
BEGIN
  -- We now allow negative stock for both Open and Strict products at the DB level.
  -- The frontend validation in 'validateStock' prevents Strict products from reaching here if stock is insufficient.
  -- For Open products, this correctly tracks how many units we owe (negative stock).
  UPDATE variants
  SET stock_qty = stock_qty - amount
  WHERE id = row_id;
END;
$$ LANGUAGE plpgsql;

-- RPC to increment stock
CREATE OR REPLACE FUNCTION increment_stock(row_id UUID, amount INT)
RETURNS VOID AS $$
BEGIN
  UPDATE variants
  SET stock_qty = stock_qty + amount
  WHERE id = row_id;
END;
$$ LANGUAGE plpgsql;
