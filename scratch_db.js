const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
// use the anon key
const key = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1];

const supabase = createClient(url, key);

async function main() {
  const { data, error } = await supabase.rpc('hello_world'); // no RPC, I can't do this
  console.log("Without admin key, I can't test db structure easily.");
}
main();
