import { admin, isOutage } from "@/lib/whatsapp/server";
import { sendOrderMessage } from "@/lib/whatsapp/order-messages";
import { runEventFlows } from "@/lib/whatsapp/flows";
import { offerUpsell } from "@/lib/whatsapp/upsell";
import { whatsappSettingsOf, type OrderEvent } from "@/lib/whatsapp/settings";

/**
 * Sends what whatsapp_outbox holds (20261125). Each queued event is sent if
 * the business has it on in Settings → WhatsApp and the order is still in the
 * state it was queued for; otherwise it is marked skipped.
 *
 * Nothing polls for it: the database calls /api/cron/whatsapp-outbox the
 * moment a status message is queued (20261126, pg_net), the EasyOrders
 * webhook sends a new order's confirmation once its items are saved, and an
 * hourly run picks up anything left.
 */

const STILL: Record<OrderEvent, (status: string) => boolean> = {
    new_order: s => s === "waiting",
    confirmed: s => s !== "waiting" && s !== "cancelled",
    shipped: s => s === "shipped",
    hold: s => s.includes("hold"),
    returning: s => s === "returning",
    delivered: s => s === "delivered" || s === "collected",
};

export async function processOutbox(opts: { orderId?: string } = {}) {
    // A run that died mid-way leaves its rows "sending": back in the queue after 10 minutes.
    if (!opts.orderId) {
        await admin.from("whatsapp_outbox").update({ status: "queued" }).eq("status", "sending")
            .lt("send_after", new Date(Date.now() - 10 * 60_000).toISOString());
    }
    let q = admin.from("whatsapp_outbox").select("id, business_id, order_id, event").eq("status", "queued");
    q = opts.orderId ? q.eq("order_id", opts.orderId) : q.lte("send_after", new Date().toISOString());
    const { data: queue, error } = await q.order("created_at").limit(40);
    if (error) return { ok: false as const, error: error.message };

    const settingsOf = new Map<string, ReturnType<typeof whatsappSettingsOf>>();
    const names = new Map<string, string>();
    const done: { id: string; status: string; detail?: string }[] = [];
    for (const item of queue || []) {
        // Taken by this run only: a second run at the same moment skips it.
        // (Before 20261126 "sending" is not allowed yet: then it goes without the claim.)
        const { data: claimed, error: claimError } = await admin.from("whatsapp_outbox").update({ status: "sending" })
            .eq("id", item.id).eq("status", "queued").select("id");
        if (!claimError && !claimed?.length) continue;
        if (!settingsOf.has(item.business_id)) {
            const { data: b } = await admin.from("businesses").select("name, theme_config").eq("id", item.business_id).maybeSingle();
            settingsOf.set(item.business_id, whatsappSettingsOf(b?.theme_config));
            names.set(item.business_id, b?.name || "");
        }
        const event = item.event as OrderEvent;
        const finish = async (status: string, detail?: string) => {
            await admin.from("whatsapp_outbox").update({ status, detail: detail || null, processed_at: new Date().toISOString() }).eq("id", item.id);
            done.push({ id: item.id, status, detail });
        };
        const { data: order } = await admin.from("orders").select("status").eq("id", item.order_id).maybeSingle();
        if (!order || !STILL[event]?.(String(order.status).toLowerCase())) { await finish("skipped", `order is ${order?.status || "gone"}`); continue; }
        if (!settingsOf.get(item.business_id)!.events[event]) await finish("skipped", "off in settings");
        else {
            const r = await sendOrderMessage(item.business_id, item.order_id, event, "system", names.get(item.business_id));
            if (!r.ok && isOutage(r.error)) {
                // Meta is refusing everything (blocked access, token, limit): back in the queue,
                // tried again in 15 minutes and by every run after, until it goes.
                await admin.from("whatsapp_outbox").update({ status: "queued", detail: r.error, send_after: new Date(Date.now() + 15 * 60_000).toISOString() }).eq("id", item.id);
                done.push({ id: item.id, status: "retry", detail: r.error });
                continue;
            }
            await finish(r.ok ? "sent" : "failed", r.ok ? undefined : r.error);
        }
        // A moderator confirmed someone who wrote today: the offer (free inside the window).
        if (event === "confirmed") { try { await offerUpsell(item.business_id, item.order_id, null); } catch (e) { console.error("whatsapp upsell", e); } }
        // The rules for this event (Settings → WhatsApp → الأتمتة), even when its built-in message is off.
        try { await runEventFlows(item.business_id, item.order_id, event); } catch (e) { console.error("whatsapp rules", e); }
    }
    return { ok: true as const, processed: done.length, done };
}
