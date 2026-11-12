"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Loader2, RefreshCw, Settings } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { cn, formatCurrency } from "@/lib/utils";
import { cairoDate } from "@/lib/cairo-day";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LiveShifts, MetricRow } from "@/components/hr/daily-targets";
import {
    DAILY_TARGETS_MIGRATION, METRIC_LABEL, settingsOf,
    type MetricKey, type MetricResult, type TargetSettings,
} from "@/lib/hr/daily-targets";

interface Row {
    id: string;
    user_email: string;
    work_date: string;
    shift_start: string;
    shift_end: string;
    status: "evaluated" | "absent" | "leave";
    share: number;
    metrics: MetricResult[];
    missed: MetricKey[];
    deduction: number;
    adjustment_id: string | null;
    payroll_note: string | null;
}

const KEYS: MetricKey[] = ["confirm", "messages", "followups", "rate"];

function periodRange(p: string): [string, string] {
    const today = cairoDate();
    if (p === "7") return [cairoDate(new Date(Date.now() - 6 * 86_400_000)), today];
    if (p === "last") {
        const [y, m] = today.split("-").map(Number);
        const first = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
        const last = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
        return [first, last];
    }
    return [today.slice(0, 8) + "01", today];
}

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("ar-EG", { weekday: "short", day: "numeric", month: "short" });
const who = (email: string) => email.split("@")[0];

export default function DailyTargetsPage() {
    const { activeBusiness } = useBusiness();
    const businessId = activeBusiness?.id;
    const [period, setPeriod] = useState("month");
    const [settings, setSettings] = useState<TargetSettings | null>(null);
    const [rows, setRows] = useState<Row[] | null>(null);
    const [missing, setMissing] = useState(false);
    const [open, setOpen] = useState<string | null>(null);
    const [scoring, setScoring] = useState(false);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        const [from, to] = periodRange(period);
        Promise.all([
            supabase.from("moderator_target_settings").select("*").eq("business_id", businessId).maybeSingle(),
            supabase.from("moderator_scorecards").select("*").eq("business_id", businessId)
                .gte("work_date", from).lte("work_date", to).order("work_date", { ascending: false }).order("user_email"),
        ]).then(([s, r]) => {
            if (gone) return;
            setMissing(!!s.error || !!r.error);
            setSettings(settingsOf(s.data));
            setRows((r.data || []) as Row[]);
        });
        return () => { gone = true; };
    }, [businessId, period, reload]);

    const scoreNow = useCallback(async () => {
        setScoring(true);
        try {
            const res = await fetch("/api/cron/moderator-targets");
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.success) throw new Error(body.error || res.statusText);
            const r = businessId ? body.results?.[businessId] : null;
            toast.success(r ? `اتعمل ${r.scored} كشف، واتسجل ${r.booked} خصم.` : "مفيش شيفتات خلصت ومحتاجة كشف.");
            setReload(n => n + 1);
        } catch (e) {
            toast.error(`ماتحسبش: ${(e as Error).message}`);
        } finally {
            setScoring(false);
        }
    }, [businessId]);

    const people = useMemo(() => {
        const map = new Map<string, { days: number; clean: number; absent: number; misses: Record<MetricKey, number>; deducted: number }>();
        for (const r of rows || []) {
            const p = map.get(r.user_email) || { days: 0, clean: 0, absent: 0, misses: { confirm: 0, messages: 0, followups: 0, rate: 0 }, deducted: 0 };
            if (r.status === "absent") p.absent++;
            if (r.status === "evaluated") {
                p.days++;
                if (!r.missed.length) p.clean++;
                r.missed.forEach(k => { p.misses[k]++; });
            }
            if (r.adjustment_id) p.deducted += Number(r.deduction) || 0;
            map.set(r.user_email, p);
        }
        return [...map.entries()].sort((a, b) => b[1].deducted - a[1].deducted);
    }, [rows]);

    if (!businessId || !settings || rows === null) {
        return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    }

    return (
        <div className="mx-auto max-w-6xl space-y-8" dir="rtl">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">تارجت المودريتورز اليومي</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        كل شيفت مطلوب منه اللي البيزنس محتاجه، والكشف بيتعمل بعد ما الشيفت يخلص بنص ساعة. الخصم بيتسجل في المرتبات، وتقدر تلغيه من هناك.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Select value={period} onValueChange={setPeriod}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="7">آخر 7 أيام</SelectItem>
                            <SelectItem value="month">الشهر ده</SelectItem>
                            <SelectItem value="last">الشهر اللي فات</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" onClick={scoreNow} disabled={scoring || !settings.enabled} className="gap-1.5">
                        {scoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}اعمل كشف الشيفتات اللي خلصت
                    </Button>
                    <Button asChild variant="ghost" size="icon" aria-label="إعدادات التارجت">
                        <Link href="/settings?tab=targets"><Settings className="h-4 w-4" /></Link>
                    </Button>
                </div>
            </div>

            {missing && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    شغّل الملف <code className="font-mono">{DAILY_TARGETS_MIGRATION}</code> في Supabase الأول.
                </div>
            )}
            {!missing && !settings.enabled && (
                <div className="rounded-lg border p-4 text-sm">
                    الكشف اليومي مقفول. شغّله واختار المودريتورز وحدد قيمة الخصم من <Link href="/settings?tab=targets" className="text-primary underline-offset-4 hover:underline">الإعدادات</Link>.
                </div>
            )}

            {settings.enabled && <LiveShifts businessId={businessId} title="الشيفتات الشغالة دلوقتي" />}

            {/* The period, per moderator */}
            {people.length > 0 && (
                <section className="space-y-3">
                    <h2 className="text-lg font-semibold">في الفترة دي</h2>
                    <div className="overflow-x-auto rounded-xl border">
                        <table className="w-full min-w-[640px] text-sm">
                            <thead className="bg-muted/50 text-xs text-muted-foreground">
                                <tr>
                                    <th className="p-3 text-start font-medium">المودريتور</th>
                                    <th className="p-3 text-start font-medium">شيفتات حققت كل حاجة</th>
                                    {KEYS.map(k => <th key={k} className="p-3 text-start font-medium">فاته: {METRIC_LABEL[k]}</th>)}
                                    <th className="p-3 text-start font-medium">غياب من غير نشاط</th>
                                    <th className="p-3 text-start font-medium">اتخصم</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {people.map(([email, p]) => (
                                    <tr key={email}>
                                        <td className="p-3 font-medium">{who(email)}</td>
                                        <td className="p-3 tabular-nums">{p.clean} من {p.days}</td>
                                        {KEYS.map(k => <td key={k} className={cn("p-3 tabular-nums", p.misses[k] > 0 && "text-rose-700 dark:text-rose-400")}>{p.misses[k]}</td>)}
                                        <td className="p-3 tabular-nums">{p.absent}</td>
                                        <td className="p-3 font-semibold tabular-nums">{formatCurrency(p.deducted)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* Every shift */}
            <section className="space-y-3">
                <h2 className="text-lg font-semibold">كشف كل شيفت</h2>
                {rows.length === 0 ? (
                    <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
                        مفيش كشوف في الفترة دي لسه. أول كشف بيتعمل بعد أول شيفت يخلص من ساعة ما الكشف اليومي يشتغل.
                    </p>
                ) : (
                    <div className="overflow-x-auto rounded-xl border">
                        <table className="w-full min-w-[720px] text-sm">
                            <thead className="bg-muted/50 text-xs text-muted-foreground">
                                <tr>
                                    <th className="p-3 text-start font-medium">اليوم</th>
                                    <th className="p-3 text-start font-medium">المودريتور</th>
                                    {KEYS.map(k => <th key={k} className="p-3 text-start font-medium">{METRIC_LABEL[k]}</th>)}
                                    <th className="p-3 text-start font-medium">الخصم</th>
                                    <th className="w-8" />
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {rows.map(r => {
                                    const isOpen = open === r.id;
                                    const byKey = Object.fromEntries((r.metrics || []).map(m => [m.key, m])) as Record<MetricKey, MetricResult>;
                                    const waived = r.deduction > 0 && !r.adjustment_id && !r.payroll_note;
                                    return (
                                        <Fragment key={r.id}>
                                            <tr className={cn("cursor-pointer hover:bg-muted/30", isOpen && "bg-muted/30")} onClick={() => setOpen(isOpen ? null : r.id)}>
                                                <td className="whitespace-nowrap p-3">{dayLabel(r.work_date)}</td>
                                                <td className="p-3 font-medium">{who(r.user_email)}</td>
                                                {r.status !== "evaluated" ? (
                                                    <td colSpan={4} className="p-3 text-muted-foreground">
                                                        {r.status === "leave" ? "إجازة معتمدة" : "يوم شغل من غير أي نشاط ولا حضور. اتأكد إذا كان غياب."}
                                                    </td>
                                                ) : KEYS.map(k => {
                                                    const m = byKey[k];
                                                    if (!m) return <td key={k} className="p-3">—</td>;
                                                    return (
                                                        <td key={k} className={cn("p-3 tabular-nums", m.target === null ? "text-muted-foreground" : m.met ? "text-emerald-700 dark:text-emerald-400" : "font-semibold text-rose-700 dark:text-rose-400")}>
                                                            {k === "rate" ? `${m.done}%` : m.done}
                                                            {m.target !== null && <span className="font-normal text-muted-foreground"> / {k === "rate" ? `${m.target}%` : m.target}</span>}
                                                        </td>
                                                    );
                                                })}
                                                <td className="p-3">
                                                    {r.deduction > 0 ? (
                                                        <span className={cn("tabular-nums", waived && "text-muted-foreground line-through")}>{formatCurrency(r.deduction)}</span>
                                                    ) : <span className="text-muted-foreground">—</span>}
                                                    {waived && <span className="block text-[11px] text-muted-foreground">اتلغى من المرتبات</span>}
                                                    {r.payroll_note && <span className="block text-[11px] text-amber-700 dark:text-amber-400">{r.payroll_note}</span>}
                                                </td>
                                                <td className="p-3"><ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} /></td>
                                            </tr>
                                            {isOpen && r.status === "evaluated" && (
                                                <tr className="bg-muted/20">
                                                    <td colSpan={7} className="p-4">
                                                        <ul className="grid gap-4 md:grid-cols-2">
                                                            {KEYS.map(k => byKey[k] && <MetricRow key={k} m={byKey[k]} settings={settings} />)}
                                                        </ul>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}
