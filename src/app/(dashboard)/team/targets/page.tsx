"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Settings } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { cn, formatCurrency } from "@/lib/utils";
import { cairoDate, nextDay } from "@/lib/cairo-day";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MetricRow } from "@/components/hr/daily-targets";
import {
    ATTENDANCE_LABEL, DAILY_TARGETS_MIGRATION, dataSince, loadTargetData, scoreDay, settingsOf,
    type Attendance, type MetricKey, type MetricResult, type Scorecard, type TargetSettings,
} from "@/lib/hr/daily-targets";

/**
 * Team → Daily targets: every moderator's report for one day the manager
 * picks. A day already scored shows its scorecard as recorded (with what was
 * booked in payroll); any other day — today, or one before the targets
 * started — is worked out now from the same rules, and says so.
 */

interface Stored {
    user_email: string;
    work_date: string;
    shift_start: string;
    shift_end: string;
    status: Scorecard["status"];
    share: number;
    metrics: MetricResult[];
    missed: MetricKey[];
    deduction: number;
    attendance: Attendance | null;
    adjustment_id: string | null;
    payroll_note: string | null;
}

type Report = (Scorecard | Stored) & { source: "recorded" | "live" | "computed" };

const KEYS: MetricKey[] = ["confirm", "messages", "followups", "rate"];
const prevDay = (ymd: string) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) - 1)).toISOString().slice(0, 10);
const fmtDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" });
const who = (email: string) => email.split("@")[0];

export default function DailyTargetsPage() {
    const { activeBusiness } = useBusiness();
    const businessId = activeBusiness?.id;
    const today = cairoDate();
    const [day, setDay] = useState(today);
    const [settings, setSettings] = useState<TargetSettings | null>(null);
    const [reports, setReports] = useState<Report[] | null>(null);
    const [missing, setMissing] = useState(false);
    const [scoring, setScoring] = useState(false);
    const [reload, setReload] = useState(0);
    const [loadedKey, setLoadedKey] = useState("");

    const key = `${businessId}|${day}|${reload}`;
    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        (async () => {
            const [s, recorded] = await Promise.all([
                supabase.from("moderator_target_settings").select("*").eq("business_id", businessId).maybeSingle(),
                supabase.from("moderator_scorecards").select("*").eq("business_id", businessId).eq("work_date", day).order("user_email"),
            ]);
            if (gone) return;
            const st = settingsOf(s.data);
            const stored = new Map(((recorded.data || []) as Stored[]).map(r => [r.user_email.toLowerCase(), r]));
            let computed: Scorecard[] = [];
            if (!s.error && st.members.length) {
                const data = await loadTargetData(supabase, businessId, dataSince([day], st)).catch(() => null);
                if (data) computed = scoreDay(day, st, data);
            }
            if (gone) return;
            const now = Date.now();
            const out: Report[] = computed.map(c => {
                const rec = stored.get(c.user_email);
                if (rec) { stored.delete(c.user_email); return { ...rec, source: "recorded" as const }; }
                return { ...c, source: Date.parse(c.shift_end) > now ? "live" as const : "computed" as const };
            });
            // Scored people no longer in the list.
            stored.forEach(r => out.push({ ...r, source: "recorded" }));
            setSettings(st);
            setMissing(!!s.error || !!recorded.error);
            setReports(out.sort((a, b) => Date.parse(a.shift_start) - Date.parse(b.shift_start)));
            setLoadedKey(key);
        })();
        return () => { gone = true; };
    }, [businessId, day, reload, key]);

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

    const loading = loadedKey !== key || !settings || reports === null;
    const total = (reports || []).reduce((s, r) => s + (r.source === "recorded" ? ((r as Stored).adjustment_id ? Number(r.deduction) || 0 : 0) : Number(r.deduction) || 0), 0);

    return (
        <div className="mx-auto max-w-6xl space-y-6" dir="rtl">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">تقرير المودريتورز</h1>
                    <p className="mt-1 text-sm text-muted-foreground">اختار يوم وشوف كل مودريتور عمل إيه في شيفته، والمطلوب منه، والخصم.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={scoreNow} disabled={scoring || !settings?.enabled} className="gap-1.5">
                        {scoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}سجّل كشف الشيفتات اللي خلصت
                    </Button>
                    <Button asChild variant="ghost" size="icon" aria-label="إعدادات التارجت">
                        <Link href="/settings?tab=targets"><Settings className="h-4 w-4" /></Link>
                    </Button>
                </div>
            </div>

            {/* The day */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
                <Button variant="ghost" size="icon" aria-label="اليوم اللي قبله" onClick={() => setDay(prevDay(day))}><ChevronRight className="h-5 w-5" /></Button>
                <Input type="date" value={day} max={today} onChange={e => e.target.value && setDay(e.target.value)} className="w-auto" />
                <Button variant="ghost" size="icon" aria-label="اليوم اللي بعده" disabled={day >= today} onClick={() => setDay(nextDay(day))}><ChevronLeft className="h-5 w-5" /></Button>
                <span className="font-medium">{fmtDay(day)}</span>
                <span className="ms-auto flex gap-1">
                    <Button variant={day === today ? "secondary" : "ghost"} size="sm" onClick={() => setDay(today)}>النهارده</Button>
                    <Button variant={day === prevDay(today) ? "secondary" : "ghost"} size="sm" onClick={() => setDay(prevDay(today))}>امبارح</Button>
                </span>
            </div>

            {missing && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    شغّل الملف <code className="font-mono">{DAILY_TARGETS_MIGRATION}</code> في Supabase الأول.
                </div>
            )}
            {!missing && settings && !settings.enabled && (
                <div className="rounded-lg border p-4 text-sm">
                    الكشف اليومي مقفول، فمفيش خصم بيتسجل. التقرير بيتحسب برضه. شغّله من <Link href="/settings?tab=targets" className="text-primary underline-offset-4 hover:underline">الإعدادات</Link>.
                </div>
            )}

            {loading ? (
                <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : !settings!.members.length ? (
                <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">اختار المودريتورز اللي بيتقاسوا من الإعدادات الأول.</p>
            ) : reports!.length === 0 ? (
                <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">مفيش شيفتات في اليوم ده (أجازات أو لسه مابدأتش).</p>
            ) : (
                <>
                    <SummaryStrip reports={reports!} total={total} />
                    <div className="grid gap-4 lg:grid-cols-2">
                        {reports!.map(r => <DayReport key={r.user_email} r={r} settings={settings!} />)}
                    </div>
                </>
            )}
        </div>
    );
}

function SummaryStrip({ reports, total }: { reports: Report[]; total: number }) {
    const evaluated = reports.filter(r => r.status === "evaluated");
    const clean = evaluated.filter(r => !r.missed.length && !(r.attendance?.items.length)).length;
    return (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
            <Cell label="شيفتات" value={String(reports.length)} />
            <Cell label="حققوا كل حاجة" value={`${clean} من ${evaluated.length}`} tone={clean === evaluated.length && evaluated.length ? "text-emerald-700 dark:text-emerald-400" : ""} />
            <Cell label="من غير نشاط" value={String(reports.filter(r => r.status === "absent").length)} />
            <Cell label="الخصومات" value={formatCurrency(total)} tone={total > 0 ? "text-rose-700 dark:text-rose-400" : ""} />
        </div>
    );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
    return (
        <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={cn("mt-1 text-lg font-semibold tabular-nums", tone)}>{value}</p>
        </div>
    );
}

function DayReport({ r, settings }: { r: Report; settings: TargetSettings }) {
    const live = r.source === "live";
    const recorded = r.source === "recorded" ? (r as Stored) : null;
    const byKey = Object.fromEntries((r.metrics || []).map(m => [m.key, m])) as Record<MetricKey, MetricResult>;
    const attendance = r.attendance;
    const deduction = Number(r.deduction) || 0;
    const waived = recorded && deduction > 0 && !recorded.adjustment_id && !recorded.payroll_note;

    return (
        <section className="space-y-4 rounded-xl border bg-card p-4">
            <header className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h2 className="font-semibold">{who(r.user_email)}</h2>
                    <p className="text-xs text-muted-foreground">
                        الشيفت {fmtTime(r.shift_start)} – {fmtTime(r.shift_end)}
                        {r.status === "evaluated" && <> · نصيبه من الشغل {Math.round(r.share * 100)}%</>}
                    </p>
                </div>
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs",
                    live ? "bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300"
                        : recorded ? "bg-muted text-muted-foreground"
                        : "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300")}>
                    {live ? "الشيفت لسه شغال" : recorded ? "كشف متسجل" : "محسوب دلوقتي، مش متسجل"}
                </span>
            </header>

            {r.status === "leave" && <p className="text-sm text-muted-foreground">إجازة معتمدة.</p>}
            {r.status === "absent" && <p className="text-sm text-muted-foreground">يوم شغل من غير أي نشاط ولا تسجيل حضور. اتأكد إذا كان غياب.</p>}

            {r.status === "evaluated" && (
                <ul className="space-y-4">
                    {KEYS.map(k => byKey[k] && <MetricRow key={k} m={byKey[k]} settings={settings} live={live} />)}
                </ul>
            )}

            {attendance && (
                <div className="space-y-1.5 rounded-lg bg-muted/40 p-3 text-xs">
                    <p className="font-medium text-foreground">الحضور</p>
                    <p className="text-muted-foreground">
                        {attendance.clock_in ? `حضور ${fmtTime(attendance.clock_in)}` : "مسجلش حضور"}
                        {" · "}
                        {attendance.clock_out ? `انصراف ${fmtTime(attendance.clock_out)}` : "مسجلش انصراف"}
                    </p>
                    {attendance.items.map(i => (
                        <p key={i.key} className="text-rose-700 dark:text-rose-400">
                            {ATTENDANCE_LABEL[i.key]}: {i.detail}{i.amount > 0 && ` خصم ${formatCurrency(i.amount)}.`}
                        </p>
                    ))}
                </div>
            )}

            <footer className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-3 text-sm">
                <span className="text-muted-foreground">{live ? "الخصم لو الشيفت خلص كده" : "الخصم"}</span>
                <span className="text-end">
                    <span className={cn("font-semibold tabular-nums", deduction > 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400", waived && "text-muted-foreground line-through")}>
                        {deduction > 0 ? formatCurrency(deduction) : "مفيش"}
                    </span>
                    {recorded?.adjustment_id && <span className="block text-[11px] text-muted-foreground">اتسجل في المرتبات</span>}
                    {waived && <span className="block text-[11px] text-muted-foreground">اتلغى من المرتبات</span>}
                    {recorded?.payroll_note && <span className="block text-[11px] text-amber-700 dark:text-amber-400">{recorded.payroll_note}</span>}
                    {!recorded && !live && deduction > 0 && <span className="block text-[11px] text-muted-foreground">مش متسجل في المرتبات</span>}
                </span>
            </footer>
        </section>
    );
}
