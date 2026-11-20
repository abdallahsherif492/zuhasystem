import { NextResponse } from "next/server";
import { admin, memberOf } from "@/lib/whatsapp/server";
import { LEARNING, offerStats } from "@/lib/whatsapp/upsell";

/**
 * How each product did in the offers of the last 90 days: shown, added, the
 * rate, and whether the system is still trying it. What the offer learns
 * from (lib/whatsapp/upsell.ts). GET ?business_id=.
 */
export async function GET(request: Request) {
    const businessId = new URL(request.url).searchParams.get("business_id");
    if (!businessId) return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    const who = await memberOf(businessId);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });

    const stats = await offerStats(businessId);
    const ids = [...stats.keys()];
    const { data: variants } = ids.length
        ? await admin.from("variants").select("id, stock_qty, track_inventory, products(name, image_url)").in("id", ids)
        : { data: [] };
    const rows = (variants || []).map(v => {
        const s = stats.get(v.id)!;
        const p = v.products as unknown as { name: string; image_url: string | null } | null;
        return {
            variant_id: v.id, name: p?.name || "منتج", image: p?.image_url || null,
            stock: v.track_inventory ? Number(v.stock_qty) : null,
            shown: s.shown, added: s.added, rate: s.shown ? s.added / s.shown : 0, learning: s.shown < LEARNING,
        };
    }).sort((a, b) => b.added - a.added || b.rate - a.rate || b.shown - a.shown);
    const shown = rows.reduce((a, r) => a + r.shown, 0), added = rows.reduce((a, r) => a + r.added, 0);
    return NextResponse.json({ rows, shown, added });
}
