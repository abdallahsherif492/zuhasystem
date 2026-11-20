import { NextResponse } from "next/server";
import { admin, memberOf } from "@/lib/whatsapp/server";

/**
 * Which products are bought together (orders of the last 180 days, cancelled
 * ones left out): the pairs that appear in the same order most, with how
 * often. What the offer after a confirmation is built on.
 * GET ?business_id=. Read when the settings page asks, not on a schedule.
 */

export const maxDuration = 60;

export async function GET(request: Request) {
    const businessId = new URL(request.url).searchParams.get("business_id");
    if (!businessId) return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    const who = await memberOf(businessId);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });

    const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const byOrder = new Map<string, Set<string>>();
    for (let from = 0; from < 40_000; from += 1000) {
        const { data, error } = await admin.from("order_items")
            .select("order_id, variants(product_id), orders!inner(created_at, status)")
            .eq("business_id", businessId).gte("orders.created_at", since).not("orders.status", "ilike", "cancel%")
            .order("id").range(from, from + 999);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        for (const r of data || []) {
            const pid = (r.variants as unknown as { product_id: string } | null)?.product_id;
            if (!pid) continue;
            if (!byOrder.has(r.order_id)) byOrder.set(r.order_id, new Set());
            byOrder.get(r.order_id)!.add(pid);
        }
        if (!data || data.length < 1000) break;
    }

    const orders = new Map<string, number>();
    const pairs = new Map<string, number>();
    for (const set of byOrder.values()) {
        const ids = [...set].sort();
        for (const id of ids) orders.set(id, (orders.get(id) || 0) + 1);
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
            const k = `${ids[i]}|${ids[j]}`;
            pairs.set(k, (pairs.get(k) || 0) + 1);
        }
    }
    const top = [...pairs.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 40);
    const ids = [...new Set(top.flatMap(([k]) => k.split("|")))];
    const { data: products } = ids.length
        ? await admin.from("products").select("id, name, image_url").in("id", ids)
        : { data: [] as { id: string; name: string; image_url: string | null }[] };
    const info = new Map((products || []).map(p => [p.id, p]));
    return NextResponse.json({
        orders: byOrder.size,
        multi: [...byOrder.values()].filter(s => s.size > 1).length,
        pairs: top.map(([k, n]) => {
            const [a, b] = k.split("|");
            return {
                count: n,
                a: { id: a, name: info.get(a)?.name || "منتج", image: info.get(a)?.image_url || null, orders: orders.get(a) || 0 },
                b: { id: b, name: info.get(b)?.name || "منتج", image: info.get(b)?.image_url || null, orders: orders.get(b) || 0 },
            };
        }),
    });
}
