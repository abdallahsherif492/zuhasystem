const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data: statusCounts } = await supabase
        .from("orders")
        .select("status");

    const counts = {};
    if (statusCounts) {
        for (const o of statusCounts) {
            counts[o.status] = (counts[o.status] || 0) + 1;
        }
    }
    console.log("Order statuses counts:", counts);
}
run();
