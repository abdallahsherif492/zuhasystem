const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const { data: o, error: e1 } = await supabase.from('orders').select('business_id').limit(1);
  console.log("orders:", e1 ? e1.message : "OK");
  
  const { data: v, error: e2 } = await supabase.from('variants').select('business_id').limit(1);
  console.log("variants:", e2 ? e2.message : "OK");
}
check();
