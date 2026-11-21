import { NextResponse } from "next/server";
import { admin, memberOf } from "@/lib/whatsapp/server";

/**
 * How the «delivered» message with Zuha's offer does (order_delivered_photo:
 * the picture with the code zuha10). For the customers it reached: who
 * ordered again within 30 days, who used the code, what they bought, and
 * what the messages cost (Meta bills it as Marketing — about $0.074 each in
 * Egypt; approximate, the invoice is the truth).
 * GET ?business_id=&code=zuha10
 */

const TEMPLATE = "order_delivered_photo";
const MARKETING_USD = 0.074;
const WINDOW_DAYS = 30;
const last10 = (p: unknown) => String(p ?? "").replace(/\D/g, "").slice(-10);
const BAD = /cancel/i;
const DONE = /delivered|collected/i;

export async function GET(request: Request) {
    const url = new URL(request.url);
    const businessId = url.searchParams.get("business_id");
    const code = (url.searchParams.get("code") || "zuha10").toLowerCase();
    if (!businessId) return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    const who = await memberOf(businessId);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });

    // Who it reached (a failed one cost nothing and reached no one).
    const sent: { customer_phone: string; sent_at: string; status: string }[] = [];
    for (let from = 0; from < 20_000; from += 1000) {
        const { data } = await admin.from("whatsapp_messages").select("customer_phone, sent_at, status")
            .eq("business_id", businessId).eq("direction", "out").eq("template_name", TEMPLATE)
            .order("sent_at").range(from, from + 999);
        sent.push(...(data || []));
        if (!data || data.length < 1000) break;
    }
    const reached = sent.filter(m => m.status !== "failed");
    const firstSent = new Map<string, number>();
    for (const m of reached) {
        const k = last10(m.customer_phone), t = Date.parse(m.sent_at);
        if (!firstSent.has(k) || t < firstSent.get(k)!) firstSent.set(k, t);
    }
    const since = reached.length ? new Date(Math.min(...firstSent.values())).toISOString() : new Date().toISOString();

    // Orders since the first one went out.
    const orders: { id: string; created_at: string; status: string; total_amount: number; discount: number | null; tags: string[] | null; phone: string | null }[] = [];
    for (let from = 0; from < 50_000 && reached.length; from += 1000) {
        const { data } = await admin.from("orders").select("id, created_at, status, total_amount, discount, tags, phone:customer_info->>phone")
            .eq("business_id", businessId).gte("created_at", since).order("created_at").range(from, from + 999);
        orders.push(...((data || []) as typeof orders));
        if (!data || data.length < 1000) break;
    }

    const withCode = (o: { tags: string[] | null }) => (o.tags || []).some(t => t.toLowerCase() === `coupon:${code}`);
    const again = orders.filter(o => {
        const t = firstSent.get(last10(o.phone));
        return t !== undefined && Date.parse(o.created_at) > t && Date.parse(o.created_at) - t <= WINDOW_DAYS * 86_400_000 && !BAD.test(o.status);
    });
    const buyers = new Set(again.map(o => last10(o.phone)));
    const codeOrders = again.filter(withCode);
    const anyCode = orders.filter(o => withCode(o) && !BAD.test(o.status));
    const sum = (xs: typeof orders) => Math.round(xs.reduce((a, o) => a + (Number(o.total_amount) || 0), 0));

    return NextResponse.json({
        code, window_days: WINDOW_DAYS,
        reached: firstSent.size, messages: reached.length, failed: sent.length - reached.length,
        cost_usd: Math.round(reached.length * MARKETING_USD * 100) / 100,
        reordered: buyers.size, orders: again.length, revenue: sum(again), delivered_revenue: sum(again.filter(o => DONE.test(o.status))),
        with_code: { orders: codeOrders.length, revenue: sum(codeOrders), discount: Math.round(codeOrders.reduce((a, o) => a + (Number(o.discount) || 0), 0)) },
        code_anyone: { orders: anyCode.length, revenue: sum(anyCode) },
        since: reached.length ? since : null,
    });
}
