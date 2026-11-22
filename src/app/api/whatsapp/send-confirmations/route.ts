import { NextResponse } from "next/server";
import { admin, isOutage, memberOf } from "@/lib/whatsapp/server";
import { sendOrderMessage, type OrderMessageKind } from "@/lib/whatsapp/order-messages";
import { CONFIRM_TEMPLATES } from "@/lib/whatsapp/settings";

/**
 * «ابعت رسالة التأكيد» for the orders picked on the store orders page, a few
 * per call (the page sends the rest in turns, showing progress):
 *  - an order that never got the confirmation gets it;
 *  - one that got it 3 hours ago or more and is still Waiting gets the reminder;
 *  - one that got either less than 3 hours ago is left alone (no spamming);
 *  - a number with no WhatsApp is skipped (it needs a call).
 * Body: { business_id, order_ids } (at most 10). Any member can send, as with
 * the card's own button.
 */

export const maxDuration = 60;

const MAX = 10;
const GAP_MS = 3 * 3_600_000;
const ASKS = new Set([...CONFIRM_TEMPLATES, "confirmation_reminder", "confirmation_reminder_v2"]);

type Outcome = "confirm" | "reminder" | "recent" | "no_whatsapp" | "not_waiting" | "no_phone" | "failed";

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { business_id?: string; order_ids?: unknown } | null;
    const businessId = body?.business_id;
    const ids = Array.isArray(body?.order_ids) ? (body!.order_ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
    if (!businessId || !ids.length) return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    const who = await memberOf(businessId);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });

    const [{ data: orders }, { data: msgs }] = await Promise.all([
        admin.from("orders").select("id, status, customer_info").eq("business_id", businessId).in("id", ids),
        admin.from("whatsapp_messages").select("order_id, template_name, status, error, sent_at, event:payload->>event")
            .eq("business_id", businessId).in("order_id", ids).eq("direction", "out").not("template_name", "is", null),
    ]);

    const results: { id: string; outcome: Outcome; error?: string }[] = [];
    let stop: string | null = null;
    for (const id of ids) {
        const o = (orders || []).find(x => x.id === id);
        if (!o || String(o.status).toLowerCase() !== "waiting") { results.push({ id, outcome: "not_waiting" }); continue; }
        if (String((o.customer_info as { phone?: string } | null)?.phone || "").replace(/\D/g, "").length < 10) { results.push({ id, outcome: "no_phone" }); continue; }
        if (stop) { results.push({ id, outcome: "failed", error: stop }); continue; }

        const asked = (msgs || []).filter(m => m.order_id === id && (ASKS.has(m.template_name || "") || ["confirm", "reminder"].includes((m as { event?: string | null }).event || "")));
        if (asked.some(m => JSON.stringify(m.error || "").includes("131026"))) { results.push({ id, outcome: "no_whatsapp" }); continue; }
        // Failed on our side (a photo Meta refused): it never reached them.
        const reached = asked.filter(m => m.status !== "failed");
        const last = reached.map(m => Date.parse(m.sent_at)).sort((a, b) => b - a)[0];
        if (last && Date.now() - last < GAP_MS) { results.push({ id, outcome: "recent" }); continue; }

        const kind: OrderMessageKind = reached.length ? "reminder" : "confirm";
        const r = await sendOrderMessage(businessId, id, kind, who.email);
        if (r.ok) results.push({ id, outcome: kind });
        else {
            results.push({ id, outcome: "failed", error: r.error });
            // Meta stopped us (limit, token, blocked account): the rest would fail the same way.
            if (isOutage(r.error)) stop = r.error;
        }
    }
    return NextResponse.json({ results, stopped: stop });
}
