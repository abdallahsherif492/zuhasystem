require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function test() {
    const { data, error } = await supabase.from('variants').select('id, title, product_id, products(name)').limit(1);
    console.log(data, error);
}
test();
