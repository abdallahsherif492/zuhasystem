const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://telkkknuygjejmqcvyev.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
(async () => {
  const { data, error } = await supabase.from('inventory_transactions').select('*').limit(1);
  console.log("Data:", JSON.stringify(data, null, 2));
  console.log("Error:", JSON.stringify(error, null, 2));
})();
