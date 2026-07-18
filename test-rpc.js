const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://telkkknuygjejmqcvyev.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
(async () => {
  const { data: b } = await supabase.from('businesses').select('id').limit(1);
  if(b && b.length > 0) {
    const { data, error } = await supabase.rpc('get_orders_paginated', {
        p_business_id: b[0].id,
        p_page_number: 1,
        p_page_size: 1,
        p_search: null,
        p_status: null,
        p_channel: null,
        p_gov: null,
        p_products: null,
        p_from_date: null,
        p_to_date: null,
        p_export_all: false
    });
    console.log(Object.keys(data[0] || {}));
  }
})();
