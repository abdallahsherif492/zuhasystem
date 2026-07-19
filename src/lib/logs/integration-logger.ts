import { createClient } from "@supabase/supabase-js";

// We need an admin client for logging since this might be called from background crons
// or webhooks without an active auth session.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

export async function logIntegrationActivity(
    businessId: string,
    integrationName: "Telegraph" | "VROBO" | "EasyOrders" | "Auto-Sync",
    status: "success" | "error" | "info",
    message: string,
    details?: any
) {
    try {
        const { error } = await supabase
            .from("integration_logs")
            .insert({
                business_id: businessId,
                integration_name: integrationName,
                status,
                message,
                details: details || {}
            });

        if (error) {
            console.error(`[Logger] Failed to write log for ${integrationName}:`, error);
        }
    } catch (err) {
        console.error(`[Logger] Exception while logging for ${integrationName}:`, err);
    }
}
