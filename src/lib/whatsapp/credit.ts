import { admin } from "@/lib/whatsapp/server";

/**
 * Who on the team followed this customer up in the chat, so an order the
 * system confirms or cancels on its own (the customer's «تأكيد» / «إلغاء
 * الطلب») is credited to them in the daily targets instead of to nobody:
 * the last team member who wrote to the customer in the last 48 hours, else
 * whoever sent the order's confirmation by hand. Null when no one did.
 */
export async function followedUpBy(businessId: string, phone: string, orderId: string | null): Promise<string | null> {
    const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const { data: wrote } = await admin.from("whatsapp_messages").select("sent_by")
        .eq("business_id", businessId).eq("customer_phone", phone).eq("direction", "out").like("sent_by", "%@%")
        .gte("sent_at", since).order("sent_at", { ascending: false }).limit(1);
    if (wrote?.[0]?.sent_by) return wrote[0].sent_by.toLowerCase();
    if (orderId) {
        const { data: sent } = await admin.from("whatsapp_messages").select("sent_by")
            .eq("order_id", orderId).eq("direction", "out").like("sent_by", "%@%").not("template_name", "is", null)
            .order("sent_at", { ascending: false }).limit(1);
        if (sent?.[0]?.sent_by) return sent[0].sent_by.toLowerCase();
    }
    return null;
}

/**
 * After the system confirmed or cancelled an order: credit whoever followed
 * the customer up. A second update, of the credit only, so the status
 * triggers (and the «confirmed» message, skipped for whatsapp-auto) are not
 * touched again.
 */
export async function creditFollowUp(businessId: string, orderId: string, phone: string, what: "confirmed" | "cancelled") {
    const who = await followedUpBy(businessId, phone, orderId);
    if (!who) return null;
    await admin.from("orders").update(what === "confirmed" ? { confirmed_by: who } : { cancelled_by: who })
        .eq("business_id", businessId).eq("id", orderId);
    return who;
}
