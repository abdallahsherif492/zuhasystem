import { NextResponse } from "next/server";
import { accountOf, admin, graph, memberOf } from "@/lib/whatsapp/server";
import { TEMPLATES, templatePayload } from "@/lib/whatsapp/templates";
import { GRAPH, WHATSAPP_APP_ID } from "@/lib/whatsapp/config";

/**
 * Settings → WhatsApp. GET: each template's review status at Meta.
 * POST: submit the system's templates Meta does not have yet (owners and admins).
 */

async function statuses(wabaId: string, token: string) {
    const res = await graph(`${wabaId}/message_templates?fields=name,status,category,language,rejected_reason&limit=200`, token);
    return (res.body?.data || []) as { name: string; status: string; category: string; language: string; rejected_reason?: string }[];
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

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { business_id?: string } | null;
    const businessId = body?.business_id || "";
    const who = await memberOf(businessId);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    const { data: role } = await admin.from("business_users").select("role").eq("business_id", businessId).ilike("user_email", who.email).maybeSingle();
    if (!["owner", "admin", "super admin"].includes(String(role?.role || "").toLowerCase().replace(/_/g, " "))) {
        return NextResponse.json({ error: "الأونر أو الأدمن بس." }, { status: 403 });
    }
    const account = await accountOf(businessId);
    if (!account) return NextResponse.json({ error: "مفيش رقم واتساب متربط." }, { status: 400 });

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
