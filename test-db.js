const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
const envUrl = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const envKey = envFile.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(envUrl, envKey);

async function check() {
  const { data, error } = await supabase.from('business_users').select('*').limit(1);
  console.log("Error:", error);
  console.log("Data:", data);
}
check();
