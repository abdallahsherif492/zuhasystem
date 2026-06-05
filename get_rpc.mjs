import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const key = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1];

async function check() {
  const query = {
    query: `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'get_customers_with_stats';`
  };
  const res = await fetch(`${url}/rest/v1/rpc/run_sql`, {
    method: 'POST',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(query)
  });
  console.log(await res.text());
}
await check();
