import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export interface ActionDiff {
    field: string;
    old_value: any;
    new_value: any;
}

export interface LogBusinessActionParams {
    businessId: string;
    userEmail?: string | null;
    actionType: "create" | "update_status" | "edit" | "delete" | "stock_adjust";
    // The db triggers in 20260816 also write supplier / invoice / shipping /
    // treasury / settings / target. Those are listed so app-side callers can
    // use the same vocabulary rather than inventing a parallel one.
    entityType:
        | "order" | "product" | "inventory" | "transaction" | "customer" | "team"
        | "supplier" | "invoice" | "shipping" | "treasury" | "settings" | "target";
    entityId: string;
    entityName: string;
    changes?: ActionDiff[];
    metadata?: Record<string, any>;
}

export async function logBusinessAction({
    businessId,
    userEmail,
    actionType,
    entityType,
    entityId,
    entityName,
    changes = [],
    metadata = {}
}: LogBusinessActionParams) {
    if (!businessId) return;

    try {
        const payload = {
            business_id: businessId,
            user_email: userEmail || "System",
            action_type: actionType,
            entity_type: entityType,
            entity_id: entityId,
            entity_name: entityName,
            changes: changes || [],
            metadata: metadata || {},
            created_at: new Date().toISOString()
        };

        const { error } = await supabaseAdmin
            .from("actions_log")
            .insert(payload);

        if (error) {
            console.error("[ActionsLogger] Error writing log:", error.message);
        }
    } catch (err) {
        console.error("[ActionsLogger] Exception writing log:", err);
    }
}
