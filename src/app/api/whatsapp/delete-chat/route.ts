import { NextResponse } from "next/server";
import { admin } from "@/lib/whatsapp/server";
import { ownerOf } from "@/lib/whatsapp/owner";

/**
 * Delete a chat from the system for good, owners only: every message with
 * this customer, here. WhatsApp offers no way to delete anything from the
 * customer's phone, so they keep their copy. Logged in the actions log.
 * POST { business_id, phone }.
 */
export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { business_id?: string; phone?: string } | null;
    if (!body?.business_id || !body.phone) return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    const who = await ownerOf(body.business_id);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    const { data, error } = await admin.from("whatsapp_messages").delete()
        .eq("business_id", body.business_id).eq("customer_phone", body.phone).select("id");
    if (error) return NextResponse.json({ error: "ما اتمسحش، جرّب تاني." }, { status: 500 });
    await admin.from("actions_log").insert({
        business_id: body.business_id, user_email: who.email, action_type: "delete", entity_type: "whatsapp_chat", entity_id: body.phone,
        entity_name: `WhatsApp ${body.phone}`, changes: [{ field: "Messages", old_value: String(data?.length || 0), new_value: "0 (اتمسحت نهائياً)" }],
        metadata: { source: "whatsapp" },
    });
    return NextResponse.json({ ok: true, deleted: data?.length || 0 });
}
