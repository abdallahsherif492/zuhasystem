import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeEgyptianPhone, scoreLead, type LeadSignals } from "@/lib/leads/bot-score";

/**
 * Receives what a visitor typed into the store's order form, from
 * public/leads.js on the EasyOrders storefront. Public by design (the store is
 * another site), so it trusts nothing: the business's lead key is checked in
 * the database, the request is scored for bot behaviour here, and a device
 * that floods is throttled by capture_missed_lead.
 * See supabase/migrations/20261025_missed_leads.sql.
 */

const FALLBACK_URL = "https://telkkknuygjejmqcvyev.supabase.co";
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";
const envOr = (v: string | undefined, fallback: string) => (v && v !== "undefined" && v !== "[SENSITIVE]" ? v : fallback);

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
};

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);

export function OPTIONS() {
    return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
    const ok = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: CORS });
    let body: Record<string, unknown>;
    try {
        // sendBeacon posts text/plain, which needs no preflight.
        const raw = await request.text();
        if (raw.length > 20_000) return ok({ ok: false }, 413);
        body = JSON.parse(raw);
    } catch {
        return ok({ ok: false }, 400);
    }

    const businessId = clip(body.b, 64);
    const key = clip(body.k, 128);
    const phone = normalizeEgyptianPhone(clip(body.phone, 40) || "");
    if (!businessId || !key || phone.length < 8) return ok({ ok: false }, 400);

    const userAgent = request.headers.get("user-agent");
    const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || null;
    const signals = (body.s && typeof body.s === "object" ? body.s : null) as LeadSignals | null;
    const name = clip(body.name, 120);
    const { score, reasons } = scoreLead({ phone, name, userAgent, signals });

    const supabase = createClient(
        envOr(process.env.NEXT_PUBLIC_SUPABASE_URL, FALLBACK_URL),
        envOr(process.env.SUPABASE_SERVICE_ROLE_KEY, envOr(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, FALLBACK_KEY)),
        { auth: { persistSession: false } },
    );
    const { data, error } = await supabase.rpc("capture_missed_lead", {
        p_business_id: businessId,
        p_key: key,
        p_phone: phone,
        p_name: name,
        p_phone2: clip(body.phone2, 40) ? normalizeEgyptianPhone(clip(body.phone2, 40)!) : null,
        p_address: clip(body.address, 400),
        p_governorate: clip(body.governorate, 80),
        p_product: clip(body.product, 200),
        p_page_url: clip(body.url, 500),
        p_referrer: clip(body.ref, 500),
        p_utm: body.utm && typeof body.utm === "object" ? body.utm : null,
        p_session: clip(body.sid, 64),
        p_ip: ip,
        p_user_agent: clip(userAgent, 400),
        p_signals: signals,
        p_score: score,
        p_reasons: reasons,
        p_submitted: body.submitted === true,
    });
    if (error) {
        console.error("[leads] capture failed:", error.message);
        return ok({ ok: false }, 200);
    }
    return ok({ ok: !!(data as { ok?: boolean })?.ok });
}
