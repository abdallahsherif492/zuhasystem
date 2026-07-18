const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://telkkknuygjejmqcvyev.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
(async () => {
  const { data, error } = await supabase.rpc('execute_sql', { sql: "SELECT pg_get_functiondef('get_orders_paginated'::regproc);" });
  console.log(data, error);
})();
