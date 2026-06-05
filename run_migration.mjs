import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const key = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1];
const sql = fs.readFileSync('supabase/migrations/20240605_financial_accounts.sql', 'utf8');

async function migrate() {
  const query = { query: sql };
  const res = await fetch(`${url}/rest/v1/rpc/run_sql`, {
    method: 'POST',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(query)
  });
  
  if (!res.ok) {
    if (res.status === 404) {
      console.log("No RPC run_sql available. We must use Deno or local supabase db push.");
    } else {
      console.log("Error:", await res.text());
    }
  } else {
    console.log("Migration executed successfully:", await res.text());
  }
}
await migrate();
