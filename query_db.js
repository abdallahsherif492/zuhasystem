require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabase.rpc('get_expenses_breakdown', {
    from_date: '2026-07-01T00:00:00',
    to_date: '2026-07-12T23:59:59',
    b_id: '96e0b0f1-2a87-4b2d-90ba-cc5e9d9ce363'
  });
  console.log("Error:", error);
  console.log("Data count:", data ? data.length : 0);
  console.log("Data:", data);
}
run();
