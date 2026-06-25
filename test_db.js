const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    const email = 'karimmogadmo@gmail.com';
    const { data: user, error } = await supabase.from('business_users').select('*').ilike('user_email', email);
    console.log('User:', user?.length, error);
}
test();
