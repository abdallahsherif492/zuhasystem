import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const key = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1];

async function check(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=business_id&limit=1`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const text = await res.text();
  console.log(`${table}:`, text);
}
await check('orders');
await check('variants');
