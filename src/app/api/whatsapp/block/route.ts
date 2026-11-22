import { NextResponse } from "next/server";
import { accountOf, admin, graph, waNumber } from "@/lib/whatsapp/server";
import { ownerOf } from "@/lib/whatsapp/owner";

/**
 * Block / unblock a customer on the company number (Meta's Block Users API),
 * owners only. Meta allows blocking only someone who wrote in the last 24
 * hours; a blocked customer cannot message the number and is not told.
 * GET ?business_id=: who is blocked (local numbers).
 * POST { business_id, phone, action: "block" | "unblock" }.
 */

const local = (waId: string) => (/^20(1\d{9})$/.test(waId) ? `0${waId.slice(2)}` : waId);

export async function GET(request: Request) {
    const businessId = new URL(request.url).searchParams.get("business_id") || "";
    const who = await ownerOf(businessId);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    const account = await accountOf(businessId);
    if (!account) return NextResponse.json({ blocked: [] });
    const out: string[] = [];
    let path = `${account.phone_number_id}/block_users?limit=500`;
    for (let page = 0; page < 20 && path; page++) {
        const res = await graph(path, account.token);
        if (!res.ok) return NextResponse.json({ error: res.body?.error?.message || "Meta ما ردتش." }, { status: 502 });
        for (const b of res.body?.data?.[0]?.block_users || res.body?.data || []) {
            const id = b.wa_id || b.input || b.user;
            if (id) out.push(local(String(id)));
        }
        const after = res.body?.paging?.cursors?.after;
        path = res.body?.paging?.next && after ? `${account.phone_number_id}/block_users?limit=500&after=${after}` : "";
    }
    return NextResponse.json({ blocked: out });
}

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { business_id?: string; phone?: string; action?: "block" | "unblock" } | null;
    if (!body?.business_id || !body.phone || !["block", "unblock"].includes(String(body.action))) return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    const who = await ownerOf(body.business_id);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    const account = await accountOf(body.business_id);
    if (!account) return NextResponse.json({ error: "مفيش رقم واتساب متربط." }, { status: 400 });

    const res = await graph(`${account.phone_number_id}/block_users`, account.token, {
        method: body.action === "block" ? "POST" : "DELETE",
        body: JSON.stringify({ messaging_product: "whatsapp", block_users: [{ user: waNumber(body.phone) }] }),
    });
    const failed = res.body?.block_users?.failed_users || res.body?.error?.error_data?.details;
    if (!res.ok || (Array.isArray(failed) && failed.length)) {
        const text = JSON.stringify(res.body || {});
        const msg = /131047|24 hours/.test(text)
            ? "Meta بتسمح بالبلوك بس للعميل اللي كتبلنا في آخر 24 ساعة."
            : res.body?.error?.error_user_msg || res.body?.error?.message || "Meta رفضت الطلب.";
        return NextResponse.json({ error: msg }, { status: 502 });
    }
    await admin.from("actions_log").insert({
        business_id: body.business_id, user_email: who.email, action_type: "edit", entity_type: "whatsapp_chat", entity_id: body.phone,
        entity_name: `WhatsApp ${body.phone}`, changes: [{ field: "Blocked", old_value: body.action === "block" ? "no" : "yes", new_value: body.action === "block" ? "yes" : "no" }],
        metadata: { source: "whatsapp" },
    });
    return NextResponse.json({ ok: true });
}
