import { NextResponse } from "next/server";
import { accountOf, admin, memberOf } from "@/lib/whatsapp/server";

/**
 * «العميل مش محتاج رد»: the chat leaves «مستنيين رد» without anything being
 * sent. It is recorded as a note in the chat (type "note", never sent to
 * WhatsApp), which every count already treats as our answer: the chat waits
 * again only when the customer writes again. The note says who marked it.
 * Body: { business_id, customer_phone }.
 */
export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { business_id?: string; customer_phone?: string } | null;
    if (!body?.business_id || !body.customer_phone) return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    const who = await memberOf(body.business_id);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    const account = await accountOf(body.business_id);
    if (!account) return NextResponse.json({ error: "مفيش رقم واتساب متوصل." }, { status: 400 });
    // The customer's messages are read too: nothing about this chat is left to do.
    await admin.from("whatsapp_messages").update({ status: "read", status_at: new Date().toISOString() })
        .eq("business_id", body.business_id).eq("customer_phone", body.customer_phone).eq("direction", "in").eq("status", "received");
    const { data, error } = await admin.from("whatsapp_messages").insert({
        business_id: body.business_id, phone_number_id: account.phone_number_id, direction: "out", customer_phone: body.customer_phone,
        type: "note", body: "مش محتاج رد", status: "note",
        // Not sent_by: a note is not a follow-up (lib/whatsapp/credit.ts counts those).
        payload: { kind: "no_reply", by: who.email },
    }).select("*").single();
    if (error) return NextResponse.json({ error: "ماتسجلش، جرّب تاني." }, { status: 500 });
    return NextResponse.json({ ok: true, message: data });
}
