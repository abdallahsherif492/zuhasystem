import { NextResponse } from "next/server";
import { memberOf } from "@/lib/whatsapp/server";
import { sendOrderMessage, type OrderMessageKind } from "@/lib/whatsapp/order-messages";

const KINDS: OrderMessageKind[] = ["confirm", "confirmed", "shipped", "hold", "returning", "delivered"];

/**
 * An order's template message, built on the server and sent from the company
 * number: the confirmation (default) or a shipping one.
 * Body: { business_id, order_id, kind? }.
 */
export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { business_id?: string; order_id?: string; kind?: OrderMessageKind } | null;
    if (!body?.business_id || !body.order_id) return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    const kind = body.kind && KINDS.includes(body.kind) ? body.kind : "confirm";
    const who = await memberOf(body.business_id);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    const r = await sendOrderMessage(body.business_id, body.order_id, kind, who.email);
    return r.ok ? NextResponse.json({ ok: true, message: r.message }) : NextResponse.json({ error: r.error }, { status: 502 });
}
