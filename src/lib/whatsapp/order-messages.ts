import { arabicProductLabel } from "@/lib/orders/product-label";
import { plainEnglish } from "@/lib/orders/arabic-names";
import { translateToArabic } from "@/lib/translate-ar";
import { accountOf, admin, graph, sendError, waNumber } from "@/lib/whatsapp/server";
import { renderTemplate, templateDef } from "@/lib/whatsapp/templates";
import type { OrderEvent } from "@/lib/whatsapp/settings";

/**
 * The template message for an order, built and sent on the server: the
 * confirmation (with the product's photo when there is one), and the message
 * for each shipping event. Kept in whatsapp_messages exactly as the customer
 * reads it (the template's text with the values in, its buttons, the photo).
 */

const ARABIC = /[؀-ۿ]/;

interface OrderRow {
    id: string; status: string; total_amount: number; paid_amount: number | null; courier_code: string | null;
    customer_info: { name?: string; phone?: string } | null;
    shipping_companies: { name: string | null } | null;
    order_items: { quantity: number; unmapped_name: string | null; variants: { title: string | null; products: { name: string | null; description: string | null; image_url: string | null } | null } | null }[];
}

/** A product's short Arabic name: from its description, else translated. */
export async function arabicProductName(name: string | null | undefined, description: string | null | undefined, option?: string | null): Promise<string> {
    const fromDesc = arabicProductLabel(description);
    const base = fromDesc ? fromDesc.split(/\s[—–-]\s/)[0].replace(/…$/, "").trim() : await translateToArabic(plainEnglish(name || "منتج"));
    const opt = option && !/^default/i.test(option.trim()) ? option.trim() : null;
    if (!opt) return base;
    return `${base} - ${ARABIC.test(opt) ? opt : await translateToArabic(opt)}`;
}

async function arabicName(it: OrderRow["order_items"][number]): Promise<string> {
    const p = it.variants?.products;
    const fromDesc = arabicProductLabel(p?.description);
    const base = fromDesc ? fromDesc.split(/\s[—–-]\s/)[0].replace(/…$/, "").trim() : await translateToArabic(plainEnglish(p?.name || it.unmapped_name || "منتج"));
    const opt = it.variants?.title && !/^default/i.test(it.variants.title.trim()) ? it.variants.title.trim() : null;
    if (!opt) return base;
    return `${base} - ${ARABIC.test(opt) ? opt : await translateToArabic(opt)}`;
}

const firstName = (o: OrderRow) => String(o.customer_info?.name || "").trim().split(/\s+/)[0] || "عميلنا";
const due = (o: OrderRow) => String(Math.round(Math.max(0, (Number(o.total_amount) || 0) - (Number(o.paid_amount) || 0))));
const ref = (o: OrderRow) => o.id.slice(0, 8).toUpperCase();

export type OrderMessageKind = OrderEvent | "confirm" | "reminder";

export async function sendOrderMessage(businessId: string, orderId: string, kind: OrderMessageKind, sentBy: string, storeName?: string)
    : Promise<{ ok: true; message: unknown } | { ok: false; error: string }> {
    const account = await accountOf(businessId);
    if (!account) return { ok: false, error: "مفيش رقم واتساب متربط بالبيزنس ده." };
    const { data } = await admin.from("orders")
        .select("id, status, total_amount, paid_amount, courier_code, customer_info, shipping_companies(name), order_items(quantity, unmapped_name, variants(title, products(name, description, image_url)))")
        .eq("business_id", businessId).eq("id", orderId).maybeSingle();
    const o = data as unknown as OrderRow | null;
    if (!o) return { ok: false, error: "الأوردر مش موجود." };
    if (!o.customer_info?.phone) return { ok: false, error: "مفيش رقم للعميل." };

    // Which templates to try, in order, and their values.
    let tries: { name: string; params: string[]; image?: string | null }[];
    if (kind === "confirm" || kind === "new_order") {
        const names = await Promise.all((o.order_items || []).map(arabicName));
        const line = (o.order_items || []).map((it, i) => `${names[i]} (عدد ${it.quantity || 1})`).join("، ");
        const params = [firstName(o), line || "طلبك", due(o)];
        const image = (o.order_items || []).map(i => i.variants?.products?.image_url).find(Boolean) || null;
        tries = [
            ...(image ? [{ name: "order_confirm_photo", params, image }] : []),
            { name: "order_confirm", params },
            { name: "order_confirmation", params },
        ];
    } else if (kind === "reminder") {
        const names = await Promise.all((o.order_items || []).map(arabicName));
        tries = [{ name: "confirmation_reminder", params: [firstName(o), names.join("، ") || "طلبك"] }];
    } else if (kind === "confirmed") tries = [{ name: "order_confirmed", params: [firstName(o), ref(o), due(o)] }];
    else if (kind === "shipped") tries = [{ name: "order_shipped", params: [firstName(o), o.shipping_companies?.name || "شركة الشحن", o.courier_code || ref(o), due(o)] }];
    else if (kind === "hold") tries = [{ name: "delivery_failed", params: [firstName(o), ref(o)] }];
    else if (kind === "returning") tries = [{ name: "order_returning", params: [firstName(o), ref(o)] }];
    else tries = [{ name: "order_delivered", params: [firstName(o), storeName || "Zuha Store"] }];

    const to = waNumber(o.customer_info.phone);
    let lastError = "الرسالة ما اتبعتتش.";
    for (const t of tries) {
        const components: Record<string, unknown>[] = [];
        if (t.image) components.push({ type: "header", parameters: [{ type: "image", image: { link: t.image } }] });
        components.push({ type: "body", parameters: t.params.map(p => ({ type: "text", text: p.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim() || "-" })) });
        const res = await graph(`${account.phone_number_id}/messages`, account.token, {
            method: "POST",
            body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: t.name, language: { code: "ar" }, components } }),
        });
        if (!res.ok) {
            lastError = sendError(res.body);
            // A template not approved (or not there) yet: the next one.
            if ([132001, 132000, 132012].includes(res.body?.error?.code)) continue;
            return { ok: false, error: lastError };
        }
        const local = /^20(1\d{9})$/.test(to) ? `0${to.slice(2)}` : to;
        const row = {
            business_id: businessId, phone_number_id: account.phone_number_id, wa_message_id: res.body?.messages?.[0]?.id || null,
            direction: "out", customer_phone: local, customer_wa_id: res.body?.contacts?.[0]?.wa_id || to,
            type: "template", template_name: t.name, body: renderTemplate(t.name, t.params), status: "pending",
            payload: { params: t.params, buttons: templateDef(t.name)?.buttons || [], header_image: t.image || null },
            sent_by: sentBy, order_id: o.id, sent_at: new Date().toISOString(),
        };
        const { data: saved } = await admin.from("whatsapp_messages").insert(row).select("*").single();
        return { ok: true, message: saved || row };
    }
    return { ok: false, error: lastError };
}
