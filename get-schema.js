const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Extract from .env.local
const envFile = fs.readFileSync('.env.local', 'utf8');
const url = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const key = envFile.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1];

const supabase = createClient(url, key);

(async () => {
    // Try to get one row to see columns
    const { data, error } = await supabase.from('user_permissions').select('*').limit(1);
    console.log(data);
})();
