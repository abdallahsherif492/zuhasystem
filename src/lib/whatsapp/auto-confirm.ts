import { deliveryRateOf } from "@/lib/easyorders-delivery-rate";
import { accountOf, admin, graph, waNumber } from "@/lib/whatsapp/server";

/**
 * A customer answers the confirmation message with «تأكيد» (the button, or
 * the word): the order is confirmed on its own, when nothing about it needs a
 * person (every product linked, no deposit to ask for, totals that match, no
 * other open order on the number). Otherwise it stays Waiting for a
 * moderator. Either way the customer is answered, inside the 24-hour window,
 * so the reply costs nothing.
 *
 * On unless Settings say otherwise (businesses.theme_config.whatsapp.auto_confirm).
 */

const YES = /^(تأكيد|تاكيد|تأكيد الطلب|أكد|اكد|أأكد|موافق|تمام|اوكي|اوك|ok|okay|yes|confirm)$/i;
const isYes = (s: string | null) => !!s && YES.test(s.replace(/[\p{P}\p{S}\s]+/gu, " ").trim());

async function reply(businessId: string, phone: string, text: string) {
    const account = await accountOf(businessId);
    if (!account) return;
    const res = await graph(`${account.phone_number_id}/messages`, account.token, {
        method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", to: waNumber(phone), type: "text", text: { body: text } }),
    });
    if (!res.ok) { console.error("auto-confirm reply failed", res.body?.error?.message); return; }
    await admin.from("whatsapp_messages").insert({
        business_id: businessId, phone_number_id: account.phone_number_id, wa_message_id: res.body?.messages?.[0]?.id || null,
        direction: "out", customer_phone: phone, type: "text", body: text, status: "pending", sent_by: "system", sent_at: new Date().toISOString(),
    });
}

export async function handleConfirmReply(businessId: string, phone: string, body: string | null, contextId: string | null) {
    if (!isYes(body)) return;
    const { data: biz } = await admin.from("businesses").select("theme_config").eq("id", businessId).maybeSingle();
    if (biz?.theme_config?.whatsapp?.auto_confirm === false) return;

    // The confirmation we sent this customer: the one replied to, else the latest in 3 days.
    let q = admin.from("whatsapp_messages").select("order_id, wa_message_id, sent_at")
        .eq("business_id", businessId).eq("customer_phone", phone).eq("direction", "out")
        .eq("template_name", "order_confirmation").not("order_id", "is", null)
        .order("sent_at", { ascending: false }).limit(1);
    q = contextId ? q.eq("wa_message_id", contextId) : q.gte("sent_at", new Date(Date.now() - 3 * 86_400_000).toISOString());
    const { data: sent } = await q;
    const orderId = sent?.[0]?.order_id as string | undefined;
    if (!orderId) return;

    const { data: order } = await admin.from("orders")
        .select("id, status, tags, customer_info, order_items(variant_id)")
        .eq("business_id", businessId).eq("id", orderId).maybeSingle();
    if (!order || String(order.status).toLowerCase() !== "waiting") return;

    const digits = String(order.customer_info?.phone || phone).replace(/\D/g, "").slice(-10);
    const { count: otherOpen } = await admin.from("orders").select("id", { count: "exact", head: true })
        .eq("business_id", businessId).neq("id", orderId).ilike("customer_info->>phone", `%${digits}%`)
        .in("status", ["Waiting", "waiting", "Pending", "pending", "Processing", "processing", "Prepared", "prepared"]);
    const tags = JSON.stringify(order.tags || "");
    const blockers = [
        (order.order_items || []).some((i: { variant_id: string | null }) => !i.variant_id) && "منتج مش متربط",
        deliveryRateOf(order.customer_info) === "low" && "استلامه ضعيف (محتاج ديبوزت)",
        tags.includes("total-mismatch") && "الإجمالي مش مظبوط",
        (otherOpen || 0) > 0 && "عنده أوردر تاني مفتوح",
    ].filter(Boolean) as string[];

    if (blockers.length) {
        await admin.from("orders").update({ last_attempt_note: `رد «تأكيد» على الواتساب، محتاج مراجعة: ${blockers.join("، ")}` }).eq("id", orderId);
        await reply(businessId, phone, "شكراً! استلمنا تأكيدك ✅ وهنراجع طلبك ونكلمك لو محتاجين أي تفاصيل.");
        return;
    }

    const { data: moved } = await admin.from("orders")
        .update({ status: "Pending", confirmed_by: "whatsapp-auto" })
        .eq("business_id", businessId).eq("id", orderId).ilike("status", "waiting").select("id");
    if (!moved?.length) return;
    await admin.from("actions_log").insert({
        business_id: businessId, user_email: "whatsapp-auto", action_type: "update_status", entity_type: "order", entity_id: orderId,
        entity_name: `Order #${orderId.slice(0, 8)}`, changes: [{ field: "Status", old_value: "Waiting", new_value: "Pending (العميل أكد على الواتساب)" }],
        metadata: { source: "whatsapp", auto: true },
    });
    await reply(businessId, phone, "تم تأكيد طلبك ✅ هيتجهز ويتشحن خلال يومين عمل، وهنبعتلك رقم البوليصة أول ما يتشحن.");
}
