const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://telkkknuygjejmqcvyev.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
(async () => {
  const { data: business } = await supabaseAdmin
            .from('businesses')
            .select('*')
            .limit(1)
            .single();
  console.log("Business found:", !!business);
  if (business) console.log("Theme config keys:", Object.keys(business.theme_config || {}));
})();
