import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const key = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1];

async function check() {
  const res = await fetch(`${url}/rest/v1/business_users?select=*`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const text = await res.json();
  console.log('business_users:', text.length);
  
  const bRes = await fetch(`${url}/rest/v1/businesses?select=*`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const bText = await bRes.json();
  console.log('businesses:', bText.length);
}
await check();
