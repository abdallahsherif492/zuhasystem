require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function test() {
    const { data: orders } = await supabase.from('orders').select('business_id').limit(1);
    if (!orders || orders.length === 0) return console.log("No orders found");
    const p_business_id = orders[0].business_id;

    console.log("Testing with business:", p_business_id);

    const { data, error } = await supabase.rpc('get_orders_paginated', {
        p_business_id: p_business_id,
        p_page_number: 1,
        p_page_size: 50,
        p_search: null,
        p_status: null,
        p_channel: null,
        p_gov: null,
        p_products: null,
        p_from_date: null,
        p_to_date: null,
        p_export_all: false
    });

    console.log("Error:", error);
    console.log("Data count:", data ? data.length : 0);
    if (error) {
        console.error(error);
    } else if (data && data.length > 0) {
        console.log("Sample order ID:", data[0].id);
    }
}
test();
