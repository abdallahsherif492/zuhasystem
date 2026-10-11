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

type Basis = "delivered" | "confirmed";
interface Row { email: string; role: string; enabled: boolean; rate: string; min_units: string; saved: boolean }

const MIGRATION = "supabase/migrations/20261008_moderator_commission.sql";
const EXAMPLE_TOTAL = 500;

/**
 * Commission settings: who earns it, at what rate of the order total, from
 * how many pieces an order counts, and whether it is paid on delivered orders
 * or on every confirmed one. See 20261008_moderator_commission.sql.
 */
export function CommissionSettings() {
    const { activeBusiness, currentUser } = useBusiness();
    const [rows, setRows] = useState<Row[]>([]);
    const [basis, setBasis] = useState<Basis>("delivered");
    const [defRate, setDefRate] = useState("2");
    const [defMin, setDefMin] = useState("1");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [missing, setMissing] = useState(false);

    useEffect(() => {
        if (!activeBusiness) return;
        let cancelled = false;
        (async () => {
            const [members, settings] = await Promise.all([
                supabase.from("business_users").select("user_email, role").eq("business_id", activeBusiness.id),
                supabase.from("commission_settings").select("user_email, enabled, rate, min_units, basis").eq("business_id", activeBusiness.id),
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
                setBasis(def.basis as Basis);
                setDefRate(String(Number(def.rate)));
                setDefMin(String(def.min_units));
            }
            setRows((members.data || [])
                .map(m => {
                    const s = byEmail.get(m.user_email.toLowerCase());
                    return {
                        email: m.user_email,
                        role: m.role,
                        enabled: !!s?.enabled,
                        rate: s ? String(Number(s.rate)) : def ? String(Number(def.rate)) : "2",
                        min_units: s ? String(s.min_units) : def ? String(def.min_units) : "1",
                        saved: !!s,
                    };
                })
                .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.email.localeCompare(b.email)));
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [activeBusiness]);

    const update = (email: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.email === email ? { ...r, ...patch } : r)));
    const applyDefaults = () => setRows(rs => rs.map(r => (r.enabled ? { ...r, rate: defRate, min_units: defMin } : r)));
    const enabledCount = rows.filter(r => r.enabled).length;

    const invalid = useMemo(() => rows.some(r => r.enabled && (!(Number(r.rate) >= 0 && Number(r.rate) <= 100) || r.rate === "" || !(Number(r.min_units) >= 0) || r.min_units === "")), [rows]);

    const save = async () => {
        if (!activeBusiness) return;
        if (invalid) { toast.error("النسبة لازم تكون من 0 لـ 100، والحد الأدنى للقطع رقم صحيح."); return; }
        setSaving(true);
        const now = new Date().toISOString();
        const by = currentUser?.email ?? null;
        const payload = [
            { business_id: activeBusiness.id, user_email: "*", enabled: true, rate: Number(defRate) || 0, min_units: Math.max(0, Math.round(Number(defMin) || 0)), basis, updated_by: by, updated_at: now },
            // Everyone switched on, and anyone switched off who had a row before.
            ...rows.filter(r => r.enabled || r.saved).map(r => ({
                business_id: activeBusiness.id, user_email: r.email.toLowerCase(), enabled: r.enabled,
                rate: Number(r.rate) || 0, min_units: Math.max(0, Math.round(Number(r.min_units) || 0)), basis, updated_by: by, updated_at: now,
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
                    نسبة من إجمالي الأوردر لكل مودريتور على الأوردرات اللي أكّدها، بشرط إن الأوردر فيه عدد قطع أقل حاجة. بتظهر في الصفحة الرئيسية: كل مودريتور بيشوف الكوميشن بتاعه بس، والإدارة بتشوف الكل.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                {/* Which orders */}
                <div className="space-y-2">
                    <Label>الكوميشن بيتحسب على</Label>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {([
                            { key: "delivered", title: "الأوردرات اللي اتسلمت بس", sub: "المرتجع والملغي مالهمش كوميشن. اللي لسه في الشحن بيظهر \"مستني التسليم\"." },
                            { key: "confirmed", title: "كل أوردر اتأكد", sub: "من أول ما المودريتور يأكده، حتى لو رجع بعد كده. الملغي بس اللي مالوش." },
                        ] as const).map(o => (
                            <button key={o.key} type="button" onClick={() => setBasis(o.key)}
                                    className={cn("rounded-lg border p-3 text-start transition-colors", basis === o.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/60")}>
                                <div className="text-sm font-medium">{o.title}</div>
                                <div className="mt-0.5 text-xs text-muted-foreground">{o.sub}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Defaults */}
                <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
                    <div className="space-y-1">
                        <Label className="text-xs">النسبة الافتراضية %</Label>
                        <Input type="number" inputMode="decimal" min={0} max={100} step="0.5" value={defRate} onChange={e => setDefRate(e.target.value)} className="h-9 w-24" />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">أقل عدد قطع في الأوردر</Label>
                        <Input type="number" inputMode="numeric" min={0} step="1" value={defMin} onChange={e => setDefMin(e.target.value)} className="h-9 w-24" />
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
                                <th>المودريتور</th><th>كوميشن</th><th>النسبة %</th><th>أقل عدد قطع</th><th>مثال</th>
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
                                        <td><Input type="number" inputMode="numeric" min={0} step="1" value={r.min_units} disabled={!r.enabled}
                                                   onChange={e => update(r.email, { min_units: e.target.value })} className="h-8 w-20" /></td>
                                        <td className="whitespace-nowrap text-xs">
                                            {r.enabled ? <>أوردر <span dir="ltr">{formatCurrency(EXAMPLE_TOTAL)}</span> فيه {Math.max(1, Number(r.min_units) || 1)} قطع ← <b dir="ltr">{formatCurrency(EXAMPLE_TOTAL * rate / 100)}</b></> : "—"}
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
