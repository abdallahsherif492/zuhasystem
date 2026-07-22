import { createClient } from '@supabase/supabase-js';

const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const key = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();
const supabase = createClient(url, key);

async function check() {
    const { data, error } = await supabase.from('orders').select('*').limit(1);
    if (error) console.error(error);
    else console.log(Object.keys(data[0] || {}));
}
check();
