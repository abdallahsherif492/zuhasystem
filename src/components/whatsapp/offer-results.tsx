"use client";

import { useEffect, useState } from "react";
import { Loader2, TrendingUp } from "lucide-react";

/**
 * Settings → WhatsApp → «نتايج رسالة اتسلم بالعرض»: whether the delivered
 * message with Zuha's offer pays for itself (/api/whatsapp/offer-stats).
 */

interface Stats {
    code: string; window_days: number; reached: number; messages: number; failed: number; cost_usd: number;
    reordered: number; orders: number; revenue: number; delivered_revenue: number;
    with_code: { orders: number; revenue: number; discount: number };
    code_anyone: { orders: number; revenue: number };
    since: string | null;
}

/** Roughly, to compare with sales in pounds. */
const EGP_PER_USD = 50;
const egp = (n: number) => `${Math.round(n).toLocaleString("en")} جنيه`;

export function OfferResults({ businessId }: { businessId: string }) {
    const [s, setS] = useState<Stats | null>(null);
    const [err, setErr] = useState<string | null>(null);
    useEffect(() => {
        let gone = false;
        (async () => {
            const res = await fetch(`/api/whatsapp/offer-stats?business_id=${businessId}&code=zuha10`);
            const body = await res.json().catch(() => null);
            if (gone) return;
            if (!res.ok || !body) { setErr(body?.error || "ماقدرتش أجيب النتايج."); return; }
            setS(body);
        })();
        return () => { gone = true; };
    }, [businessId]);

    const cost = s ? s.cost_usd * EGP_PER_USD : 0;
    const tiles = s ? [
        { label: "وصلتهم الرسالة", value: `${s.reached} عميل`, note: `تكلفة تقريبية ${s.cost_usd}$ ≈ ${egp(cost)}` },
        { label: `طلبوا تاني خلال ${s.window_days} يوم`, value: `${s.reordered} عميل`, note: s.reached ? `${Math.round((s.reordered / s.reached) * 100)}% · ${s.orders} أوردر · ${egp(s.revenue)}` : "" },
        { label: `بكود ${s.code}`, value: `${s.with_code.orders} أوردر`, note: `${egp(s.with_code.revenue)} · خصم ${egp(s.with_code.discount)}` },
        { label: "العائد مقابل التكلفة", value: cost ? `${(s.revenue / cost).toFixed(1)}×` : "—", note: `اتسلّم منهم ${egp(s.delivered_revenue)}` },
    ] : [];

    return (
        <section className="space-y-3 rounded-2xl border bg-card p-5">
            <div>
                <h2 className="flex items-center gap-2 text-lg font-bold"><TrendingUp className="h-5 w-5 text-[#25d366]" />نتايج رسالة «اتسلم» بالعرض</h2>
                <p className="text-sm text-muted-foreground">العملاء اللي وصلتهم رسالة «طلبك وصل» بصورة العرض: مين رجع طلب تاني، ومين استخدم كود الخصم، وده جاب قد إيه مقابل تمن الرسايل (Meta بتحسبها تسويق).</p>
            </div>
            {err ? <p className="text-sm text-red-700">{err}</p> : !s ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : s.reached === 0 ? (
                <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">لسه محدش وصلته الرسالة. أول ما أوردرات تتسلم وتتبعت، النتايج هتظهر هنا.</p>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                        {tiles.map(t => (
                            <div key={t.label} className="rounded-xl bg-muted/40 p-3">
                                <p className="text-xs text-muted-foreground">{t.label}</p>
                                <p className="mt-1 text-xl font-bold tabular-nums">{t.value}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">{t.note}</p>
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        من {s.since ? new Date(s.since).toLocaleDateString("ar-EG-u-nu-latn") : ""} · {s.messages} رسالة{s.failed ? ` (و${s.failed} ما وصلتش ومااتحسبتش)` : ""}.
                        الكود {s.code} اتستخدم في {s.code_anyone.orders} أوردر في الفترة دي من أي حد. التكلفة تقريبية، والرقم الحقيقي في فاتورة Meta.
                    </p>
                </>
            )}
        </section>
    );
}
