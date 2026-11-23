"use client";

import Link from "next/link";
import { teamName } from "@/lib/team-names";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, RefreshCw, Settings } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { cn } from "@/lib/utils";
import { cairoDate, nextDay } from "@/lib/cairo-day";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    ATTENDANCE_LABEL, DAILY_TARGETS_MIGRATION, METRIC_LABEL, dataSince, deductionFor, loadMonthStanding, loadTargetData, scoreDay, settingsOf,
    type Attendance, type MetricKey, type MonthStanding, type MetricResult, type Scorecard, type TargetSettings,
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

const KEYS: MetricKey[] = ["confirm", "whatsapp", "messages", "followups", "rate"];
const prevDay = (ymd: string) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) - 1)).toISOString().slice(0, 10);
const fmtDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" });
const who = (email: string) => teamName(email);

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
                return { ...c, source: Date.parse(c.counts_until || c.shift_end) > now ? "live" as const : "computed" as const };
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

            {settings && settings.members.length > 0 && businessId && <MonthBonus businessId={businessId} settings={settings} month={day.slice(0, 7)} />}
        </div>
    );
}

/** The month of the day picked: who is on course for the bonus, and why not. */
function MonthBonus({ businessId, settings, month }: { businessId: string; settings: TargetSettings; month: string }) {
    const [rows, setRows] = useState<{ month: string; list: MonthStanding[] } | null>(null);
    useEffect(() => {
        let gone = false;
        loadMonthStanding(supabase, businessId, `${month}-01`, settings).then(list => { if (!gone) setRows({ month, list }); }).catch(() => undefined);
        return () => { gone = true; };
    }, [businessId, settings, month]);
    const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("ar-EG", { month: "long", year: "numeric" });
    return (
        <section className="space-y-3 rounded-xl border bg-card p-4">
            <div>
                <h2 className="text-lg font-semibold">المكافأة الشهرية: {label}</h2>
                <p className="text-sm text-muted-foreground">
                    {Number(settings.bonus_amount) > 0
                        ? `${money(Number(settings.bonus_amount))} لكل مودريتور حقق كل التارجت في ${settings.bonus_days_pct}% من أيامه، ونسبة التسليم من تأكيداته ${settings.bonus_delivery_rate}% أو أكتر. بتتسجل في المرتبات أول الشهر اللي بعده.`
                        : "قيمة المكافأة 0 في الإعدادات، فده للمتابعة بس."}
                </p>
            </div>
            {rows?.month !== month ? (
                <div className="flex h-16 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : (
                <ul className="divide-y rounded-lg border">
                    {rows.list.map(r => (
                        <li key={r.user_email} className="flex flex-wrap items-start justify-between gap-3 p-3">
                            <div className="min-w-0">
                                <p className="font-semibold">{who(r.user_email)}</p>
                                <p className="text-xs text-muted-foreground">
                                    حقق كل التارجت {r.days_met} من {r.days} يوم ({r.days_pct}%) · اتسلم {r.delivered} ورجع {r.came_back}
                                    {r.delivery_rate !== null && ` (${r.delivery_rate}%)`}
                                </p>
                                {!r.eligible && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{r.notes.join(" · ")}</p>}
                            </div>
                            <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                                r.eligible ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
                                {r.eligible ? "يستحق المكافأة لحد دلوقتي" : "لسه"}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
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
            <Cell label="الخصومات" value={money(total)} tone={total > 0 ? "text-rose-700 dark:text-rose-400" : ""} />
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

const money = (n: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n))} ج.م`;

/**
 * One moderator's day, readable at a glance: what it costs at the top, one
 * line per target (done / needed, what is left, what it costs), attendance in
 * one line. The long explanations sit behind "التفاصيل".
 */
function DayReport({ r, settings }: { r: Report; settings: TargetSettings }) {
    const [open, setOpen] = useState(false);
    const live = r.source === "live";
    const recorded = r.source === "recorded" ? (r as Stored) : null;
    const byKey = Object.fromEntries((r.metrics || []).map(m => [m.key, m])) as Record<MetricKey, MetricResult>;
    const att = r.attendance;
    const deduction = Number(r.deduction) || 0;
    const waived = recorded && deduction > 0 && !recorded.adjustment_id && !recorded.payroll_note;
    const name = who(r.user_email);

    return (
        <section className="overflow-hidden rounded-xl border bg-card">
            {/* Who, when, and the bottom line */}
            <div className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold">{name}</h2>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px]",
                            live ? "bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300"
                                : recorded ? "bg-muted text-muted-foreground"
                                : "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300")}>
                            {live ? "شغال دلوقتي" : recorded ? "متسجل" : "مش متسجل"}
                        </span>
                    </div>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                        {fmtTime(r.shift_start)} – {fmtTime(r.shift_end)}
                        {r.status === "evaluated" && <> · نصيبه {Math.round(r.share * 100)}%</>}
                    </p>
                </div>
                {r.status === "evaluated" && (
                    <div className="shrink-0 text-end">
                        <p className={cn("text-2xl font-bold tabular-nums leading-none",
                            waived ? "text-muted-foreground line-through" : deduction > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                            {deduction > 0 ? money(deduction) : "✓"}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                            {deduction === 0 ? "مفيش خصم" : waived ? "اتلغى" : recorded?.adjustment_id ? "اتخصم" : live ? "لو خلص كده" : recorded?.payroll_note || "خصم"}
                        </p>
                    </div>
                )}
            </div>

            {r.status === "leave" && <p className="border-t px-4 py-3 text-sm text-muted-foreground">إجازة معتمدة.</p>}
            {r.status === "absent" && <p className="border-t px-4 py-3 text-sm text-amber-700 dark:text-amber-400">مفيش أي شغل ولا حضور في الشيفت. غياب؟</p>}

            {r.status === "evaluated" && (
                <>
                    <ul className="divide-y border-t">
                        {KEYS.map(k => byKey[k] && <TargetLine key={k} m={byKey[k]} cost={deductionFor(settings, k)} live={live} />)}
                        {att && <AttendanceLine att={att} live={live} />}
                    </ul>
                    <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
                        className="flex w-full items-center justify-center gap-1 border-t py-2 text-xs text-muted-foreground hover:bg-muted/40">
                        التفاصيل <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
                    </button>
                    {open && (
                        <ul className="space-y-1.5 border-t bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
                            {KEYS.map(k => byKey[k] && <li key={k}><span className="font-medium text-foreground">{METRIC_LABEL[k]}:</span> {byKey[k].detail}</li>)}
                            {att?.items.map(i => <li key={i.key}><span className="font-medium text-foreground">{ATTENDANCE_LABEL[i.key]}:</span> {i.detail}</li>)}
                        </ul>
                    )}
                </>
            )}
        </section>
    );
}

function TargetLine({ m, cost, live }: { m: MetricResult; cost: number; live: boolean }) {
    const asked = m.target !== null;
    const missing = asked && !m.met;
    const left = missing && m.key !== "rate" ? (m.target as number) - m.done : 0;
    const tone = !asked ? "text-muted-foreground" : m.met ? "text-emerald-600 dark:text-emerald-400" : live ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
    const pct = !asked ? 0 : Math.min(100, (m.done / Math.max(1, m.target as number)) * 100);
    return (
        <li className="px-4 py-2.5">
            <div className="flex items-center gap-3">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", !asked ? "bg-muted-foreground/30" : m.met ? "bg-emerald-500" : live ? "bg-amber-500" : "bg-rose-500")} aria-hidden />
                <span className="min-w-0 flex-1 text-sm">{METRIC_LABEL[m.key]}</span>
                <span className={cn("text-sm font-semibold tabular-nums", tone)}>
                    {m.key === "rate" ? `${m.done}%` : m.done}
                    {asked && <span className="font-normal text-muted-foreground"> / {m.key === "rate" ? `${m.target}%` : m.target}</span>}
                </span>
                <span className="w-24 shrink-0 text-end text-xs">
                    {!asked ? <span className="text-muted-foreground">مش مطلوب</span>
                        : m.met ? <span className="text-emerald-600 dark:text-emerald-400">تمام</span>
                        : <span className={cn("font-medium", live ? "text-amber-700 dark:text-amber-400" : "text-rose-700 dark:text-rose-400")}>
                            {m.key === "rate" ? "أقل" : `${live ? "فاضل" : "ناقص"} ${left}`}{cost > 0 && ` · ${money(cost)}`}
                        </span>}
                </span>
            </div>
            {asked && !m.met && (
                <div className="ms-5 mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", live ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${pct}%` }} />
                </div>
            )}
            {m.key === "confirm" && m.parts && (
                <p className="ms-5 mt-1 text-[11px] tabular-nums text-muted-foreground">
                    اتأكد {m.parts.confirmed} · اتلغى {m.parts.cancelled} · محاولة {m.parts.attempted}
                </p>
            )}
        </li>
    );
}

function AttendanceLine({ att, live }: { att: Attendance; live: boolean }) {
    return (
        <li className="px-4 py-2.5">
            <div className="flex items-center gap-3">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", att.items.length ? (live ? "bg-amber-500" : "bg-rose-500") : "bg-emerald-500")} aria-hidden />
                <span className="flex-1 text-sm">الحضور</span>
                <span className="text-sm tabular-nums">
                    {att.clock_in ? fmtTime(att.clock_in) : <span className="text-rose-600 dark:text-rose-400">مسجلش حضور</span>}
                    <span className="text-muted-foreground"> ← </span>
                    {att.clock_out ? fmtTime(att.clock_out) : <span className="text-muted-foreground">{live ? "لسه" : "مسجلش انصراف"}</span>}
                </span>
            </div>
            {att.items.length > 0 && (
                <div className="ms-5 mt-1.5 flex flex-wrap gap-1.5">
                    {att.items.map(i => (
                        <span key={i.key} className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                            {ATTENDANCE_LABEL[i.key]}{i.key === "late" && att.late_minutes ? ` ${att.late_minutes} د` : i.key === "early" && att.early_minutes ? ` ${att.early_minutes} د` : ""}
                            {i.amount > 0 && ` · ${money(i.amount)}`}
                        </span>
                    ))}
                </div>
            )}
        </li>
    );
}
