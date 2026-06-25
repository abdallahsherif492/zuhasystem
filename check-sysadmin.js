require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function test() {
    const { data, error } = await supabase.from('system_admins').select('*');
    console.log("System Admins:", data);
    console.log("Error:", error);
}
test();
