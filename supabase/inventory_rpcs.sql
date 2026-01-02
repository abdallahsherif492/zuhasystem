-- RPC to decrement stock
CREATE OR REPLACE FUNCTION decrement_stock(row_id UUID, amount INT)
RETURNS VOID AS $$
BEGIN
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
