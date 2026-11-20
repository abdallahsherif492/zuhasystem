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
                supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("payload->>kind", "upsell").gte("sent_at", since),
                supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("direction", "in").eq("body", "ضيفه لطلبي").gte("sent_at", since),
            ]);
            if (!gone) setStats({ offered: o.count || 0, added: a.count || 0 });
        })();
        return () => { gone = true; };
    }, [businessId]);

    return (
        <section className="space-y-4 rounded-2xl border bg-card p-5">
            <label className="flex items-start justify-between gap-4">
                <span>
                    <span className="flex items-center gap-2 text-lg font-bold"><Gift className="h-5 w-5 text-[#25d366]" />عرض بعد التأكيد</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                        أول ما الأوردر يتأكد، العميل بتوصله صورة منتج بيتشري كتير مع اللي طلبه، بخصم، وزرار «ضيفه لطلبي» بيضيفه لنفس الأوردر من غير شحن زيادة.
                        بيتبعت بس لو العميل كاتبلنا النهارده (ببلاش)، ومرة واحدة للأوردر، ومفيش منتج بيتعرض من غير صورة.
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
                {stats && (
                    <p className="text-sm text-muted-foreground">
                        آخر 30 يوم: اتعرض على <b className="text-foreground">{stats.offered}</b> عميل، و<b className="text-foreground">{stats.added}</b> ضافوه
                        {stats.offered > 0 && ` (${Math.round((stats.added / stats.offered) * 100)}%)`}
                    </p>
                )}
            </div>
            {manager && <Button onClick={onSave} disabled={saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}احفظ</Button>}
        </section>
    );
}
