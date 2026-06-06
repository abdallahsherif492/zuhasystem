const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabase.rpc('get_policies', { table_name: 'business_users' });
  if (error) {
    // try direct SQL if RPC doesn't exist
    console.log("Error or no RPC:", error);
  } else {
    console.log(data);
  }
}
run();
