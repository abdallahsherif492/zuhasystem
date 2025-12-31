
-- Fix past orders that were saved as 'Yesterday 22:00' instead of 'Today 00:00'
-- This script adds 2 hours to orders that look like they were affected by the timezone offset.

-- WARNING: This assumes the issue is consistently -2 hours (Cairo Standard Time vs UTC)
-- and that orders at 22:00 UTC were intended to be 00:00 Local.

UPDATE orders
SET created_at = created_at + INTERVAL '2 hours'
WHERE 
  -- Target orders that are exactly on the hour of 22:00 UTC (which is midnight Cairo)
  EXTRACT(HOUR FROM created_at) = 22 
  AND EXTRACT(MINUTE FROM created_at) = 0;

-- Optional: To be safe, maybe just set them to noon 12:00 UTC of the *next* day?
-- If created_at is '2023-12-25 22:00:00', it meant '2023-12-26 00:00:00'.
-- If we add 2 hours -> '2023-12-26 00:00:00'. This is correct for the DATE.

-- Alternative: Set all recent manual orders (e.g. last 7 days) to 12:00 PM if they are at 22:00 or 23:00.
UPDATE orders
SET created_at = (created_at + INTERVAL '1 day')::date + TIME '12:00:00'
WHERE created_at > NOW() - INTERVAL '30 days'
  AND EXTRACT(HOUR FROM created_at) = 22; -- Only target the specific problematic hour
