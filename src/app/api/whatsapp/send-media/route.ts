import { NextResponse } from "next/server";
import { accountOf, admin, memberOf, sendError, uploadImage, waNumber } from "@/lib/whatsapp/server";
import { GRAPH } from "@/lib/whatsapp/config";

/**
 * A photo or file from the chat: uploaded to Meta, then sent from the
 * business number with an optional caption. multipart: business_id, phone,
 * file (or image_url: a product's photo, fetched and uploaded here),
 * caption?, reply_to?. Inside the 24-hour window only, like any free message.
 */
export async function POST(request: Request) {
    const form = await request.formData().catch(() => null);
    const businessId = String(form?.get("business_id") || "");
    const phone = String(form?.get("phone") || "");
    const file = form?.get("file");
    const imageUrl = String(form?.get("image_url") || "");
    const caption = String(form?.get("caption") || "").trim();
    const replyTo = String(form?.get("reply_to") || "") || null;
    if (!businessId || !phone || (!(file instanceof File) && !/^https:\/\//.test(imageUrl))) return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    if (file instanceof File && file.size > 16 * 1024 * 1024) return NextResponse.json({ error: "الملف أكبر من 16 ميجا." }, { status: 400 });
    const [who, account] = await Promise.all([memberOf(businessId), accountOf(businessId)]);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    if (!account) return NextResponse.json({ error: "مفيش رقم واتساب متربط." }, { status: 400 });

    let uploaded: { id?: string; error?: { message?: string } };
    let mime: string;
    let kind: "image" | "video" | "document";
    if (file instanceof File) {
        const up = new FormData();
        up.append("messaging_product", "whatsapp");
        up.append("type", file.type || "application/octet-stream");
        up.append("file", file, file.name);
        uploaded = await fetch(`${GRAPH}/${account.phone_number_id}/media`, { method: "POST", headers: { Authorization: `Bearer ${account.token}` }, body: up })
            .then(r => r.json()).catch(() => ({})) as { id?: string; error?: { message?: string } };
        mime = file.type;
        kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "document";
    } else {
        // A product's photo: uploaded with its real type (the store's links say "image/jpg").
        uploaded = { id: (await uploadImage(account, imageUrl)) || undefined };
        mime = "image/jpeg";
        kind = "image";
    }
    if (!uploaded.id) return NextResponse.json({ error: `الصورة ما اترفعتش${uploaded.error?.message ? `: ${uploaded.error.message}` : ""}` }, { status: 502 });
    const to = waNumber(phone);
    const media: Record<string, unknown> = { id: uploaded.id, ...(caption ? { caption } : {}), ...(kind === "document" && file instanceof File ? { filename: file.name } : {}) };
    const res = await fetch(`${GRAPH}/${account.phone_number_id}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to, type: kind, [kind]: media, ...(replyTo ? { context: { message_id: replyTo } } : {}) }),
    });
    const sent = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: sendError(sent) }, { status: 502 });

    const local = /^20(1\d{9})$/.test(to) ? `0${to.slice(2)}` : to;
    const { data } = await admin.from("whatsapp_messages").insert({
        business_id: businessId, phone_number_id: account.phone_number_id, wa_message_id: sent?.messages?.[0]?.id || null,
        direction: "out", customer_phone: local, customer_wa_id: to, type: kind, body: caption || (kind === "document" && file instanceof File ? file.name : null),
        media_id: uploaded.id, media_mime: mime || null, context_id: replyTo, status: "pending", sent_by: who.email, sent_at: new Date().toISOString(),
    }).select("*").single();
    return NextResponse.json({ ok: true, message: data });
}
