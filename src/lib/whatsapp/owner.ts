import { admin, memberOf } from "@/lib/whatsapp/server";
import { isOwnerRole } from "@/lib/whatsapp/roles";

/**
 * Blocking a customer and deleting a chat are for the business's owners
 * only (not admins): the signed-in member, if their role is owner.
 */
export async function ownerOf(businessId: string): Promise<{ email: string } | { error: string; status: number }> {
    const who = await memberOf(businessId);
    if ("error" in who) return who;
    const { data } = await admin.from("business_users").select("role").eq("business_id", businessId).ilike("user_email", who.email).maybeSingle();
    if (!isOwnerRole(data?.role)) return { error: "الأونر بس اللي يقدر يعمل كده.", status: 403 };
    return who;
}
