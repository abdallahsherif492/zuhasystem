import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const key = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1];

async function check() {
  const query = {
    query: `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'products'`
  };
  
  const res = await fetch(`${url}/rest/v1/rpc/run_sql`, {
    method: 'POST',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(query)
  });
  
  if (res.status === 404) {
      console.log("No RPC run_sql available");
      return;
  }
  
  const text = await res.text();
  console.log(text);
}
await check();
