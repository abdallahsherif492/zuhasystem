"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, BadgePercent, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { formatCurrency, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface Row { email: string; role: string; enabled: boolean; rate: string; min_total: string; saved: boolean }

const MIGRATION = "supabase/migrations/20261008_moderator_commission.sql";
const EXAMPLE_TOTAL = 1600;
const EXAMPLE_SHIPPING = 70;

/**
 * Commission settings: who earns it, at what rate, and from what order total.
 * Commission is paid only on orders delivered to the customer, on the total
 * without shipping; an order counts when its total with shipping reaches the
 * moderator's minimum. See 20261008_moderator_commission.sql.
 */
export function CommissionSettings() {
    const { activeBusiness, currentUser } = useBusiness();
    const [rows, setRows] = useState<Row[]>([]);
    const [defRate, setDefRate] = useState("2");
    const [defMin, setDefMin] = useState("1500");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [missing, setMissing] = useState(false);

    useEffect(() => {
        if (!activeBusiness) return;
        let cancelled = false;
        (async () => {
            const [members, settings] = await Promise.all([
                supabase.from("business_users").select("user_email, role").eq("business_id", activeBusiness.id),
                supabase.from("commission_settings").select("user_email, enabled, rate, min_total").eq("business_id", activeBusiness.id),
            ]);
            if (cancelled) return;
            if (settings.error) {
                setMissing(/does not exist|could not find|PGRST205|42P01/i.test(`${settings.error.code} ${settings.error.message}`));
                setLoading(false);
                return;
            }
            const byEmail = new Map((settings.data || []).map(s => [s.user_email.toLowerCase(), s]));
            const def = byEmail.get("*");
            if (def) {
                setDefRate(String(Number(def.rate)));
                setDefMin(String(Number(def.min_total)));
            }
            setRows((members.data || [])
                .map(m => {
                    const s = byEmail.get(m.user_email.toLowerCase());
                    return {
                        email: m.user_email,
                        role: m.role,
                        enabled: !!s?.enabled,
                        rate: s ? String(Number(s.rate)) : def ? String(Number(def.rate)) : "2",
                        min_total: s ? String(Number(s.min_total)) : def ? String(Number(def.min_total)) : "1500",
                        saved: !!s,
                    };
                })
                .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.email.localeCompare(b.email)));
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [activeBusiness]);

    const update = (email: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.email === email ? { ...r, ...patch } : r)));
    const applyDefaults = () => setRows(rs => rs.map(r => (r.enabled ? { ...r, rate: defRate, min_total: defMin } : r)));
    const enabledCount = rows.filter(r => r.enabled).length;

    const invalid = useMemo(() => rows.some(r => r.enabled && (!(Number(r.rate) >= 0 && Number(r.rate) <= 100) || r.rate === "" || !(Number(r.min_total) >= 0) || r.min_total === "")), [rows]);

    const save = async () => {
        if (!activeBusiness) return;
        if (invalid) { toast.error("النسبة لازم تكون من 0 لـ 100، والحد الأدنى رقم."); return; }
        setSaving(true);
        const now = new Date().toISOString();
        const by = currentUser?.email ?? null;
        const payload = [
            { business_id: activeBusiness.id, user_email: "*", enabled: true, rate: Number(defRate) || 0, min_total: Math.max(0, Number(defMin) || 0), updated_by: by, updated_at: now },
            // Everyone switched on, and anyone switched off who had a row before.
            ...rows.filter(r => r.enabled || r.saved).map(r => ({
                business_id: activeBusiness.id, user_email: r.email.toLowerCase(), enabled: r.enabled,
                rate: Number(r.rate) || 0, min_total: Math.max(0, Number(r.min_total) || 0), updated_by: by, updated_at: now,
            })),
        ];
        const { error } = await supabase.from("commission_settings").upsert(payload, { onConflict: "business_id,user_email" });
        setSaving(false);
        if (error) { console.error(error); toast.error("ماتحفظش، جرّب تاني."); return; }
        setRows(rs => rs.map(r => (r.enabled ? { ...r, saved: true } : r)));
        toast.success("اتحفظت إعدادات الكوميشن");
    };

    if (loading) return <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
    if (missing) {
        return (
            <Card className="border-amber-300">
                <CardContent className="flex gap-3 p-5 text-sm" dir="rtl">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                    <div>
                        <div className="font-medium">محتاج تشغّل migration الأول</div>
                        <p className="mt-1 text-muted-foreground">شغّل الملف ده في Supabase → SQL Editor: <code className="rounded bg-muted px-1" dir="ltr">{MIGRATION}</code></p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card dir="rtl">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><BadgePercent className="h-5 w-5" />كوميشن المودريتورز</CardTitle>
                <CardDescription>
                    نسبة لكل مودريتور على الأوردرات اللي أكّدها. بتظهر في الصفحة الرئيسية: كل مودريتور بيشوف الكوميشن بتاعه بس، والإدارة بتشوف الكل.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                {/* The rules, fixed */}
                <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
                    <div className="font-medium">الأوردر بياخد كوميشن لما:</div>
                    <div>✓ يكون <b>اتسلم للعميل</b> (Delivered / Collected) — الملغي والمرتجع واللي لسه في الشحن مالهمش.</div>
                    <div>✓ إجمالي الأوردر <b>بالشحن</b> يكون الحد الأدنى أو أكتر.</div>
                    <div>والكوميشن بيتحسب على إجمالي الأوردر <b>من غير الشحن</b>.</div>
                </div>

                {/* Defaults */}
                <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
                    <div className="space-y-1">
                        <Label className="text-xs">النسبة الافتراضية %</Label>
                        <Input type="number" inputMode="decimal" min={0} max={100} step="0.5" value={defRate} onChange={e => setDefRate(e.target.value)} className="h-9 w-24" />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">أقل إجمالي للأوردر بالشحن (ج)</Label>
                        <Input type="number" inputMode="decimal" min={0} step="50" value={defMin} onChange={e => setDefMin(e.target.value)} className="h-9 w-28" />
                    </div>
                    <Button variant="outline" size="sm" className="h-9" onClick={applyDefaults} disabled={!enabledCount}>
                        طبّقها على المفعّلين ({enabledCount})
                    </Button>
                </div>

                {/* Per moderator */}
                <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/40 text-xs text-muted-foreground">
                            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                                <th>المودريتور</th><th>كوميشن</th><th>النسبة %</th><th>أقل إجمالي بالشحن</th><th>مثال</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {rows.map(r => {
                                const rate = Number(r.rate) || 0;
                                return (
                                    <tr key={r.email} className={cn("[&>td]:px-3 [&>td]:py-2", !r.enabled && "text-muted-foreground")}>
                                        <td>
                                            <div className="font-medium">{r.email.split("@")[0]}</div>
                                            <div className="text-xs text-muted-foreground" dir="ltr">{r.email}</div>
                                        </td>
                                        <td><Switch checked={r.enabled} onCheckedChange={v => update(r.email, { enabled: v })} /></td>
                                        <td><Input type="number" inputMode="decimal" min={0} max={100} step="0.5" value={r.rate} disabled={!r.enabled}
                                                   onChange={e => update(r.email, { rate: e.target.value })} className="h-8 w-20" /></td>
                                        <td><Input type="number" inputMode="decimal" min={0} step="50" value={r.min_total} disabled={!r.enabled}
                                                   onChange={e => update(r.email, { min_total: e.target.value })} className="h-8 w-24" /></td>
                                        <td className="whitespace-nowrap text-xs">
                                            {!r.enabled ? "—" : EXAMPLE_TOTAL >= (Number(r.min_total) || 0)
                                                ? <>أوردر <span dir="ltr">{formatCurrency(EXAMPLE_TOTAL)}</span> منهم شحن <span dir="ltr">{formatCurrency(EXAMPLE_SHIPPING)}</span> ← <b dir="ltr">{formatCurrency((EXAMPLE_TOTAL - EXAMPLE_SHIPPING) * rate / 100)}</b></>
                                                : <>أوردر <span dir="ltr">{formatCurrency(EXAMPLE_TOTAL)}</span> ← مالوش (أقل من الحد)</>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="flex justify-end">
                    <Button onClick={save} disabled={saving || invalid}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}حفظ</Button>
                </div>
            </CardContent>
        </Card>
    );
}
