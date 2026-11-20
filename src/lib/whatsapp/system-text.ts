import { accountOf, admin, graph, waNumber } from "@/lib/whatsapp/server";

/**
 * A message the system sends on its own inside the 24-hour window (an answer
 * to the customer, a rule's text), stored in the chat as «تلقائي».
 */
export async function reply(businessId: string, phone: string, message: Record<string, unknown>, text: string, orderId: string | null): Promise<boolean> {
    const account = await accountOf(businessId);
    if (!account) return false;
    const res = await graph(`${account.phone_number_id}/messages`, account.token, {
        method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", to: waNumber(phone), ...message }),
    });
    if (!res.ok) { console.error("whatsapp auto reply failed", res.body?.error?.message); return false; }
    await admin.from("whatsapp_messages").insert({
        business_id: businessId, phone_number_id: account.phone_number_id, wa_message_id: res.body?.messages?.[0]?.id || null,
        direction: "out", customer_phone: phone, type: String(message.type || "text"), body: text, status: "pending",
        sent_by: "system", order_id: orderId, sent_at: new Date().toISOString(),
    });
    return true;
}
export const say = (businessId: string, phone: string, text: string, orderId: string | null) =>
    reply(businessId, phone, { type: "text", text: { body: text } }, text, orderId);

