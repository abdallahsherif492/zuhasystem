require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function test() {
    const { data, error } = await supabase
        .from('orders')
        .select(`
            id,
            items:order_items!inner(
                variant:variants!inner(
                    product:products!inner(id, name)
                )
            )
        `)
        .limit(2);
    console.log(error ? error : JSON.stringify(data, null, 2));
}
test();
