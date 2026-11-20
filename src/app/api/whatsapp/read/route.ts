import { NextResponse } from "next/server";
import { accountOf, admin, memberOf, graph } from "@/lib/whatsapp/server";

/**
 * A chat was opened: the customer's messages are read, for us (the unread
 * count) and for the customer (blue ticks on their last message). With
 * `unread: true` the chat is marked unread again, like WhatsApp's «Mark as
 * unread»: its last customer message goes back to unread, for us only.
 * Body: { business_id, customer_phone, wa_message_id?, unread? }.
 */
export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { business_id?: string; customer_phone?: string; wa_message_id?: string; unread?: boolean } | null;
    if (!body?.business_id || !body.customer_phone) return NextResponse.json({ ok: false }, { status: 400 });
    const who = await memberOf(body.business_id);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });

    if (body.unread) {
        const { data: last } = await admin.from("whatsapp_messages").select("id")
            .eq("business_id", body.business_id).eq("customer_phone", body.customer_phone).eq("direction", "in").neq("type", "reaction")
            .order("sent_at", { ascending: false }).limit(1).maybeSingle();
        if (last) await admin.from("whatsapp_messages").update({ status: "received", status_at: null }).eq("id", last.id);
        return NextResponse.json({ ok: true });
    }

    await admin.from("whatsapp_messages").update({ status: "read", status_at: new Date().toISOString() })
        .eq("business_id", body.business_id).eq("customer_phone", body.customer_phone).eq("direction", "in").eq("status", "received");
    const account = body.wa_message_id ? await accountOf(body.business_id) : null;
    if (account) {
        await graph(`${account.phone_number_id}/messages`, account.token, {
            method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: body.wa_message_id }),
        }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true });
}
