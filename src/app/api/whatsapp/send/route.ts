import { NextResponse } from "next/server";
import { accountOf, admin, graph, memberOf, sendError, waNumber } from "@/lib/whatsapp/server";

/**
 * Send a WhatsApp message from the business's number, as the signed-in
 * member: free text inside the 24 hours after the customer last wrote, or an
 * approved template (any time). Kept in whatsapp_messages with who sent it;
 * the webhook then reports sent / delivered / read.
 *
 * Body: { business_id, phone, text } or
 *       { business_id, phone, template: { name, language, params[] }, order_id?, preview? }
 */

const clean = (s: string) => String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as {
        business_id?: string; phone?: string; text?: string; order_id?: string | null; reply_to?: string | null;
        template?: { name: string; language?: string; params?: string[] }; preview?: string;
    } | null;
    if (!body?.business_id || !body.phone || (!body.text?.trim() && !body.template?.name)) {
        return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    }
    const who = await memberOf(body.business_id);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    const account = await accountOf(body.business_id);
    if (!account) return NextResponse.json({ error: "مفيش رقم واتساب متربط بالبيزنس ده." }, { status: 400 });

    const to = waNumber(body.phone);
    const local = /^20(1\d{9})$/.test(to) ? `0${to.slice(2)}` : to;
    const message = body.template
        ? {
            messaging_product: "whatsapp", to, type: "template",
            template: {
                name: body.template.name,
                language: { code: body.template.language || "ar" },
                components: body.template.params?.length
                    ? [{ type: "body", parameters: body.template.params.map(p => ({ type: "text", text: clean(p) || "-" })) }]
                    : [],
            },
        }
        : { messaging_product: "whatsapp", to, type: "text", text: { body: body.text!.trim(), preview_url: true }, ...(body.reply_to ? { context: { message_id: body.reply_to } } : {}) };

    const sent = await graph(`${account.phone_number_id}/messages`, account.token, { method: "POST", body: JSON.stringify(message) });
    if (!sent.ok) return NextResponse.json({ error: sendError(sent.body) }, { status: 502 });

    const waId = sent.body?.messages?.[0]?.id as string | undefined;
    const row = {
        business_id: body.business_id,
        phone_number_id: account.phone_number_id,
        wa_message_id: waId || null,
        direction: "out",
        customer_phone: local,
        customer_wa_id: sent.body?.contacts?.[0]?.wa_id || to,
        type: body.template ? "template" : "text",
        body: body.template ? (body.preview || body.template.params?.join(" · ") || body.template.name) : body.text!.trim(),
        template_name: body.template?.name || null,
        context_id: body.reply_to || null,
        status: "pending",
        sent_by: who.email,
        order_id: body.order_id || null,
        sent_at: new Date().toISOString(),
    };
    const { data, error } = await admin.from("whatsapp_messages").insert(row).select("*").single();
    if (error) console.error("whatsapp send: not saved", error.message);
    return NextResponse.json({ ok: true, message: data || row });
}
