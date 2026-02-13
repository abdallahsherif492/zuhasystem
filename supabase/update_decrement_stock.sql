-- RPC to decrement stock with Open Product support
CREATE OR REPLACE FUNCTION decrement_stock(row_id UUID, amount INT, is_open BOOLEAN DEFAULT FALSE)
RETURNS VOID AS $$
BEGIN
  IF is_open THEN
    -- Open Product: Deduct but don't go below 0
    UPDATE variants
    SET stock_qty = GREATEST(0, stock_qty - amount)
    WHERE id = row_id;
  ELSE
    -- Normal Product: Strict deduction
    UPDATE variants
    SET stock_qty = stock_qty - amount
    WHERE id = row_id;
  END IF;
END;
$$ LANGUAGE plpgsql;
