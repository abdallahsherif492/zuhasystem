import { admin } from "@/lib/whatsapp/server";
import { orderExcepted } from "@/lib/whatsapp/flows";
import { CONFIRM_TEMPLATES, whatsappSettingsOf } from "@/lib/whatsapp/settings";
import { queueStateOf, type QueueOrder } from "@/lib/orders/confirm-queue";

/**
 * «آخر فرصة» orders whose customer never answered on WhatsApp are cancelled
 * on their own (Settings → WhatsApp → «الغي آخر فرصة لو مردش»), as «مابيردش».
 *
 * An order is cancelled only when all of these hold:
 *  - it is still Waiting, from the store, and at its last chance on the
 *    confirmations page (lib/orders/confirm-queue.ts), not waiting for an
 *    appointment;
 *  - the confirmation (or its reminder) reached the customer's phone
 *    (delivered or read: a number with no WhatsApp is called instead);
 *  - the customer has not written anything, nor tapped a button, since the
 *    first confirmation;
 *  - the last of those messages went out `hours` ago or more;
 *  - it is not one of the exceptions under «إلغاء الطلب» (those wait for a person).
 * Run hourly from 09:00 to 22:00 Cairo time, at most 50 orders a run.
 */

const ASKS = new Set([...CONFIRM_TEMPLATES, "confirmation_reminder", "confirmation_reminder_v2"]);
const REACHED = new Set(["delivered", "read"]);
const last10 = (p: unknown) => String(p ?? "").replace(/\D/g, "").slice(-10);

type Row = QueueOrder & { id: string; customer_info: { phone?: string } | null };

/** `dryRun`: which orders it would cancel now, changing nothing (any hour). */
export async function cancelSilentLastChance(opts: { dryRun?: boolean } = {}): Promise<{ business: string; cancelled: string[] }[]> {
    const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Africa/Cairo" }));
    if (!opts.dryRun && (hour < 9 || hour >= 22)) return [];
    const out: { business: string; cancelled: string[] }[] = [];
    const { data: accounts } = await admin.from("whatsapp_accounts").select("business_id");
    for (const businessId of new Set((accounts || []).map(a => a.business_id as string))) {
        const { data: biz } = await admin.from("businesses").select("theme_config").eq("id", businessId).maybeSingle();
        const settings = whatsappSettingsOf(biz?.theme_config);
        if (!settings.auto_cancel_silent) continue;
        const waitMs = Math.max(1, settings.auto_cancel_silent_hours) * 3_600_000;

        const { data: orders } = await admin.from("orders")
            .select("id, created_at, customer_info, confirm_attempts, confirm_rounds, last_attempt_at, last_attempt_reason, next_attempt_at")
            .eq("business_id", businessId).ilike("status", "waiting")
            .or("easyorders_id.not.is.null,shopify_id.not.is.null").limit(2000);
        const now = Date.now();
        const last = ((orders || []) as Row[]).filter(o => last10(o.customer_info?.phone).length === 10 && queueStateOf(o, now) === "last");
        if (!last.length) continue;

        // What we asked each of them, and when.
        const asks = new Map<string, { first: number; latest: number }>();
        for (let i = 0; i < last.length; i += 200) {
            const { data } = await admin.from("whatsapp_messages").select("order_id, template_name, status, sent_at, event:payload->>event")
                .eq("business_id", businessId).eq("direction", "out").not("template_name", "is", null)
                .in("order_id", last.slice(i, i + 200).map(o => o.id));
            for (const m of data || []) {
                const ev = (m as { event?: string | null }).event || "";
                if (!(ASKS.has(m.template_name || "") || ev === "confirm" || ev === "reminder") || !REACHED.has(m.status)) continue;
                const at = Date.parse(m.sent_at);
                const a = asks.get(m.order_id) || { first: at, latest: at };
                asks.set(m.order_id, { first: Math.min(a.first, at), latest: Math.max(a.latest, at) });
            }
        }
        const ripe = last.filter(o => { const a = asks.get(o.id); return a && now - a.latest >= waitMs; });
        if (!ripe.length) continue;

        // Anything the customer sent since (a word, a button, a photo).
        const lastIn = new Map<string, number>();
        const phones = [...new Set(ripe.map(o => `0${last10(o.customer_info?.phone)}`))];
        const earliest = new Date(Math.min(...ripe.map(o => asks.get(o.id)!.first))).toISOString();
        for (let i = 0; i < phones.length; i += 200) {
            const { data } = await admin.from("whatsapp_messages").select("customer_phone, sent_at")
                .eq("business_id", businessId).eq("direction", "in").gte("sent_at", earliest)
                .in("customer_phone", phones.slice(i, i + 200));
            for (const m of data || []) {
                const k = last10(m.customer_phone), at = Date.parse(m.sent_at);
                if (at > (lastIn.get(k) || 0)) lastIn.set(k, at);
            }
        }

        const cancelled: string[] = [];
        for (const o of ripe.filter(o => (lastIn.get(last10(o.customer_info?.phone)) || 0) < asks.get(o.id)!.first).slice(0, 50)) {
            if (await orderExcepted(businessId, o.id, settings.auto_cancel_rule)) continue;
            if (opts.dryRun) { cancelled.push(o.id); continue; }
            const { data: moved } = await admin.from("orders")
                .update({ status: "Cancelled", cancel_reason: "no_answer", cancel_note: "اتلغى لوحده: آخر فرصة ومردش على رسالة التأكيد على الواتساب", cancelled_by: "whatsapp-auto" })
                .eq("business_id", businessId).eq("id", o.id).ilike("status", "waiting").select("id");
            if (!moved?.length) continue;
            cancelled.push(o.id);
            await admin.from("actions_log").insert({
                business_id: businessId, user_email: "whatsapp-auto", action_type: "update_status", entity_type: "order", entity_id: o.id,
                entity_name: `Order #${o.id.slice(0, 8)}`,
                changes: [{ field: "Status", old_value: "Waiting", new_value: "Cancelled (آخر فرصة ومردش على الواتساب)" }],
                metadata: { source: "whatsapp", auto: true },
            });
        }
        if (cancelled.length) out.push({ business: businessId, cancelled });
    }
    return out;
}
