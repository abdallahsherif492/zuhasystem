import { supabase } from "@/lib/supabase";

export type AuditAction = 
    | "USER_BANNED"
    | "USER_ROLE_CHANGED"
    | "USER_REVOKED"
    | "BUSINESS_SUSPENDED"
    | "BUSINESS_ACTIVATED"
    | "TRIAL_EXTENDED"
    | "PAYMENT_APPROVED"
    | "PAYMENT_REJECTED"
    | "SETTINGS_UPDATED"
    | "PRICING_UPDATED"
    | "PRICING_DELETED";

export const logAuditAction = async (
    action: AuditAction,
    entityType: "User" | "Business" | "Platform" | "Pricing",
    entityId: string,
    details?: any
) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !user.email) return;

        const { error } = await supabase.from("audit_logs").insert({
            user_email: user.email,
            action,
            entity_type: entityType,
            entity_id: entityId,
            details: details || {}
        });

        if (error) {
            console.error("Failed to log audit action:", error);
        }
    } catch (err) {
        console.error("Exception in logAuditAction:", err);
    }
};
