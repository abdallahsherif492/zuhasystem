"use client";

import { useEffect, useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { WhatsAppSettings } from "@/lib/whatsapp/settings";

/** Settings → WhatsApp → «عرض بعد التأكيد» (lib/whatsapp/upsell.ts), with how it did in the last 30 days. */
export function UpsellSettings({ businessId, value, onChange, onSave, saving, manager }: {
    businessId: string; value: WhatsAppSettings["upsell"]; onChange: (v: WhatsAppSettings["upsell"]) => void;
    onSave: () => void; saving: boolean; manager: boolean;
}) {
    const [stats, setStats] = useState<{ offered: number; added: number } | null>(null);
    useEffect(() => {
        let gone = false;
        (async () => {
            const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
            const [o, a] = await Promise.all([
                supabase.from("whatsapp_messages").select("order_id").eq("business_id", businessId).eq("payload->>kind", "upsell").gte("sent_at", since).limit(5000),
                supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("direction", "in").eq("body", "ضيفه لطلبي").gte("sent_at", since),
            ]);
            if (!gone) setStats({ offered: new Set((o.data || []).map(r => r.order_id)).size, added: a.count || 0 });
        })();
        return () => { gone = true; };
    }, [businessId]);

    return (
        <section className="space-y-4 rounded-2xl border bg-card p-5">
            <label className="flex items-start justify-between gap-4">
                <span>
                    <span className="flex items-center gap-2 text-lg font-bold"><Gift className="h-5 w-5 text-[#25d366]" />عرض بعد التأكيد</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                        أول ما الأوردر يتأكد، العميل بتوصله صور منتجات بتتشري كتير مع اللي طلبه، بخصم، وزرار «ضيفه لطلبي» بيضيف المنتج لنفس الأوردر من غير شحن زيادة.
                        كل منتج في رسالة بصورته وزرار لوحده، والعميل يقدر يضيف أكتر من واحد. بيتبعت بس لو العميل كاتبلنا النهارده (ببلاش)، ومرة واحدة للأوردر، ومفيش منتج بيتعرض من غير صورة.
                    </span>
                </span>
                <Switch checked={value.enabled} disabled={!manager} onCheckedChange={v => onChange({ ...value, enabled: v })} />
            </label>
            <div className="flex flex-wrap items-end gap-4">
                <label className="space-y-1.5">
                    <span className="text-sm font-semibold">الخصم</span>
                    <span className="flex items-center gap-2">
                        <Input type="number" min={0} max={50} className="w-24" value={value.discount_percent} disabled={!manager}
                            onChange={e => onChange({ ...value, discount_percent: Math.min(50, Math.max(0, Number(e.target.value) || 0)) })} />%
                    </span>
                </label>
                <label className="space-y-1.5">
                    <span className="text-sm font-semibold">عدد المنتجات في العرض</span>
                    <select value={value.count} disabled={!manager} onChange={e => onChange({ ...value, count: Number(e.target.value) })}
                        className="flex h-9 w-24 rounded-md border bg-background px-2 text-sm">
                        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                </label>
                {stats && (
                    <p className="text-sm text-muted-foreground">
                        آخر 30 يوم: اتعرض على <b className="text-foreground">{stats.offered}</b> عميل، و<b className="text-foreground">{stats.added}</b> ضافوه
                        {stats.offered > 0 && ` (${Math.round((stats.added / stats.offered) * 100)}%)`}
                    </p>
                )}
            </div>
            {manager && <Button onClick={onSave} disabled={saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}احفظ</Button>}
            <BoughtTogether businessId={businessId} />
        </section>
    );
}

interface Pair { count: number; a: Side; b: Side }
interface Side { id: string; name: string; image: string | null; orders: number }

/** «المنتجات اللي بتتباع مع بعض»: what the offer is built on, on demand. */
function BoughtTogether({ businessId }: { businessId: string }) {
    const [data, setData] = useState<{ orders: number; multi: number; pairs: Pair[] } | null>(null);
    const [loading, setLoading] = useState(false);
    const load = async () => {
        setLoading(true);
        const res = await fetch(`/api/whatsapp/bought-together?business_id=${businessId}`);
        const body = await res.json().catch(() => null);
        setLoading(false);
        if (res.ok && body) setData(body);
    };
    const thumb = (s: Side) => s.image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={s.image} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
        : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted">📦</span>;
    return (
        <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">المنتجات اللي بتتباع مع بعض</p>
                {!data && <Button variant="outline" size="sm" onClick={load} disabled={loading}>{loading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}اعرضها</Button>}
            </div>
            {data && (
                <>
                    <p className="text-sm text-muted-foreground">من {data.orders.toLocaleString("en")} أوردر في آخر 6 شهور، {data.multi.toLocaleString("en")} فيهم أكتر من منتج.</p>
                    {data.pairs.length === 0 ? <p className="text-sm text-muted-foreground">مفيش منتجات اتباعت مع بعض أكتر من مرة لسه.</p> : (
                        <ul className="divide-y">
                            {data.pairs.map(p => (
                                <li key={`${p.a.id}${p.b.id}`} className="flex items-center gap-3 py-2.5">
                                    {thumb(p.a)}
                                    <span className="text-muted-foreground">+</span>
                                    {thumb(p.b)}
                                    <span className="min-w-0 flex-1 text-sm [contain:inline-size]">
                                        <span className="block truncate font-medium">{p.a.name}</span>
                                        <span className="block truncate font-medium">{p.b.name}</span>
                                    </span>
                                    <span className="shrink-0 text-end text-sm">
                                        <b className="block tabular-nums">{p.count} مرة</b>
                                        <span className="text-xs text-muted-foreground">{Math.round((p.count / Math.max(1, Math.min(p.a.orders, p.b.orders))) * 100)}%</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </div>
    );
}
