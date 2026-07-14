require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function run() {
  const { data, error } = await supabase
    .from('webhook_logs')
    .select('payload')
    .order('created_at', { ascending: false })
    .limit(1);
    
  if (error) console.error(error);
  else console.log(JSON.stringify(data[0].payload, null, 2));
}

run();
