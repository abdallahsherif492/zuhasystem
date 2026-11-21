import { admin } from "@/lib/whatsapp/server";
import { sendOrderMessage } from "@/lib/whatsapp/order-messages";
import { say } from "@/lib/whatsapp/system-text";
import { creditFollowUp } from "@/lib/whatsapp/credit";
import { whatsappSettingsOf } from "@/lib/whatsapp/settings";
import { CONFIRM_TEMPLATES } from "@/lib/whatsapp/settings";
import { deliveryRateOf } from "@/lib/easyorders-delivery-rate";
import type { Flow, FlowAction, FlowCondition, FlowEvent } from "@/lib/whatsapp/flow-types";

/**
 * Runs the rules of Settings → WhatsApp («الأتمتة», lib/whatsapp/flow-types.ts).
 *
 * Where each kind of rule is checked, so nothing polls more than it already did:
 *  - an order event: when the outbox handles that event (lib/whatsapp/outbox.ts);
 *  - a customer's answer: when the webhook stores it (auto-confirm.ts);
 *  - no answer after N hours: the hourly run (/api/cron/whatsapp-outbox).
 * whatsapp_flow_runs (20261127) records each run, so a rule acts once per
 * order (once per message for answers). Before that migration no rule runs:
 * without the record a rule could repeat itself.
 */

type Ctx = {
    businessId: string;
    orderId: string;
    order: OrderCtx;
    reply?: string;
    phone: string;
};

interface OrderCtx {
    id: string; status: string; total_amount: number; paid_amount: number | null; notes: string | null;
    easyorders_id: string | null; shopify_id: string | null;
    customer_info: { name?: string; phone?: string; governorate?: string; delivery_rate?: string } | null;
    order_items: { quantity: number; unmapped_name: string | null; variants: { sku: string | null; title: string | null; products: { name: string | null } | null } | null }[];
}

async function loadOrder(businessId: string, orderId: string): Promise<OrderCtx | null> {
    const { data } = await admin.from("orders")
        .select("id, status, total_amount, paid_amount, notes, easyorders_id, shopify_id, customer_info, order_items(quantity, unmapped_name, variants(sku, title, products(name)))")
        .eq("business_id", businessId).eq("id", orderId).maybeSingle();
    return data as unknown as OrderCtx | null;
}

const lower = (s: unknown) => String(s ?? "").toLowerCase().trim();
const arabicPlain = (s: unknown) => lower(s).replace(/[ًٌٍَُِّْ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
const num = (s: unknown) => Number(String(s ?? "").replace(/[^\d.]/g, "")) || 0;

function test(c: FlowCondition, x: Ctx): boolean {
    const o = x.order;
    const items = o.order_items || [];
    const v = c.value;
    switch (c.field) {
        case "total": return c.op === "gt" ? Number(o.total_amount) > num(v) : Number(o.total_amount) < num(v);
        case "items": {
            const n = items.reduce((a, i) => a + (Number(i.quantity) || 1), 0);
            return c.op === "gt" ? n > num(v) : n < num(v);
        }
        case "governorate": {
            const is = arabicPlain(o.customer_info?.governorate).includes(arabicPlain(v)) && !!arabicPlain(v);
            return c.op === "is_not" ? !is : is;
        }
        case "sku": {
            const wanted = v.split(/[,،\s]+/).map(lower).filter(Boolean);
            const has = items.some(i => wanted.includes(lower(i.variants?.sku)));
            return c.op === "is_not" ? !has : has;
        }
        case "product": {
            const names = items.map(i => arabicPlain(`${i.variants?.products?.name || i.unmapped_name || ""} ${i.variants?.title || ""}`));
            const has = names.some(n => n.includes(arabicPlain(v)));
            return c.op === "not_contains" ? !has : has;
        }
        case "delivery_rate": {
            const is = (deliveryRateOf(o.customer_info) || "unknown") === v;
            return c.op === "is_not" ? !is : is;
        }
        case "source": {
            const src = o.easyorders_id ? "easyorders" : o.shopify_id ? "shopify" : "manual";
            return c.op === "is_not" ? src !== v : src === v;
        }
        case "reply": {
            if (x.reply === undefined) return false;
            const r = arabicPlain(x.reply), w = arabicPlain(v);
            if (c.op === "is") return r === w;
            return c.op === "not_contains" ? !r.includes(w) : r.includes(w);
        }
    }
    return false;
}

/**
 * Is the order one of the exceptions of the automatic confirm / cancel
 * settings (the same conditions as the rules)? No conditions: no exceptions.
 */
export async function orderExcepted(businessId: string, orderId: string, rule: { match: "all" | "any"; conditions: FlowCondition[] } | undefined, reply?: string) {
    if (!rule?.conditions?.length) return false;
    const order = await loadOrder(businessId, orderId);
    if (!order) return false;
    const x: Ctx = { businessId, orderId, order, phone: order.customer_info?.phone || "", reply };
    return rule.match === "any" ? rule.conditions.some(c => test(c, x)) : rule.conditions.every(c => test(c, x));
}

const matches = (f: Flow, x: Ctx) =>
    !f.conditions.length || (f.match === "any" ? f.conditions.some(c => test(c, x)) : f.conditions.every(c => test(c, x)));

function fill(text: string, o: OrderCtx) {
    const first = String(o.customer_info?.name || "").trim().split(/\s+/)[0] || "";
    const due = Math.round(Math.max(0, Number(o.total_amount) - (Number(o.paid_amount) || 0)));
    const items = (o.order_items || []).map(i => `${i.variants?.products?.name || i.unmapped_name || "منتج"} (عدد ${i.quantity || 1})`).join("، ");
    return text.replace(/\{الاسم\}/g, first).replace(/\{المنتجات\}/g, items).replace(/\{المبلغ\}/g, `${due} جنيه`).replace(/\{رقم_الطلب\}/g, o.id.slice(0, 8).toUpperCase());
}

async function act(a: FlowAction, x: Ctx, flow: Flow): Promise<string> {
    switch (a.type) {
        case "template": {
            const r = await sendOrderMessage(x.businessId, x.orderId, a.template, "system");
            return r.ok ? `sent ${a.template}` : `failed ${a.template}: ${r.error}`;
        }
        case "text": {
            const ok = await say(x.businessId, x.phone, fill(a.text, x.order), x.orderId);
            return ok ? "sent text" : "text not sent (24h window closed?)";
        }
        case "status": {
            // Only from Waiting, so a rule never moves an order backwards.
            const patch = a.status === "Pending"
                ? { status: "Pending", confirmed_by: "whatsapp-auto" }
                : { status: "Cancelled", cancelled_by: "whatsapp-auto", cancel_note: `قاعدة «${flow.name}»` };
            const { data } = await admin.from("orders").update(patch).eq("id", x.orderId).ilike("status", "waiting").select("id");
            if (data?.length) {
                await creditFollowUp(x.businessId, x.orderId, x.phone, a.status === "Pending" ? "confirmed" : "cancelled");
                await admin.from("actions_log").insert({
                    business_id: x.businessId, user_email: "whatsapp-auto", action_type: "update_status", entity_type: "order", entity_id: x.orderId,
                    entity_name: `Order #${x.orderId.slice(0, 8)}`, changes: [{ field: "Status", old_value: "Waiting", new_value: `${a.status} (قاعدة «${flow.name}»)` }],
                    metadata: { source: "whatsapp-flow", flow: flow.id },
                });
            }
            return data?.length ? `status ${a.status}` : "status unchanged";
        }
        case "assign": {
            if (!a.email) return "no one to assign";
            await admin.from("orders").update({ claimed_by: a.email.toLowerCase(), claimed_at: new Date().toISOString() }).eq("id", x.orderId);
            return `assigned ${a.email}`;
        }
        case "note": {
            const line = `[${flow.name}] ${fill(a.text, x.order)}`;
            await admin.from("orders").update({ notes: x.order.notes ? `${x.order.notes}\n${line}` : line }).eq("id", x.orderId);
            return "note";
        }
    }
}

/** Claims the run; false when this rule already ran for it (or the table is not there yet). */
async function claim(businessId: string, flow: Flow, orderId: string, key: string) {
    const { error } = await admin.from("whatsapp_flow_runs").insert({ business_id: businessId, flow_id: flow.id, order_id: orderId, run_key: key });
    return !error;
}

async function run(flows: Flow[], x: Ctx, keyOf: (f: Flow) => string) {
    for (const f of flows) {
        if (!f.enabled || !f.actions.length || !matches(f, x)) continue;
        if (!(await claim(x.businessId, f, x.orderId, keyOf(f)))) continue;
        const results: string[] = [];
        for (const a of f.actions) {
            try { results.push(await act(a, x, f)); } catch (e) { results.push(`error ${(e as Error).message}`); }
        }
        await admin.from("whatsapp_flow_runs").update({ result: results.join(" · ") }).eq("flow_id", f.id).eq("run_key", keyOf(f));
    }
}

async function flowsOf(businessId: string) {
    const { data } = await admin.from("businesses").select("theme_config").eq("id", businessId).maybeSingle();
    return whatsappSettingsOf(data?.theme_config).flows.filter(f => f.enabled);
}

/** An order event (the outbox handled it). */
export async function runEventFlows(businessId: string, orderId: string, event: FlowEvent) {
    const flows = (await flowsOf(businessId)).filter(f => f.trigger.type === "event" && f.trigger.event === event);
    if (!flows.length) return;
    const order = await loadOrder(businessId, orderId);
    if (!order?.customer_info?.phone) return;
    await run(flows, { businessId, orderId, order, phone: order.customer_info.phone }, f => `${orderId}:${event}:${f.id}`);
}

/** A customer's message, about the order it answers. */
export async function runReplyFlows(businessId: string, orderId: string | null, phone: string, text: string, messageId: string) {
    if (!orderId || !text) return;
    const flows = (await flowsOf(businessId)).filter(f => f.trigger.type === "reply");
    if (!flows.length) return;
    const order = await loadOrder(businessId, orderId);
    if (!order) return;
    await run(flows, { businessId, orderId, order, phone, reply: text }, () => `reply:${messageId}`);
}

/**
 * The hourly run: for each rule «مردش بعد N ساعة», Waiting orders whose
 * confirmation went out N or more hours ago (within the last 2 days) and
 * whose customer has not written since.
 */
export async function runTimedFlows() {
    // Not at night: between 22:00 and 09:00 in Cairo nothing goes; the window
    // below reaches back 48 hours, so those orders are picked up in the morning.
    const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Africa/Cairo" }));
    if (hour < 9 || hour >= 22) return;
    const { data: businesses } = await admin.from("businesses").select("id, theme_config").not("theme_config->whatsapp->flows", "is", null);
    for (const b of businesses || []) {
        const flows = whatsappSettingsOf(b.theme_config).flows.filter(f => f.enabled && f.trigger.type === "no_reply");
        for (const f of flows) {
            const hours = Math.max(1, Number((f.trigger as { hours: number }).hours) || 4);
            const until = new Date(Date.now() - hours * 3_600_000).toISOString();
            const from = new Date(Date.now() - (hours + 48) * 3_600_000).toISOString();
            const { data: sent } = await admin.from("whatsapp_messages").select("order_id, customer_phone, sent_at")
                .eq("business_id", b.id).eq("direction", "out")
                .or(`template_name.in.(${[...CONFIRM_TEMPLATES, "order_confirm_photo"].join(",")}),payload->>event.eq.confirm`)
                .gte("sent_at", from).lte("sent_at", until).not("order_id", "is", null)
                .neq("status", "failed") // never reached the customer (no WhatsApp): a reminder would not either
                .limit(500);
            for (const s of sent || []) {
                const { count: answered } = await admin.from("whatsapp_messages").select("id", { count: "exact", head: true })
                    .eq("business_id", b.id).eq("customer_phone", s.customer_phone).eq("direction", "in").gte("sent_at", s.sent_at);
                if (answered) continue;
                const order = await loadOrder(b.id, s.order_id!);
                if (!order || lower(order.status) !== "waiting") continue;
                await run([f], { businessId: b.id, orderId: order.id, order, phone: s.customer_phone }, () => `${order.id}:no_reply`);
            }
        }
    }
}
