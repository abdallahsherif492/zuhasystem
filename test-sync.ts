import { createClient } from '@supabase/supabase-js';
import { loginAccurate, fetchAccurateShipments, mapAccurateStatusToZuha } from './src/lib/shipping/accurate';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const businessId = "629bd51a-96e0-496a-bd15-3ccff548d795"; // assuming one business
    const { data: orders } = await supabase
        .from("orders")
        .select("id, status")
        .in("status", ["Prepared", "Hold To redeliver", "Shipped", "Returning"]);

    console.log("Found orders in system:", orders?.length);

    if (!orders || orders.length === 0) return;

    const { data: business } = await supabase
        .from("businesses")
        .select("theme_config")
        .limit(1)
        .single();
    
    const telegraphConfig = business?.theme_config?.integrations?.shipping?.telegraph;
    if (!telegraphConfig) {
        console.log("No config");
        return;
    }

    const refNumbers = orders.map(o => o.id.substring(0, 8));
    console.log("Ref numbers sample:", refNumbers.slice(0, 5));
    
    try {
        const token = await loginAccurate(telegraphConfig.username, telegraphConfig.password);
        console.log("Logged in to Telegraph");
        const shipments = await fetchAccurateShipments(token, refNumbers);
        console.log("Fetched shipments from Telegraph:", shipments.length);

        if (shipments.length > 0) {
            console.log("Sample shipment 0:", JSON.stringify(shipments[0], null, 2));
            const firstMatch = orders.find(o => o.id.startsWith(shipments[0].refNumber));
            const newStatus = mapAccurateStatusToZuha(shipments[0].status.code, shipments[0].status.name);
            console.log("Mapped new status:", newStatus, "Old status:", firstMatch?.status);
        }
    } catch(e) {
        console.error(e);
    }
}
run();
