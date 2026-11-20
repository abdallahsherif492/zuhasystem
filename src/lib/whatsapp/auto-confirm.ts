import { deliveryRateOf } from "@/lib/easyorders-delivery-rate";
import { accountOf, admin, graph, waNumber } from "@/lib/whatsapp/server";
import { CANCEL_CHOICES, CONFIRM_TEMPLATES, whatsappSettingsOf, type WhatsAppSettings } from "@/lib/whatsapp/settings";

/**
 * What a customer's answer to the confirmation message does.
 *
 * «تأكيد» (the button or the word) confirms the order on its own when nothing
 * about it needs a person. When something does, the order stays Waiting with
 * a note for the moderator, and the customer is asked for what is missing:
 *  - a product that is not linked: its name as the store sent it, to check;
 *  - a customer who rarely takes their parcels: the deposit and where to send it;
 *  - an address of a few words: the full address;
 *  - totals that do not match, or another open order: told it will be reviewed.
 * «إلغاء الطلب» asks why, as a list; the reason picked cancels the order.
 * Every answer goes inside the 24-hour window, so it costs nothing.
 *
 * Settings → WhatsApp (businesses.theme_config.whatsapp).
 */

const norm = (s: string | null) => (s || "").replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
const YES = /^(تأكيد|تاكيد|تأكيد الطلب|أكد|اكد|أأكد|موافق|تمام|اوكي|اوك|ok|okay|yes|confirm)$/i;
const CANCEL = /^(إلغاء الطلب|الغاء الطلب|إلغاء|الغاء|الغي|ألغي|cancel)$/i;

interface Incoming { customer_phone: string; body: string | null; context_id: string | null; payload: unknown }

async function reply(businessId: string, phone: string, message: Record<string, unknown>, text: string, orderId: string | null) {
    const account = await accountOf(businessId);
    if (!account) return;
    const res = await graph(`${account.phone_number_id}/messages`, account.token, {
        method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", to: waNumber(phone), ...message }),
    });
    if (!res.ok) { console.error("whatsapp auto reply failed", res.body?.error?.message); return; }
    await admin.from("whatsapp_messages").insert({
        business_id: businessId, phone_number_id: account.phone_number_id, wa_message_id: res.body?.messages?.[0]?.id || null,
        direction: "out", customer_phone: phone, type: String(message.type || "text"), body: text, status: "pending",
        sent_by: "system", order_id: orderId, sent_at: new Date().toISOString(),
    });
}
const say = (businessId: string, phone: string, text: string, orderId: string | null) =>
    reply(businessId, phone, { type: "text", text: { body: text } }, text, orderId);

/** The order the customer is answering about: the message replied to, else our latest confirmation in 3 days. */
async function orderAskedAbout(businessId: string, phone: string, contextId: string | null): Promise<string | null> {
    if (contextId) {
        const { data } = await admin.from("whatsapp_messages").select("order_id").eq("wa_message_id", contextId).maybeSingle();
        if (data?.order_id) return data.order_id;
    }
    const { data } = await admin.from("whatsapp_messages").select("order_id")
        .eq("business_id", businessId).eq("customer_phone", phone).eq("direction", "out").not("order_id", "is", null)
        .gte("sent_at", new Date(Date.now() - 3 * 86_400_000).toISOString())
        .order("sent_at", { ascending: false }).limit(1);
    return data?.[0]?.order_id ?? null;
}

async function waitingOrder(businessId: string, orderId: string) {
    const { data } = await admin.from("orders")
        .select("id, status, tags, customer_info, order_items(variant_id, quantity, unmapped_name)")
        .eq("business_id", businessId).eq("id", orderId).maybeSingle();
    return data && String(data.status).toLowerCase() === "waiting" ? data : null;
}

async function note(orderId: string, text: string) {
    await admin.from("orders").update({ last_attempt_note: text }).eq("id", orderId);
}

async function log(businessId: string, orderId: string, change: string) {
    await admin.from("actions_log").insert({
        business_id: businessId, user_email: "whatsapp-auto", action_type: "update_status", entity_type: "order", entity_id: orderId,
        entity_name: `Order #${orderId.slice(0, 8)}`, changes: [{ field: "Status", old_value: "Waiting", new_value: change }],
        metadata: { source: "whatsapp", auto: true },
    });
}

export async function handleReply(businessId: string, m: Incoming) {
    const { data: biz } = await admin.from("businesses").select("theme_config").eq("id", businessId).maybeSingle();
    const settings = whatsappSettingsOf(biz?.theme_config);
    const listId = (m.payload as { interactive?: { list_reply?: { id?: string } } })?.interactive?.list_reply?.id || "";
    const text = norm(m.body);

    // A cancel reason picked from the list.
    if (listId.startsWith("cancel:")) {
        const choice = CANCEL_CHOICES.find(c => c.id === listId);
        const orderId = await orderAskedAbout(businessId, m.customer_phone, m.context_id);
        if (!choice || !orderId || !(await waitingOrder(businessId, orderId))) return;
        const { data: moved } = await admin.from("orders")
            .update({ status: "Cancelled", cancel_reason: choice.reason, cancel_note: `العميل لغى من الواتساب: ${choice.title}`, cancelled_by: "whatsapp-auto" })
            .eq("business_id", businessId).eq("id", orderId).ilike("status", "waiting").select("id");
        if (!moved?.length) return;
        await log(businessId, orderId, `Cancelled (العميل لغى من الواتساب: ${choice.title})`);
        await say(businessId, m.customer_phone, choice.reason === "other"
            ? "تم إلغاء طلبك. لو حابب تقولنا السبب ابعتهولنا هنا، يهمنا نعرف 🌸"
            : "تم إلغاء طلبك. لو غيرت رأيك في أي وقت ابعتلنا هنا 🌸", orderId);
        return;
    }

    if (CANCEL.test(text)) {
        const orderId = await orderAskedAbout(businessId, m.customer_phone, m.context_id);
        if (!orderId || !(await waitingOrder(businessId, orderId))) return;
        const body = "تمام. ممكن تقولنا سبب الإلغاء؟";
        await reply(businessId, m.customer_phone, {
            type: "interactive",
            interactive: {
                type: "list", body: { text: body },
                action: { button: "اختار السبب", sections: [{ title: "سبب الإلغاء", rows: CANCEL_CHOICES.map(c => ({ id: c.id, title: c.title })) }] },
            },
        }, body, orderId);
        return;
    }

    if (await shippingAnswer(businessId, m, text)) return;

    if (YES.test(text) && settings.auto_confirm) await confirm(businessId, m, settings);
}

/**
 * The answer to a shipping message's button, recorded as a follow-up on the
 * shipping problems page (shipping_followups, by "whatsapp-auto") so the team
 * sees it and acts on it there, and acknowledged to the customer:
 *  - «المندوب ماقدرش يوصله»: بكرة / بعد بكرة → a delivery day; كلّموني → call today.
 *  - «الشحنة راجعة»: ابعتوه تاني → still wants it; مش عايزه → refused.
 *  - «اتسلم»: فيه مشكلة → asked what is wrong (the chat then waits for a reply).
 */
const SHIPPING_ANSWERS: Record<string, Record<string, { outcome?: string; days?: number; reply: (day: string) => string }>> = {
    delivery_failed: {
        "بكرة": { outcome: "reached_rescheduled", days: 1, reply: d => `تمام 🌸 هنبلّغ شركة الشحن يبعتوه ${d}، والمندوب هيكلمك قبل ما يوصل.` },
        "بعد بكرة": { outcome: "reached_rescheduled", days: 2, reply: d => `تمام 🌸 هنبلّغ شركة الشحن يبعتوه ${d}، والمندوب هيكلمك قبل ما يوصل.` },
        "كلموني": { outcome: "call_later", days: 0, reply: () => "تمام، هنكلمك النهارده 🌸" },
    },
    order_returning: {
        "ابعتوه تاني": { outcome: "reached_confirmed", reply: () => "تمام 🌸 هنرتب ميعاد جديد ونكلمك نأكد معاك." },
        "مش عايزه": { outcome: "customer_refused", reply: () => "تمام، شكراً لوقتك 🌸 لو غيرت رأيك في أي وقت ابعتلنا هنا." },
    },
    order_delivered: {
        "فيه مشكلة": { reply: () => "آسفين جداً 🙏 احكيلنا إيه المشكلة، ولو تقدر ابعت صورة، وهنحلها على طول." },
    },
};
const plain = (s: string) => s.replace(/[ّ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").trim();

async function shippingAnswer(businessId: string, m: Incoming, text: string): Promise<boolean> {
    const said = plain(text);
    const answers = Object.values(SHIPPING_ANSWERS).flatMap(a => Object.keys(a));
    if (!answers.some(k => plain(k) === said)) return false;

    // The message answered: the one replied to, else our latest template in 3 days.
    let asked: { order_id: string | null; template_name: string | null } | null = null;
    if (m.context_id) {
        const { data } = await admin.from("whatsapp_messages").select("order_id, template_name").eq("wa_message_id", m.context_id).maybeSingle();
        asked = data;
    }
    if (!asked?.template_name) {
        const { data } = await admin.from("whatsapp_messages").select("order_id, template_name")
            .eq("business_id", businessId).eq("customer_phone", m.customer_phone).eq("direction", "out").not("template_name", "is", null)
            .gte("sent_at", new Date(Date.now() - 3 * 86_400_000).toISOString()).order("sent_at", { ascending: false }).limit(1);
        asked = data?.[0] ?? null;
    }
    const table = asked?.template_name ? SHIPPING_ANSWERS[asked.template_name] : null;
    const key = table && Object.keys(table).find(k => plain(k) === said);
    if (!table || !key || !asked?.order_id) return false;
    const a = table[key];

    // The day as people say it, in Cairo.
    const at = new Date(Date.now() + (a.days ?? 0) * 86_400_000);
    const ymd = at.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    const dayName = a.days === 1 ? "بكرة" : at.toLocaleDateString("ar-EG", { weekday: "long", timeZone: "Africa/Cairo" }).replace(/^/, "يوم ");

    if (a.outcome) {
        const { error } = await admin.from("shipping_followups").insert({
            business_id: businessId, order_id: asked.order_id, outcome: a.outcome,
            note: `العميل ردّ على الواتساب: «${key}»`, next_action_at: a.days !== undefined ? ymd : null, created_by: "whatsapp-auto",
        });
        if (error) console.error("whatsapp shipping answer", error.message);
    }
    await say(businessId, m.customer_phone, a.reply(dayName), asked.order_id);
    return true;
}

async function confirm(businessId: string, m: Incoming, s: WhatsAppSettings) {
    const orderId = await orderAskedAbout(businessId, m.customer_phone, m.context_id);
    if (!orderId) return;
    // Only an answer to a confirmation template counts as confirming.
    const { count: asked } = await admin.from("whatsapp_messages").select("id", { count: "exact", head: true })
        .eq("order_id", orderId).eq("direction", "out").in("template_name", [...CONFIRM_TEMPLATES, "confirmation_reminder"]);
    if (!asked) return;
    const order = await waitingOrder(businessId, orderId);
    if (!order) return;
    const phone = m.customer_phone;
    const info = (order.customer_info || {}) as { phone?: string; address?: string };

    const items = (order.order_items || []) as { variant_id: string | null; quantity: number; unmapped_name: string | null }[];
    const unmapped = items.filter(i => !i.variant_id);
    const lowRate = deliveryRateOf(order.customer_info) === "low";
    const words = String(info.address || "").split(/\s+/).filter(w => /[\p{L}]{2,}/u.test(w)).length;
    const shortAddress = words < s.min_address_words;
    const mismatch = JSON.stringify(order.tags || "").includes("total-mismatch");
    const digits = String(info.phone || phone).replace(/\D/g, "").slice(-10);
    const { count: otherOpen } = await admin.from("orders").select("id", { count: "exact", head: true })
        .eq("business_id", businessId).neq("id", orderId).ilike("customer_info->>phone", `%${digits}%`)
        .in("status", ["Waiting", "waiting", "Pending", "pending", "Processing", "processing", "Prepared", "prepared"]);

    const reasons: string[] = [];
    if (unmapped.length) {
        reasons.push("منتج مش متربط");
        const list = unmapped.map(i => `• ${i.unmapped_name || "منتج"} (عدد ${i.quantity || 1})`).join("\n");
        await say(businessId, phone, `شكراً لتأكيدك 🌸 بس عشان نتأكد إن كل حاجة مظبوطة، طلبك فيه:\n${list}\nصح كده؟`, orderId);
    }
    if (lowRate) {
        reasons.push("محتاج ديبوزت");
        await say(businessId, phone, `بستأذنك بس نبعت ديبوزت بسيط لتأكيد الأوردر ${s.deposit_amount} جنيه ❤️\n\nعلى رقم انستا باي\n${s.deposit_instapay}\n\nأو محفظة كاش\n${s.deposit_wallet}\n\nوابعتلنا صورة التحويل هنا.`, orderId);
    }
    if (shortAddress) {
        reasons.push("العنوان ناقص");
        await say(businessId, phone, "ممكن تبعتلنا العنوان بالتفصيل؟ (المنطقة، الشارع، رقم العمارة، الدور، وعلامة مميزة) عشان المندوب يوصلك بسهولة 🌸", orderId);
    }
    if (mismatch) reasons.push("الإجمالي مش مظبوط");
    if ((otherOpen || 0) > 0) reasons.push("عنده أوردر تاني مفتوح");

    if (reasons.length) {
        await note(orderId, `رد «تأكيد» على الواتساب، محتاج مراجعة: ${reasons.join("، ")}`);
        if (!unmapped.length && !lowRate && !shortAddress) {
            await say(businessId, phone, "شكراً! استلمنا تأكيدك ✅ وهنراجع طلبك ونكلمك لو محتاجين أي تفاصيل.", orderId);
        }
        return;
    }

    const { data: moved } = await admin.from("orders")
        .update({ status: "Pending", confirmed_by: "whatsapp-auto" })
        .eq("business_id", businessId).eq("id", orderId).ilike("status", "waiting").select("id");
    if (!moved?.length) return;
    await log(businessId, orderId, "Pending (العميل أكد على الواتساب)");
    await say(businessId, phone, "تم تأكيد طلبك ✅ هيتجهز ويتشحن خلال يومين عمل، وهنبعتلك رقم البوليصة أول ما يتشحن.", orderId);
}
