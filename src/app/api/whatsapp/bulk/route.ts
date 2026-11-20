import { NextResponse } from "next/server";
import { admin, memberOf } from "@/lib/whatsapp/server";
import { sendOrderMessage, type OrderMessageKind } from "@/lib/whatsapp/order-messages";
import { CONFIRM_TEMPLATES } from "@/lib/whatsapp/settings";

/**
 * «ابعت للأوردرات اللي ماتبعتلهاش»: the message an older order should have
 * had, for orders from before the automatic messages.
 *  - confirm: store orders still Waiting, from the last `days` days, that
 *    never got a confirmation.
 *  - shipping: orders in Hold to redeliver / Returning that never got that
 *    message.
 * GET counts them; POST sends the next few (the page calls it again until
 * done, showing progress). Only owners and admins. Each order gets it once.
 */

export const maxDuration = 60;

type Kind = "confirm" | "shipping";
const BATCH = 12;
const SHIPPING_TEMPLATE: Record<string, string> = { hold: "delivery_failed", returning: "order_returning" };

async function isManager(businessId: string, email: string) {
    const { data } = await admin.from("business_users").select("role").eq("business_id", businessId).ilike("user_email", email).maybeSingle();
    return ["owner", "admin", "super admin"].includes(String(data?.role || "").toLowerCase().replace(/_/g, " "));
}

/** The orders still owed the message, oldest first, each with the kind to send. */
async function owed(businessId: string, kind: Kind, days: number): Promise<{ id: string; kind: OrderMessageKind }[]> {
    let rows: { id: string; status: string; customer_info: { phone?: string } | null }[] = [];
    if (kind === "confirm") {
        const since = new Date(Date.now() - days * 86_400_000).toISOString();
        const { data } = await admin.from("orders").select("id, status, customer_info, easyorders_id, shopify_id")
            .eq("business_id", businessId).ilike("status", "waiting").gte("created_at", since)
            .or("easyorders_id.not.is.null,shopify_id.not.is.null").order("created_at").limit(2000);
        rows = data || [];
    } else {
        const { data } = await admin.from("orders").select("id, status, customer_info")
            .eq("business_id", businessId).or("status.ilike.hold%,status.ilike.returning").order("status_changed_at", { ascending: true, nullsFirst: true }).limit(2000);
        rows = data || [];
    }
    rows = rows.filter(o => String(o.customer_info?.phone || "").replace(/\D/g, "").length >= 10);
    if (!rows.length) return [];

    // What each already got.
    const got = new Map<string, Set<string>>();
    for (let i = 0; i < rows.length; i += 300) {
        const { data } = await admin.from("whatsapp_messages").select("order_id, template_name, status, error, event:payload->>event")
            .in("order_id", rows.slice(i, i + 300).map(o => o.id)).eq("direction", "out").not("template_name", "is", null);
        for (const m of data || []) {
            // A message that failed on our side (a photo Meta refused) was not received: still owed.
            // One that failed because the number has no WhatsApp counts, so it is not tried again.
            if (m.status === "failed" && !JSON.stringify(m.error || "").includes("131026")) continue;
            if (!got.has(m.order_id)) got.set(m.order_id, new Set());
            got.get(m.order_id)!.add(m.template_name);
            // A template picked in the settings counts as the case it was sent for.
            const ev = (m as { event?: string | null }).event;
            if (ev === "confirm") got.get(m.order_id)!.add("order_confirm");
            if (ev === "hold") got.get(m.order_id)!.add("delivery_failed");
            if (ev === "returning") got.get(m.order_id)!.add("order_returning");
        }
    }
    const out: { id: string; kind: OrderMessageKind }[] = [];
    for (const o of rows) {
        const had = got.get(o.id) || new Set<string>();
        if (kind === "confirm") {
            if (!CONFIRM_TEMPLATES.some(t => had.has(t)) && !had.has("order_confirm_photo")) out.push({ id: o.id, kind: "confirm" });
        } else {
            const k = String(o.status).toLowerCase().startsWith("hold") ? "hold" : "returning";
            if (!had.has(SHIPPING_TEMPLATE[k]) && !had.has(`${SHIPPING_TEMPLATE[k]}_photo`)) out.push({ id: o.id, kind: k });
        }
    }
    return out;
}

async function guard(businessId: string | null) {
    if (!businessId) return { error: NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 }) };
    const who = await memberOf(businessId);
    if ("error" in who) return { error: NextResponse.json({ error: who.error }, { status: who.status }) };
    if (!(await isManager(businessId, who.email))) return { error: NextResponse.json({ error: "الأونر أو الأدمن بس." }, { status: 403 }) };
    return { email: who.email };
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const businessId = url.searchParams.get("business_id");
    const g = await guard(businessId);
    if ("error" in g) return g.error;
    const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days")) || 7));
    const [confirm, shipping] = await Promise.all([owed(businessId!, "confirm", days), owed(businessId!, "shipping", days)]);
    return NextResponse.json({
        confirm: confirm.length,
        shipping: { hold: shipping.filter(o => o.kind === "hold").length, returning: shipping.filter(o => o.kind === "returning").length },
    });
}

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { business_id?: string; kind?: Kind; days?: number; skip?: string[] } | null;
    const g = await guard(body?.business_id || null);
    if ("error" in g) return g.error;
    const kind: Kind = body?.kind === "shipping" ? "shipping" : "confirm";
    const days = Math.min(30, Math.max(1, Number(body?.days) || 7));
    // Orders that failed earlier in this run (a bad number): not tried again.
    const skip = new Set(Array.isArray(body?.skip) ? body!.skip : []);
    const todo = (await owed(body!.business_id!, kind, days)).filter(o => !skip.has(o.id));
    let sent = 0;
    const failedIds: string[] = [];
    const errors: string[] = [];
    let limitHit = false;
    for (const o of todo.slice(0, BATCH)) {
        const r = await sendOrderMessage(body!.business_id!, o.id, o.kind, g.email);
        if (r.ok) sent++;
        else {
            failedIds.push(o.id);
            if (errors.length < 3 && !errors.includes(r.error)) errors.push(r.error);
            // Meta's daily limit or the number's quality: stop here.
            if (/الحد المسموح|وقفت الإرسال|توكن|القالب لسه/.test(r.error)) { limitHit = true; break; }
        }
    }
    const remaining = Math.max(0, todo.length - sent - failedIds.length);
    return NextResponse.json({ sent, failed: failedIds.length, failedIds, remaining, limitHit, errors });
}
