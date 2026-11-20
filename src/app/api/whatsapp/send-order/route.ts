import { NextResponse } from "next/server";
import { memberOf } from "@/lib/whatsapp/server";
import { sendOrderMessage } from "@/lib/whatsapp/order-messages";

/** «ابعت التأكيد»: the confirmation template for an order, built on the server. Body: { business_id, order_id }. */
export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { business_id?: string; order_id?: string } | null;
    if (!body?.business_id || !body.order_id) return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    const who = await memberOf(body.business_id);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    const r = await sendOrderMessage(body.business_id, body.order_id, "confirm", who.email);
    return r.ok ? NextResponse.json({ ok: true, message: r.message }) : NextResponse.json({ error: r.error }, { status: 502 });
}
