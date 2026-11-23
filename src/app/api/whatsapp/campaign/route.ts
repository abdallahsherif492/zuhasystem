import { NextResponse } from "next/server";
import { accountOf, admin, graph, memberOf, sendError, uploadImage, uploadImageBytes, waNumber } from "@/lib/whatsapp/server";
import { ORDER_SELECT, orderImages, orderValues, type OrderRow } from "@/lib/whatsapp/order-messages";
import { productCollage } from "@/lib/whatsapp/collage";
import type { FieldKey } from "@/lib/whatsapp/template-fields";

/**
 * Settings → WhatsApp → «ابعت لأوردرات»: one approved template to the orders
 * picked there, a few per call (the page sends the rest in turns). Each
 * {{n}} of the template is filled from the order (a detail: name, products,
 * amount...) or with the same text for everyone. A template with a picture
 * above it gets the order's products (one picture, or side by side).
 * An order whose number got this template in the last 24 hours is skipped.
 * Owners and admins only: it costs money and writes to customers.
 * Body: { business_id, order_ids (≤5), template, params: ({ field } | { text })[] }.
 */

export const maxDuration = 60;

type Param = { field?: FieldKey; text?: string };
interface MetaTemplate { name: string; status: string; language: string; category: string; components?: { type: string; format?: string; text?: string; buttons?: { type: string; text: string }[] }[] }

async function isManager(businessId: string, email: string) {
    const { data } = await admin.from("business_users").select("role").eq("business_id", businessId).ilike("user_email", email).maybeSingle();
    return ["owner", "admin", "super admin"].includes(String(data?.role || "").toLowerCase().replace(/_/g, " "));
}

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { business_id?: string; order_ids?: unknown; template?: string; params?: Param[] } | null;
    const businessId = body?.business_id;
    const ids = Array.isArray(body?.order_ids) ? (body!.order_ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 5) : [];
    if (!businessId || !ids.length || !body?.template) return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    const who = await memberOf(businessId);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    if (!(await isManager(businessId, who.email))) return NextResponse.json({ error: "الأونر أو الأدمن بس." }, { status: 403 });
    const account = await accountOf(businessId);
    if (!account) return NextResponse.json({ error: "مفيش رقم واتساب متوصل." }, { status: 400 });

    // The template as Meta has it: its text, its picture, its buttons, its language.
    const list = await graph(`${account.waba_id}/message_templates?name=${encodeURIComponent(body.template)}&fields=name,status,language,category,components&limit=20`, account.token);
    const tpl = ((list.body?.data || []) as MetaTemplate[]).find(t => t.name === body.template && t.status === "APPROVED");
    if (!tpl) return NextResponse.json({ error: "القالب ده مش متوافق عليه من Meta." }, { status: 400 });
    const text = tpl.components?.find(c => c.type === "BODY")?.text || "";
    const count = (text.match(/\{\{\d+\}\}/g) || []).length;
    const params = (Array.isArray(body.params) ? body.params : []).slice(0, count);
    if (params.length < count || params.some(p => !p.field && !String(p.text || "").trim())) return NextResponse.json({ error: "كل خانة في القالب محتاجة قيمة." }, { status: 400 });
    const withImage = tpl.components?.some(c => c.type === "HEADER" && c.format === "IMAGE");
    const buttons = (tpl.components?.find(c => c.type === "BUTTONS")?.buttons || []).map(b => b.text);
    const withItems = params.some(p => p.field === "items");

    const [{ data: orders }, { data: biz }] = await Promise.all([
        admin.from("orders").select(ORDER_SELECT).eq("business_id", businessId).in("id", ids),
        admin.from("businesses").select("name").eq("id", businessId).maybeSingle(),
    ]);
    const results: { id: string; outcome: "sent" | "recent" | "no_phone" | "no_image" | "failed"; error?: string }[] = [];
    for (const id of ids) {
        const o = (orders || []).find(x => x.id === id) as unknown as OrderRow | undefined;
        if (!o?.customer_info?.phone || String(o.customer_info.phone).replace(/\D/g, "").length < 10) { results.push({ id, outcome: "no_phone" }); continue; }
        const to = waNumber(o.customer_info.phone);
        const local = /^20(1\d{9})$/.test(to) ? `0${to.slice(2)}` : to;
        const { count: recent } = await admin.from("whatsapp_messages").select("id", { count: "exact", head: true })
            .eq("business_id", businessId).eq("customer_phone", local).eq("direction", "out").eq("template_name", tpl.name)
            .gte("sent_at", new Date(Date.now() - 86_400_000).toISOString());
        if (recent) { results.push({ id, outcome: "recent" }); continue; }

        const values = await orderValues(o, biz?.name || "Zuha Store", withItems);
        const filled = params.map(p => (p.field ? values[p.field] : String(p.text)).replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim() || "-");
        const components: Record<string, unknown>[] = [];
        let header: string | null = null;
        if (withImage) {
            const images = orderImages(o);
            if (!images.length) { results.push({ id, outcome: "no_image" }); continue; }
            const bytes = images.length > 1 ? await productCollage(images) : null;
            const mediaId = (bytes && await uploadImageBytes(account, bytes)) || await uploadImage(account, images[0]);
            if (!mediaId) { results.push({ id, outcome: "no_image" }); continue; }
            header = images[0];
            components.push({ type: "header", parameters: [{ type: "image", image: { id: mediaId } }] });
        }
        if (filled.length) components.push({ type: "body", parameters: filled.map(t => ({ type: "text", text: t })) });
        const res = await graph(`${account.phone_number_id}/messages`, account.token, {
            method: "POST",
            body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: tpl.name, language: { code: tpl.language }, components } }),
        });
        if (!res.ok) {
            results.push({ id, outcome: "failed", error: sendError(res.body) });
            continue;
        }
        await admin.from("whatsapp_messages").insert({
            business_id: businessId, phone_number_id: account.phone_number_id, wa_message_id: res.body?.messages?.[0]?.id || null,
            direction: "out", customer_phone: local, customer_wa_id: res.body?.contacts?.[0]?.wa_id || to, type: "template",
            template_name: tpl.name, body: text.replace(/\{\{(\d+)\}\}/g, (_, n) => filled[Number(n) - 1] ?? ""), status: "pending",
            payload: { params: filled, buttons, header_image: header, event: "campaign" }, sent_by: who.email, order_id: o.id,
            sent_at: new Date().toISOString(),
        });
        results.push({ id, outcome: "sent" });
    }
    return NextResponse.json({ results });
}
