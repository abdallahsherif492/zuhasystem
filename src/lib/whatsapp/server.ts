import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { GRAPH } from "@/lib/whatsapp/config";

/**
 * Server-side WhatsApp: who is asking, which number and token a business
 * sends with, and the calls to Meta. The token never leaves the server.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";
export const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY || "", { auth: { persistSession: false } });

/** The signed-in member of the business, or why not. */
export async function memberOf(businessId: string): Promise<{ email: string } | { error: string; status: number }> {
    const store = await cookies();
    const sb = createServerClient(supabaseUrl, anonKey, { cookies: { getAll: () => store.getAll(), setAll() { /* read-only */ } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user?.email) return { error: "سجّل دخول الأول.", status: 401 };
    const { data } = await admin.from("business_users").select("id").eq("business_id", businessId).ilike("user_email", user.email).maybeSingle();
    if (!data) return { error: "مش عضو في البيزنس ده.", status: 403 };
    return { email: user.email.toLowerCase() };
}

export interface WaAccount { business_id: string; phone_number_id: string; waba_id: string; token: string }

/** The business's connected number and the token to send with. */
export async function accountOf(businessId: string): Promise<WaAccount | null> {
    const { data } = await admin.from("whatsapp_accounts").select("business_id, phone_number_id, waba_id, access_token")
        .eq("business_id", businessId).order("connected_at", { ascending: false }).limit(1).maybeSingle();
    if (!data) return null;
    const token = data.access_token === "env" ? process.env.WHATSAPP_TOKEN || "" : data.access_token;
    return token ? { business_id: data.business_id, phone_number_id: data.phone_number_id, waba_id: data.waba_id, token } : null;
}

/** 01xxxxxxxxx -> 201xxxxxxxxx, the form WhatsApp addresses a number by. */
export function waNumber(phone: string): string {
    const d = phone.replace(/\D/g, "");
    if (/^01\d{9}$/.test(d)) return `2${d}`;
    if (/^1\d{9}$/.test(d)) return `20${d}`;
    return d;
}

export async function graph(path: string, token: string, init?: RequestInit) {
    const res = await fetch(`${GRAPH}/${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
        signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, body };
}

/** Meta's error, in a sentence a moderator can act on. */
export function sendError(body: { error?: { code?: number; message?: string; error_data?: { details?: string } } }): string {
    const e = body?.error;
    if (!e) return "الرسالة ما اتبعتتش.";
    if (e.code === 131047) return "عدّت 24 ساعة من آخر رسالة من العميل. ابعت قالب بدل الرسالة العادية.";
    if (e.code === 132001) return "القالب لسه مش متوافق عليه من Meta، أو اسمه غلط.";
    if (e.code === 131026) return "الرقم ده مش عليه واتساب.";
    if (e.code === 131056) return "بعتّ رسايل كتير للرقم ده في وقت قصير. استنى شوية.";
    if (e.code === 190) return "توكن الواتساب مش شغال. راجع WHATSAPP_TOKEN في Netlify.";
    return `الرسالة ما اتبعتتش: ${e.error_data?.details || e.message || "خطأ من Meta"}`;
}
