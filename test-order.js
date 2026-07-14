const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
    const { data, error } = await supabase.from('order_items').select('quantity, variant:variants(title, product:products(id, name))').limit(1);
    console.log(error);
    console.log(JSON.stringify(data, null, 2));
}
run();
