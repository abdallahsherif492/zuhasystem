import { arabicProductLabel } from "@/lib/orders/product-label";
import { plainEnglish } from "@/lib/orders/arabic-names";
import { translateToArabic } from "@/lib/translate-ar";
import { accountOf, admin, graph, sendError, uploadImage, waNumber } from "@/lib/whatsapp/server";
import { renderTemplate, templateDef } from "@/lib/whatsapp/templates";
import { whatsappSettingsOf, type OrderEvent } from "@/lib/whatsapp/settings";
import { BUILTIN_PARAMS, type FieldKey, type MessageCase } from "@/lib/whatsapp/template-fields";

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
    const { data: biz } = await admin.from("businesses").select("name, theme_config").eq("id", businessId).maybeSingle();
    const settings = whatsappSettingsOf(biz?.theme_config);
    if (!o.customer_info?.phone) return { ok: false, error: "مفيش رقم للعميل." };

    // Every detail a template can carry (lib/whatsapp/template-fields.ts).
    const theCase: MessageCase = kind === "new_order" ? "confirm" : kind;
    const builtins: Record<MessageCase, string[]> = {
        confirm: ["order_confirm_photo", "order_confirm", "order_confirmation"],
        reminder: ["confirmation_reminder"],
        confirmed: ["order_confirmed"],
        shipped: ["order_shipped"],
        hold: ["delivery_failed_photo", "delivery_failed"],
        returning: ["order_returning_photo", "order_returning"],
        delivered: ["order_delivered"],
    };
    const chosen = settings.case_templates[theCase];
    const names2 = [...new Set([...(chosen ? [chosen] : []), ...builtins[theCase]])];
    // The products' Arabic names only when a template carries them (they may need translating).
    const needsItems = names2.some(n => (settings.templates[n]?.params || BUILTIN_PARAMS[n] || []).includes("items"));
    const names = needsItems ? await Promise.all((o.order_items || []).map(arabicName)) : [];
    const info = (o.customer_info || {}) as { governorate?: string; address?: string };
    const values: Record<FieldKey, string> = {
        first_name: firstName(o),
        items: (o.order_items || []).map((it, i) => `${names[i]} (عدد ${it.quantity || 1})`).join("، ") || "طلبك",
        due: due(o),
        total: String(Math.round(Number(o.total_amount) || 0)),
        ref: ref(o),
        courier: o.shipping_companies?.name || "شركة الشحن",
        tracking: o.courier_code || ref(o),
        store: storeName || biz?.name || "Zuha Store",
        governorate: info.governorate || "-",
        address: info.address || "-",
    };
    const image = (o.order_items || []).map(i => i.variants?.products?.image_url).find(Boolean) || null;

    // Which templates to try, in order: the one chosen in the settings for
    // this case, then the system's own (with the photo first when there is one).
    const tries: { name: string; params: string[]; image?: string | null; body: string | null; buttons: string[] }[] = [];
    for (const name of names2) {
        const saved = settings.templates[name];
        const def = templateDef(name);
        const params = saved?.params || BUILTIN_PARAMS[name];
        if (!params) continue; // a template whose details the system does not know
        const wantsImage = saved ? saved.image : !!def?.imageHeader;
        if (wantsImage && !image) continue;
        const body = saved?.body ?? def?.body ?? null;
        tries.push({
            name, params: params.map(k => values[k] ?? "-"), image: wantsImage ? image : null,
            body: body ? body.replace(/\{\{(\d+)\}\}/g, (_, n) => values[params[Number(n) - 1]] ?? "") : null,
            buttons: saved?.buttons || def?.buttons || [],
        });
    }

    const to = waNumber(o.customer_info.phone);
    let lastError = "الرسالة ما اتبعتتش.";
    for (const t of tries) {
        const components: Record<string, unknown>[] = [];
        if (t.image) {
            // Uploaded with its real type (the store's links say "image/jpg", which Meta refuses).
            const mediaId = await uploadImage(account, t.image);
            if (!mediaId) continue; // no usable photo: the confirmation without it
            components.push({ type: "header", parameters: [{ type: "image", image: { id: mediaId } }] });
        }
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
            type: "template", template_name: t.name, body: t.body ?? renderTemplate(t.name, t.params), status: "pending",
            payload: { params: t.params, buttons: t.buttons, header_image: t.image || null, event: theCase },
            sent_by: sentBy, order_id: o.id, sent_at: new Date().toISOString(),
        };
        const { data: saved } = await admin.from("whatsapp_messages").insert(row).select("*").single();
        return { ok: true, message: saved || row };
    }
    return { ok: false, error: lastError };
}
