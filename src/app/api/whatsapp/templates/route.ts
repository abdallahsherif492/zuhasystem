import { NextResponse } from "next/server";
import { accountOf, admin, graph, memberOf } from "@/lib/whatsapp/server";
import { TEMPLATES, templatePayload } from "@/lib/whatsapp/templates";
import { toMetaBody, type SavedTemplate } from "@/lib/whatsapp/template-fields";
import { whatsappSettingsOf } from "@/lib/whatsapp/settings";
import { GRAPH, WHATSAPP_APP_ID } from "@/lib/whatsapp/config";

/**
 * Settings → WhatsApp → القوالب. GET: every template at Meta, with its text,
 * buttons and review status. POST (owners and admins):
 *  - no action: submit the system's templates Meta does not have yet;
 *  - "create" / "edit": a template written in the editor ({الاسم}…), sent
 *    to Meta for review, and remembered here (which detail each {{n}} is);
 *  - "delete": removed at Meta, and from every case that used it.
 */

async function statuses(wabaId: string, token: string) {
    const res = await graph(`${wabaId}/message_templates?fields=id,name,status,category,language,rejected_reason,components&limit=200`, token);
    return (res.body?.data || []) as { id: string; name: string; status: string; category: string; language: string; rejected_reason?: string; components?: unknown[] }[];
}

/** A product photo uploaded to Meta as the sample a photo-header template needs. */
async function sampleImageHandle(businessId: string, token: string): Promise<string | null> {
    const { data } = await admin.from("products").select("image_url").eq("business_id", businessId).not("image_url", "is", null).limit(1);
    const url = data?.[0]?.image_url as string | undefined;
    if (!url) return null;
    const img = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!img?.ok) return null;
    const bytes = Buffer.from(await img.arrayBuffer());
    const type = img.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const start = await fetch(`${GRAPH}/${WHATSAPP_APP_ID}/uploads?file_name=sample&file_length=${bytes.length}&file_type=${encodeURIComponent(type)}&access_token=${token}`, { method: "POST" })
        .then(r => r.json()).catch(() => null) as { id?: string } | null;
    if (!start?.id) return null;
    const done = await fetch(`${GRAPH}/${start.id}`, { method: "POST", headers: { Authorization: `OAuth ${token}`, file_offset: "0" }, body: bytes })
        .then(r => r.json()).catch(() => null) as { h?: string } | null;
    return done?.h || null;
}

export async function GET(request: Request) {
    const businessId = new URL(request.url).searchParams.get("business_id") || "";
    const who = await memberOf(businessId);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    const account = await accountOf(businessId);
    if (!account) return NextResponse.json({ connected: false, templates: [] });
    return NextResponse.json({ connected: true, templates: await statuses(account.waba_id, account.token) });
}

interface Draft { name?: string; id?: string; category?: string; image?: boolean; text?: string; buttons?: string[] }

/** Keeps (or drops) a template's details in the settings, merged into what is saved now. */
async function remember(businessId: string, name: string, saved: SavedTemplate | null) {
    const { data: b } = await admin.from("businesses").select("theme_config").eq("id", businessId).single();
    const theme = (b?.theme_config || {}) as Record<string, unknown>;
    const wa = whatsappSettingsOf(theme as never);
    const templates = { ...wa.templates };
    const cases = { ...wa.case_templates };
    if (saved) templates[name] = saved;
    else {
        delete templates[name];
        for (const k of Object.keys(cases) as (keyof typeof cases)[]) if (cases[k] === name) delete cases[k];
    }
    const whatsapp = { ...((theme.whatsapp as object) || {}), templates, case_templates: cases };
    await admin.from("businesses").update({ theme_config: { ...theme, whatsapp } }).eq("id", businessId);
    return { templates, case_templates: cases };
}

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { business_id?: string; action?: "create" | "edit" | "delete"; template?: Draft } | null;
    const businessId = body?.business_id || "";
    const who = await memberOf(businessId);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    const { data: role } = await admin.from("business_users").select("role").eq("business_id", businessId).ilike("user_email", who.email).maybeSingle();
    if (!["owner", "admin", "super admin"].includes(String(role?.role || "").toLowerCase().replace(/_/g, " "))) {
        return NextResponse.json({ error: "الأونر أو الأدمن بس." }, { status: 403 });
    }
    const account = await accountOf(businessId);
    if (!account) return NextResponse.json({ error: "مفيش رقم واتساب متربط." }, { status: 400 });

    const metaError = (r: { body?: { error?: { error_user_msg?: string; message?: string } } }) =>
        r.body?.error?.error_user_msg || r.body?.error?.message || "Meta رفضت الطلب.";

    if (body?.action === "delete") {
        const name = String(body.template?.name || "");
        if (!/^[a-z0-9_]+$/.test(name)) return NextResponse.json({ error: "اسم القالب غلط." }, { status: 400 });
        const q = `name=${name}${body.template?.id ? `&hsm_id=${body.template.id}` : ""}`;
        const res = await graph(`${account.waba_id}/message_templates?${q}`, account.token, { method: "DELETE" });
        if (!res.ok) return NextResponse.json({ error: metaError(res) }, { status: 502 });
        const kept = await remember(businessId, name, null);
        return NextResponse.json({ ok: true, saved: kept.templates, case_templates: kept.case_templates, templates: await statuses(account.waba_id, account.token) });
    }

    if (body?.action === "create" || body?.action === "edit") {
        const d = body.template || {};
        const name = String(d.name || "").trim();
        if (!/^[a-z0-9_]{3,100}$/.test(name)) return NextResponse.json({ error: "الاسم بالإنجليزي الصغير والأرقام و _ بس، زي order_offer_1." }, { status: 400 });
        const text = String(d.text || "").trim();
        const meta = toMetaBody(text);
        if (meta.unknown.length) return NextResponse.json({ error: `مش عارف يعني إيه: ${meta.unknown.map(u => `{${u}}`).join("، ")}. استخدم الزراير اللي تحت النص.` }, { status: 400 });
        if (!text || text.length > 1024) return NextResponse.json({ error: "النص لازم يبقى من 1 لـ 1024 حرف." }, { status: 400 });
        if (/^\{\{\d+\}\}|\{\{\d+\}\}$/.test(meta.body.trim())) return NextResponse.json({ error: "Meta مش بتقبل النص يبدأ أو يخلص بمعلومة من الأوردر. ضيف كلمة قبلها أو بعدها." }, { status: 400 });
        const buttons = (d.buttons || []).map(b => String(b).trim()).filter(Boolean).slice(0, 3);
        if (buttons.some(b => b.length > 25)) return NextResponse.json({ error: "كلام الزرار لازم يبقى 25 حرف أو أقل." }, { status: 400 });
        const category = d.category === "MARKETING" ? "MARKETING" : "UTILITY";
        const components: Record<string, unknown>[] = [];
        if (d.image) {
            const handle = await sampleImageHandle(businessId, account.token);
            if (!handle) return NextResponse.json({ error: "مفيش صورة منتج نبعتها لـ Meta كمثال." }, { status: 400 });
            components.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [handle] } });
        }
        components.push({ type: "BODY", text: meta.body, ...(meta.example.length ? { example: { body_text: [meta.example] } } : {}) });
        if (buttons.length) components.push({ type: "BUTTONS", buttons: buttons.map(t => ({ type: "QUICK_REPLY", text: t })) });

        const res = body.action === "create"
            ? await graph(`${account.waba_id}/message_templates`, account.token, { method: "POST", body: JSON.stringify({ name, language: "ar", category, components }) })
            : await graph(`${d.id}`, account.token, { method: "POST", body: JSON.stringify({ components }) });
        if (!res.ok) return NextResponse.json({ error: metaError(res) }, { status: 502 });
        const kept = await remember(businessId, name, { body: meta.body, params: meta.params, buttons, image: !!d.image, category });
        return NextResponse.json({ ok: true, saved: kept.templates, case_templates: kept.case_templates, templates: await statuses(account.waba_id, account.token) });
    }

    const have = new Set((await statuses(account.waba_id, account.token)).map(t => t.name));
    const results: { name: string; ok: boolean; error?: string }[] = [];
    for (const t of TEMPLATES) {
        if (have.has(t.name)) continue;
        let handle: string | undefined;
        if (t.imageHeader) {
            handle = (await sampleImageHandle(businessId, account.token)) || undefined;
            if (!handle) { results.push({ name: t.name, ok: false, error: "مفيش صورة منتج لسه (بتتجاب مع أول أوردر من المتجر)" }); continue; }
        }
        const res = await graph(`${account.waba_id}/message_templates`, account.token, { method: "POST", body: JSON.stringify(templatePayload(t, handle)) });
        results.push({ name: t.name, ok: res.ok, error: res.ok ? undefined : res.body?.error?.error_user_msg || res.body?.error?.message });
    }
    return NextResponse.json({ results, templates: await statuses(account.waba_id, account.token) });
}
