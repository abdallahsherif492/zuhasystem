const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function test() {
  const { data } = await supabase.from('business_users').select('role, user_email, allowed_pages');
  console.log(JSON.stringify(data, null, 2));
}
test();
