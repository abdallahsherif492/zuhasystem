import { admin } from "@/lib/whatsapp/server";
import { reply, say } from "@/lib/whatsapp/system-text";
import { arabicProductName } from "@/lib/whatsapp/order-messages";
import { whatsappSettingsOf } from "@/lib/whatsapp/settings";

/**
 * The offer after a confirmation (cross-sell): the product most often bought
 * with what the customer ordered, with its photo, at a discount, with two
 * buttons — «ضيفه لطلبي» adds it to the same order (same shipment, no extra
 * shipping), «لا شكراً» closes it.
 *
 * Sent only inside the 24-hour window (right after the customer's «تأكيد»,
 * or when a moderator confirms someone who wrote today), so it is free, and
 * once per order. A product without a photo is never offered.
 * Settings → WhatsApp → «عرض بعد التأكيد».
 */

const DAY = 86_400_000;
const ACTIVE = ["pending", "processing", "prepared"];

interface Pick { variantId: string; productId: string; name: string; description: string | null; option: string | null; image: string; price: number; cost: number }

/** Which product to offer: bought together with the order's products, else a best seller. */
export async function pickProduct(businessId: string, productIds: string[]): Promise<Pick | null> {
    const since = new Date(Date.now() - 180 * DAY).toISOString();
    const score = new Map<string, number>();

    if (productIds.length) {
        const { data: theirVariants } = await admin.from("variants").select("id").in("product_id", productIds);
        const vids = (theirVariants || []).map(v => v.id);
        if (vids.length) {
            const { data: withThem } = await admin.from("order_items").select("order_id, orders!inner(created_at, status)")
                .in("variant_id", vids).eq("business_id", businessId).gte("orders.created_at", since).limit(800);
            const orderIds = [...new Set((withThem || []).filter(r => !/cancel/i.test(String((r.orders as unknown as { status: string })?.status))).map(r => r.order_id))];
            for (let i = 0; i < orderIds.length; i += 200) {
                const { data: items } = await admin.from("order_items").select("order_id, variants(product_id)").in("order_id", orderIds.slice(i, i + 200));
                for (const it of items || []) {
                    const pid = (it.variants as unknown as { product_id: string } | null)?.product_id;
                    if (pid && !productIds.includes(pid)) score.set(pid, (score.get(pid) || 0) + 1);
                }
            }
        }
    }
    if (!score.size) {
        // Nothing bought together yet: what sold most in the last month.
        const { data: recent } = await admin.from("order_items").select("quantity, variants(product_id), orders!inner(created_at, status)")
            .eq("business_id", businessId).gte("orders.created_at", new Date(Date.now() - 30 * DAY).toISOString()).limit(3000);
        for (const it of recent || []) {
            const pid = (it.variants as unknown as { product_id: string } | null)?.product_id;
            if (pid && !productIds.includes(pid) && !/cancel/i.test(String((it.orders as unknown as { status: string })?.status))) score.set(pid, (score.get(pid) || 0) + (Number(it.quantity) || 1));
        }
    }

    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([pid]) => pid);
    if (!ranked.length) return null;
    const { data: products } = await admin.from("products")
        .select("id, name, description, image_url, archived, variants(id, title, sale_price, cost_price, track_inventory, stock_qty, archived)")
        .in("id", ranked).eq("business_id", businessId);
    for (const pid of ranked) {
        const p = (products || []).find(x => x.id === pid) as unknown as {
            id: string; name: string; description: string | null; image_url: string | null; archived: boolean | null;
            variants: { id: string; title: string | null; sale_price: number | null; cost_price: number | null; track_inventory: boolean | null; stock_qty: number | null; archived: boolean | null }[];
        } | undefined;
        if (!p || p.archived || !p.image_url) continue;
        const v = (p.variants || []).find(x => !x.archived && Number(x.sale_price) > 0 && (!x.track_inventory || Number(x.stock_qty) > 0));
        if (!v) continue;
        return { variantId: v.id, productId: p.id, name: p.name, description: p.description, option: (p.variants.length > 1 ? v.title : null), image: p.image_url, price: Number(v.sale_price), cost: Number(v.cost_price) || 0 };
    }
    return null;
}

/** The offer's price: the discount, rounded down to a round 5 pounds. */
const offerPrice = (price: number, pct: number) => Math.max(1, Math.floor((price * (1 - pct / 100)) / 5) * 5);

/** Has the customer written in the last 24 hours (free messages allowed)? */
async function windowOpen(businessId: string, phone: string) {
    const { count } = await admin.from("whatsapp_messages").select("id", { count: "exact", head: true })
        .eq("business_id", businessId).eq("customer_phone", phone).eq("direction", "in")
        .gte("sent_at", new Date(Date.now() - DAY + 10 * 60_000).toISOString());
    return !!count;
}

/** `phone` as the chats keep it; null: the order's own number. */
export async function offerUpsell(businessId: string, orderId: string, phone: string | null): Promise<string> {
    const { data: biz } = await admin.from("businesses").select("theme_config").eq("id", businessId).maybeSingle();
    const s = whatsappSettingsOf(biz?.theme_config).upsell;
    if (!s.enabled) return "off";
    if (!phone) {
        const { data: o } = await admin.from("orders").select("customer_info").eq("id", orderId).maybeSingle();
        const d = String((o?.customer_info as { phone?: string } | null)?.phone || "").replace(/\D/g, "").slice(-10);
        if (d.length !== 10) return "no phone";
        phone = `0${d}`;
    }
    if (!(await windowOpen(businessId, phone))) return "window closed";
    const { count: offered } = await admin.from("whatsapp_messages").select("id", { count: "exact", head: true })
        .eq("order_id", orderId).eq("direction", "out").eq("payload->>kind", "upsell");
    if (offered) return "already offered";

    const { data: order } = await admin.from("orders").select("id, status, customer_info, order_items(variants(product_id))")
        .eq("business_id", businessId).eq("id", orderId).maybeSingle();
    if (!order || !ACTIVE.includes(String(order.status).toLowerCase())) return "order not active";
    const productIds = (order.order_items || []).map(i => (i.variants as unknown as { product_id: string } | null)?.product_id).filter(Boolean) as string[];
    const pick = await pickProduct(businessId, productIds);
    if (!pick) return "nothing to offer";

    const name = await arabicProductName(pick.name, pick.description, pick.option);
    const price = offerPrice(pick.price, s.discount_percent);
    const first = String((order.customer_info as { name?: string } | null)?.name || "").trim().split(/\s+/)[0];
    const text = `🎁 عرض لطلبك بس${first ? ` يا ${first}` : ""}\n\n${name}\nبدل ${Math.round(pick.price)} جنيه بـ ${price} جنيه بس (خصم ${s.discount_percent}%)\n\nبيوصلك مع نفس الطلب، من غير مصاريف شحن زيادة.`;
    const buttons = ["ضيفه لطلبي", "لا شكراً"];
    await reply(businessId, phone, {
        type: "interactive",
        interactive: {
            type: "button",
            header: { type: "image", image: { link: pick.image } },
            body: { text },
            action: { buttons: [
                { type: "reply", reply: { id: `upsell:add:${orderId}:${pick.variantId}`, title: buttons[0] } },
                { type: "reply", reply: { id: `upsell:no:${orderId}`, title: buttons[1] } },
            ] },
        },
    }, text, orderId, { kind: "upsell", header_image: pick.image, buttons, variant_id: pick.variantId, price });
    return `offered ${pick.variantId}`;
}

/** The customer's button on the offer. True when it was one. */
export async function upsellAnswer(businessId: string, phone: string, buttonId: string): Promise<boolean> {
    const [, what, orderId, variantId] = buttonId.split(":");
    if (!orderId) return false;
    if (what === "no") { await say(businessId, phone, "ولا يهمك 🌸 طلبك هيتجهز ويتشحن قريب.", orderId); return true; }
    if (what !== "add" || !variantId) return false;

    const { data: offer } = await admin.from("whatsapp_messages").select("payload")
        .eq("order_id", orderId).eq("direction", "out").eq("payload->>kind", "upsell").eq("payload->>variant_id", variantId)
        .order("sent_at", { ascending: false }).limit(1).maybeSingle();
    const price = Number((offer?.payload as { price?: number } | null)?.price);
    if (!offer || !(price > 0)) return false;

    const { data: order } = await admin.from("orders").select("id, status, courier_code, subtotal, total_amount, total_cost, paid_amount, order_items(variant_id)")
        .eq("business_id", businessId).eq("id", orderId).maybeSingle();
    if (!order) return true;
    if ((order.order_items || []).some(i => i.variant_id === variantId)) {
        await say(businessId, phone, "المنتج ده موجود في طلبك بالفعل 🌸", orderId);
        return true;
    }
    if (!ACTIVE.includes(String(order.status).toLowerCase()) || order.courier_code) {
        await say(businessId, phone, "للأسف طلبك اتسلم لشركة الشحن خلاص 🙏 لو حابب ناخده في طلب جديد ابعتلنا هنا.", orderId);
        return true;
    }
    const { data: v } = await admin.from("variants").select("id, cost_price, products(name, description)").eq("id", variantId).eq("business_id", businessId).maybeSingle();
    if (!v) return true;
    const cost = Number(v.cost_price) || 0;
    const { error } = await admin.from("order_items").insert({
        order_id: orderId, variant_id: variantId, quantity: 1, price_at_sale: price, cost_at_sale: cost, business_id: businessId,
    });
    if (error) {
        await say(businessId, phone, "حصلت مشكلة وإحنا بنضيفه 🙏 هنكلمك نضيفه بنفسنا.", orderId);
        await admin.from("orders").update({ last_attempt_note: `العميل وافق على العرض من الواتساب بس ما اتضافش: ${error.message}` }).eq("id", orderId);
        return true;
    }
    const total = Number(order.total_amount) + price;
    await admin.from("orders").update({
        subtotal: Number(order.subtotal || 0) + price, total_amount: total, total_cost: Number(order.total_cost || 0) + cost,
    }).eq("id", orderId);
    await admin.from("actions_log").insert({
        business_id: businessId, user_email: "whatsapp-auto", action_type: "update", entity_type: "order", entity_id: orderId,
        entity_name: `Order #${orderId.slice(0, 8)}`, changes: [{ field: "Items", old_value: null, new_value: `+1 من العرض على الواتساب (${price} جنيه)` }],
        metadata: { source: "whatsapp-upsell", variant_id: variantId, price },
    });
    const p = v.products as unknown as { name: string; description: string | null } | null;
    const name = await arabicProductName(p?.name, p?.description);
    await say(businessId, phone, `تمام 🌸 ضفنا ${name} لطلبك.\nالمطلوب عند الاستلام بقى ${Math.round(total - (Number(order.paid_amount) || 0))} جنيه.`, orderId);
    return true;
}
