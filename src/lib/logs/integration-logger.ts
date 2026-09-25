import { createClient } from "@supabase/supabase-js";

// We need an admin client for logging since this might be called from background crons
// or webhooks without an active auth session.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

/** Largest payload kept with a log line; anything bigger is summarised. */
const MAX_DETAILS_BYTES = 4000;

function capDetails(details: unknown): unknown {
    if (!details) return {};
    let text: string;
    try { text = JSON.stringify(details); } catch { return {}; }
    if (text.length <= MAX_DETAILS_BYTES) return details;
    return { truncated: true, original_bytes: text.length, preview: text.slice(0, MAX_DETAILS_BYTES) };
}

export async function logIntegrationActivity(
    businessId: string,
    integrationName: "Telegraph" | "Bosta" | "VROBO" | "EasyOrders" | "Shopify" | "Auto-Sync",
    status: "success" | "error" | "info",
    message: string,
    details?: any
) {

    // "[DEBUG]" lines were 60% of this table and most of its 421 MB: a ~10 KB
    // dump on every courier sync that nobody read. They are not stored.
    if (message.startsWith("[DEBUG]")) return;

    try {
        const { error } = await supabase
            .from("integration_logs")
            .insert({
                business_id: businessId,
                integration_name: integrationName,
                status,
                message,
                details: capDetails(details)
            });

        if (error) {
            console.error(`[Logger] Failed to write log for ${integrationName}:`, error);
        }
    } catch (err) {
        console.error(`[Logger] Exception while logging for ${integrationName}:`, err);
    }
}
