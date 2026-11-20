import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { GRAPH, WHATSAPP_APP_ID } from "@/lib/whatsapp/config";

/**
 * Settings → WhatsApp. GET: which number this business has connected.
 * POST: finish connecting one, either with the permanent token kept in
 * Netlify (mode "token": a number moved to the API, set up in WhatsApp
 * Manager) or with the one-time code Embedded Signup hands back (a number
 * kept on the WhatsApp Business app too, which Meta allows only to verified
 * partners). The account and number are found from the token, the app is
 * subscribed to the account's messages, and the number is stored. Owners
 * and admins only.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY || "", { auth: { persistSession: false } });

const MANAGERS = new Set(["owner", "admin", "super admin"]);

async function managerOf(businessId: string): Promise<{ email: string } | { error: string; status: number }> {
    const store = await cookies();
    const sb = createServerClient(supabaseUrl, anonKey, { cookies: { getAll: () => store.getAll(), setAll() { /* read-only */ } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user?.email) return { error: "سجّل دخول الأول.", status: 401 };
    const { data } = await admin.from("business_users").select("role").eq("business_id", businessId).ilike("user_email", user.email).maybeSingle();
    const role = String(data?.role || "").toLowerCase().replace(/_/g, " ");
    if (!MANAGERS.has(role)) return { error: "الأونر أو الأدمن بس اللي يقدر يربط الواتساب.", status: 403 };
    return { email: user.email.toLowerCase() };
}

async function graph(path: string, token: string, init?: RequestInit) {
    const res = await fetch(`${GRAPH}/${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
        signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, body };
}

export async function GET(request: Request) {
    const businessId = new URL(request.url).searchParams.get("business_id") || "";
    const who = await managerOf(businessId);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    const { data, error } = await admin.from("whatsapp_accounts")
        .select("waba_id, phone_number_id, display_phone, verified_name, mode, token_expires_at, connected_by, connected_at, setup_result")
        .eq("business_id", businessId).order("connected_at", { ascending: false });
    if (error) return NextResponse.json({ error: /whatsapp_accounts/.test(error.message) ? "migration" : error.message }, { status: 500 });
    return NextResponse.json({ accounts: data || [], secretSet: !!process.env.WHATSAPP_APP_SECRET, tokenSet: !!process.env.WHATSAPP_TOKEN });
}

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { business_id?: string; code?: string; waba_id?: string; phone_number_id?: string; mode?: string } | null;
    if (!body?.business_id || (!body.code && body.mode !== "token")) return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    const who = await managerOf(body.business_id);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) return NextResponse.json({ error: "WHATSAPP_APP_SECRET مش متحط في Netlify." }, { status: 500 });

    // 1. The token: the permanent one in Netlify (a number on the API only,
    // set up in WhatsApp Manager), or one from Embedded Signup's code.
    let token: string;
    let expiresIn: number | undefined;
    const fromEnv = body.mode === "token";
    if (fromEnv) {
        if (!process.env.WHATSAPP_TOKEN) return NextResponse.json({ error: "WHATSAPP_TOKEN مش متحط في Netlify." }, { status: 500 });
        token = process.env.WHATSAPP_TOKEN;
    } else {
        const tokenRes = await fetch(`${GRAPH}/oauth/access_token?client_id=${WHATSAPP_APP_ID}&client_secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(body.code!)}`,
            { signal: AbortSignal.timeout(15000) });
        const tokenBody = await tokenRes.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: { message?: string } };
        if (!tokenBody.access_token) {
            return NextResponse.json({ error: `Meta رفضت الكود: ${tokenBody.error?.message || tokenRes.status}` }, { status: 502 });
        }
        token = tokenBody.access_token;
        expiresIn = tokenBody.expires_in;
    }

    // 2. Which account and number, if the page did not hear them.
    let wabaId = body.waba_id || "";
    let phoneId = body.phone_number_id || "";
    if (!wabaId || !phoneId) {
        const dbg = await fetch(`${GRAPH}/debug_token?input_token=${token}&access_token=${WHATSAPP_APP_ID}|${encodeURIComponent(secret)}`).then(r => r.json()).catch(() => null) as
            { data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } } | null;
        wabaId = wabaId || dbg?.data?.granular_scopes?.find(s => s.scope === "whatsapp_business_management")?.target_ids?.[0] || "";
        if (wabaId && !phoneId) {
            const nums = await graph(`${wabaId}/phone_numbers`, token);
            phoneId = nums.body?.data?.[0]?.id || "";
        }
    }
    if (!wabaId || !phoneId) return NextResponse.json({ error: "Meta ما رجعتش رقم الواتساب. جرّب تاني." }, { status: 502 });

    // 3. Messages to the app; the Business app's contacts and chats synced.
    const setup: Record<string, unknown> = {};
    setup.subscribe = (await graph(`${wabaId}/subscribed_apps`, token, { method: "POST" })).body;
    setup.number = (await graph(`${phoneId}?fields=display_phone_number,verified_name,platform_type,status`, token)).body;
    if (!fromEnv) {
        setup.contacts = (await graph(`${phoneId}/smb_app_data`, token, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", sync_type: "smb_app_state_sync" }) })).body;
        setup.history = (await graph(`${phoneId}/smb_app_data`, token, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", sync_type: "history" }) })).body;
    }
    const num = setup.number as { display_phone_number?: string; verified_name?: string };

    const { error } = await admin.from("whatsapp_accounts").upsert({
        business_id: body.business_id,
        waba_id: wabaId,
        phone_number_id: phoneId,
        display_phone: num?.display_phone_number || null,
        verified_name: num?.verified_name || null,
        // "env": the token stays in Netlify (WHATSAPP_TOKEN) and is read from there.
        access_token: fromEnv ? "env" : token,
        token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
        mode: fromEnv ? "api" : "coexistence",
        setup_result: setup,
        connected_by: who.email,
        connected_at: new Date().toISOString(),
    }, { onConflict: "phone_number_id" });
    if (error) return NextResponse.json({ error: /whatsapp_accounts/.test(error.message) ? "شغّل ملف 20261123_whatsapp_accounts.sql في Supabase الأول." : error.message }, { status: 500 });

    return NextResponse.json({ ok: true, display_phone: num?.display_phone_number, verified_name: num?.verified_name, setup });
}
