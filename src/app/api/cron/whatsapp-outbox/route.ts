import { NextResponse } from "next/server";
import { resolveCronCaller } from "../auto-sync/cron-auth";
import { admin } from "@/lib/whatsapp/server";
import { sendOrderMessage } from "@/lib/whatsapp/order-messages";
import { whatsappSettingsOf, type OrderEvent } from "@/lib/whatsapp/settings";

/**
 * Sends what whatsapp_outbox holds (20261125): run every minute by
 * netlify/functions/whatsapp-outbox.mjs. Each queued event is sent if the
 * business has it on in Settings → WhatsApp and the order is still in the
 * state it was queued for; otherwise it is marked skipped.
 */

export const maxDuration = 60;

const STILL: Record<OrderEvent, (status: string) => boolean> = {
    new_order: s => s === "waiting",
    confirmed: s => s !== "waiting" && s !== "cancelled",
    shipped: s => s === "shipped",
    hold: s => s.includes("hold"),
    returning: s => s === "returning",
    delivered: s => s === "delivered" || s === "collected",
};

export async function GET(request: Request) {
    const caller = await resolveCronCaller(request);
    if (caller.kind !== "scheduler") return NextResponse.json({ error: "scheduler only" }, { status: 401 });

    const { data: queue, error } = await admin.from("whatsapp_outbox").select("id, business_id, order_id, event")
        .eq("status", "queued").lte("send_after", new Date().toISOString()).order("created_at").limit(40);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const settingsOf = new Map<string, ReturnType<typeof whatsappSettingsOf>>();
    const names = new Map<string, string>();
    const done: { id: string; status: string; detail?: string }[] = [];
    for (const item of queue || []) {
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
        if (!settingsOf.get(item.business_id)!.events[event]) { await finish("skipped", "off in settings"); continue; }
        const { data: order } = await admin.from("orders").select("status").eq("id", item.order_id).maybeSingle();
        if (!order || !STILL[event]?.(String(order.status).toLowerCase())) { await finish("skipped", `order is ${order?.status || "gone"}`); continue; }
        const r = await sendOrderMessage(item.business_id, item.order_id, event, "system", names.get(item.business_id));
        await finish(r.ok ? "sent" : "failed", r.ok ? undefined : r.error);
    }
    return NextResponse.json({ ok: true, processed: done.length, done });
}
