

async function loginAccurate(username, password) {
    const res = await fetch("https://system.telegraphex.com:8443/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username, password })
    });
    const data = await res.json();
    return data.token;
}

async function run() {
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: business } = await supabase.from("businesses").select("theme_config").eq("id", "629bd51a-96e0-496a-bd15-3ccff548d795").single();
    const telegraphConfig = business?.theme_config?.integrations?.shipping?.telegraph;

    const token = await loginAccurate(telegraphConfig.username, telegraphConfig.password);

    // Try sending a query with refNumber filter
    const query = `
        query {
            listShipments(first: 10, filter: { refNumber: "e38e6c81" }) {
                data {
                    id
                    refNumber
                    status { code name }
                }
            }
        }
    `;

    const res = await fetch("https://system.telegraphex.com:8443/graphql", {
        method: "POST",
        headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ query })
    });

    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
}

run().catch(console.error);
