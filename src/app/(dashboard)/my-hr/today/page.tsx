"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, Circle, Loader2, LogIn, LogOut, TriangleAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { cn } from "@/lib/utils";
import { cairoDate } from "@/lib/cairo-day";
import { Button } from "@/components/ui/button";
import {
    ATTENDANCE_LABEL, METRIC_LABEL, attendanceFor, clockingFor, dataSince, deductionFor, loadTargetData,
    recentDays, scheduledShift, scoreDay, settingsOf,
    type Attendance, type Clocking, type Member, type MetricKey, type MetricResult, type Scorecard, type TargetSettings,
} from "@/lib/hr/daily-targets";

/**
 * A moderator's day on their phone: the shift and the clock, what is left to
 * reach today's targets and what missing them would cost, and this month's
 * deductions (with why) and commission (delivered, and still on its way).
 * The link sent to the team: /my-hr/today.
 */

const fmtTime = (t: number | string) => new Date(t).toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" });
const fmtDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("ar-EG", { weekday: "short", day: "numeric", month: "short" });
const dur = (ms: number) => {
    const m = Math.max(0, Math.round(ms / 60_000));
    const h = Math.floor(m / 60);
    return h ? `${h} س ${m % 60} د` : `${m} د`;
};
/** "1,250 ج.م": the way the team reads money. */
const egp = (n: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n)} ج.م`;
/** A daily-targets reason without its date, which is shown beside it. */
const reasonText = (r: string) => r.replace(/^تارجت يوم \d{4}-\d{2}-\d{2}:\s*/, "التارجت اليومي: ");

/** The "shift date" My HR files attendance under (same rule, so both pages agree). */
function logicalShiftDate(now: Date, shiftStart: string | null): string {
    if (!shiftStart) return now.toISOString().split("T")[0];
    const [h, m] = shiftStart.split(":").map(Number);
    const d = new Date(now);
    d.setHours(d.getHours() + (2 - h));
    d.setMinutes(d.getMinutes() - m);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface PayItem { kind: "bonus" | "deduction" | "advance"; amount: number; reason: string; entry_date: string; automatic: boolean }
interface Commission { eligible_orders: number; eligible_sales: number; commission: number | null; awaiting_orders: number; awaiting_commission: number | null; returned: number; cancelled: number; below_min: number; min_total: number; rate: number | null }
type PastCard = Scorecard & { id: string; adjustment_id: string | null; payroll_note: string | null };

export default function MyDayPage() {
    const { activeBusiness, currentUser } = useBusiness();
    const businessId = activeBusiness?.id;
    const email = currentUser?.email?.toLowerCase() || "";

    const [member, setMember] = useState<Member | null>(null);
    const [settings, setSettings] = useState<TargetSettings | null>(null);
    const [live, setLive] = useState<{ card: Scorecard | null; attendance: Attendance | null; day: string } | null>(null);
    const [openLog, setOpenLog] = useState<{ id: string; clock_in_time: string; clock_out_time: string | null } | null>(null);
    const [pay, setPay] = useState<PayItem[] | null | "missing">(null);
    const [commission, setCommission] = useState<Commission | null | "none">(null);
    const [past, setPast] = useState<PastCard[]>([]);
    const [now, setNow] = useState(() => Date.now());
    const [busy, setBusy] = useState(false);
    const [reload, setReload] = useState(0);

    // The clock on the shift bar moves every minute; the numbers reload every five.
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
    useEffect(() => { const t = setInterval(() => setReload(n => n + 1), 5 * 60_000); return () => clearInterval(t); }, []);

    // Who I am, my shift, the rules.
    useEffect(() => {
        if (!businessId || !email) return;
        let gone = false;
        Promise.all([
            supabase.from("business_users").select("user_email, shift_start, shift_end, weekend_days").eq("business_id", businessId).ilike("user_email", email).maybeSingle(),
            supabase.from("moderator_target_settings").select("*").eq("business_id", businessId).maybeSingle(),
        ]).then(([m, s]) => {
            if (gone) return;
            setMember((m.data as Member) || { user_email: email, shift_start: null, shift_end: null, weekend_days: [] });
            setSettings(settingsOf(s.data));
        });
        return () => { gone = true; };
    }, [businessId, email]);

    const measured = !!settings?.enabled && settings.members.includes(email);

    // Today: the shift I am in (or the next/last one today), live score, attendance.
    useEffect(() => {
        if (!businessId || !member || !settings) return;
        let gone = false;
        (async () => {
            const t = Date.now();
            const days = recentDays(t);
            const since = dataSince(days, settings);
            const { data: clocks } = await supabase.from("attendance_logs").select("id, user_email, date, clock_in_time, clock_out_time")
                .eq("business_id", businessId).ilike("user_email", email).gte("clock_in_time", since).order("clock_in_time", { ascending: false });
            const mine = (clocks || []) as (Clocking & { id: string })[];
            const open = mine.find(c => !c.clock_out_time) || null;

            // Which day's shift is "now": the one running, else today's.
            const pick = days.slice().reverse().find(d => {
                const s = scheduledShift(member, d);
                return s && t >= s.start - 3 * 3_600_000 && t <= s.end + 3_600_000;
            }) || days[days.length - 1];

            let card: Scorecard | null = null;
            if (measured) {
                const data = await loadTargetData(supabase, businessId, since).catch(() => null);
                if (data) {
                    data.clockings = [...data.clockings.filter(c => c.user_email.toLowerCase() !== email), ...mine];
                    card = scoreDay(pick, settings, data, t).find(c => c.user_email === email) || null;
                }
            }
            const clocking = clockingFor(member, pick, mine);
            const attendance = attendanceFor(member, pick, clocking, settings, t, true);
            if (gone) return;
            setOpenLog(open ? { id: (open as { id: string }).id, clock_in_time: open.clock_in_time!, clock_out_time: null } : null);
            setLive({ card, attendance, day: pick });
        })();
        return () => { gone = true; };
    }, [businessId, email, member, settings, measured, reload]);

    // This month: deductions and bonuses, commission, past shifts.
    useEffect(() => {
        if (!businessId || !email) return;
        let gone = false;
        const today = cairoDate();
        const first = today.slice(0, 8) + "01";
        Promise.all([
            supabase.rpc("get_my_pay_items", { p_business_id: businessId, p_period: first }),
            supabase.rpc("commission_board", { p_business_id: businessId, p_from: first, p_to: today }),
            supabase.from("moderator_scorecards").select("*").eq("business_id", businessId).ilike("user_email", email)
                .gte("work_date", first).order("work_date", { ascending: false }),
        ]).then(([p, c, sc]) => {
            if (gone) return;
            setPay(p.error ? "missing" : (p.data || []).map((r: PayItem) => ({ ...r, amount: Number(r.amount) || 0 })));
            const row = (c.data?.rows || []).find((r: { is_me: boolean }) => r.is_me);
            setCommission(row ? {
                ...row,
                eligible_sales: Number(row.eligible_sales) || 0,
                commission: row.commission === null ? null : Number(row.commission) || 0,
                awaiting_commission: row.awaiting_commission === null ? null : Number(row.awaiting_commission) || 0,
            } : "none");
            setPast((sc.data || []) as PastCard[]);
        });
        return () => { gone = true; };
    }, [businessId, email, reload]);

    const clockIn = useCallback(async () => {
        if (!businessId || !email) return;
        setBusy(true);
        const at = new Date();
        const { error } = await supabase.from("attendance_logs").insert({
            business_id: businessId, user_email: currentUser!.email, date: logicalShiftDate(at, member?.shift_start || null),
            clock_in_time: at.toISOString(), status: "present",
        });
        setBusy(false);
        if (error) toast.error(/duplicate/i.test(error.message) ? "انت مسجّل حضور النهارده بالفعل." : "الحضور ماتسجلش، جرّب تاني.");
        else { toast.success(`اتسجل حضورك ${fmtTime(at.getTime())}`); setReload(n => n + 1); }
    }, [businessId, email, currentUser, member]);

    const clockOut = useCallback(async () => {
        if (!openLog) return;
        setBusy(true);
        const at = new Date();
        const { error } = await supabase.from("attendance_logs").update({ clock_out_time: at.toISOString() }).eq("id", openLog.id);
        setBusy(false);
        if (error) toast.error("الانصراف ماتسجلش، جرّب تاني.");
        else { toast.success(`اتسجل انصرافك ${fmtTime(at.getTime())}`); setReload(n => n + 1); }
    }, [openLog]);

    if (!businessId || !member || !settings || !live) {
        return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
    }

    const shift = scheduledShift(member, live.day);
    const name = (currentUser?.user_metadata?.full_name as string | undefined)?.split(" ")[0] || email.split("@")[0];

    return (
        <div className="mx-auto w-full max-w-xl space-y-5 pb-10" dir="rtl">
            <header className="flex items-baseline justify-between gap-3 px-1">
                <h1 className="text-xl font-bold">أهلًا {name}</h1>
                <span className="text-sm text-muted-foreground">{fmtDay(cairoDate(new Date(now)))}</span>
            </header>

            <ShiftCard shift={shift} openLog={openLog} attendance={live.attendance} settings={settings} now={now} busy={busy}
                onClockIn={clockIn} onClockOut={clockOut} />

            {measured && live.card && live.card.status === "evaluated" && (
                <TodayTargets card={live.card} settings={settings} attendance={live.attendance} now={now} />
            )}
            {measured && live.card?.status === "leave" && (
                <p className="rounded-2xl border p-4 text-sm text-muted-foreground">النهارده إجازة معتمدة، مفيش تارجت.</p>
            )}

            <MonthSection pay={pay} commission={commission} past={past} measured={measured} />

            {measured && <HowItWorks settings={settings} />}

            <p className="px-1 text-center text-xs text-muted-foreground">
                طلبات الإجازة والإذن من <Link href="/my-hr" className="underline underline-offset-4">My HR</Link>.
            </p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// The shift and the clock
// ---------------------------------------------------------------------------

function ShiftCard({ shift, openLog, attendance, settings, now, busy, onClockIn, onClockOut }: {
    shift: { start: number; end: number } | null;
    openLog: { clock_in_time: string } | null;
    attendance: Attendance | null;
    settings: TargetSettings;
    now: number;
    busy: boolean;
    onClockIn: () => void;
    onClockOut: () => void;
}) {
    const clockedIn = !!openLog;
    const doneToday = !!attendance?.clock_in && !!attendance?.clock_out && !clockedIn;
    const grace = (Number(settings.grace_minutes) || 0) * 60_000;

    let status = "";
    let tone = "text-muted-foreground";
    if (!shift) status = "النهارده أجازتك الأسبوعية.";
    else if (clockedIn) {
        const left = shift.end - now;
        status = left > 0 ? `في الشيفت من ${dur(now - Date.parse(openLog!.clock_in_time))} · فاضل ${dur(left)}` : `الشيفت خلص من ${dur(-left)}. سجّل انصراف.`;
        tone = left > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400";
    } else if (doneToday) status = `سجّلت حضور ${fmtTime(attendance!.clock_in!)} وانصراف ${fmtTime(attendance!.clock_out!)}.`;
    else if (now < shift.start) status = `الشيفت بيبدأ بعد ${dur(shift.start - now)}.`;
    else if (now <= shift.end) {
        status = now > shift.start + grace ? `الشيفت بدأ من ${dur(now - shift.start)} ولسه ماسجلتش حضور.` : "الشيفت بدأ. سجّل حضورك.";
        tone = now > shift.start + grace ? "text-rose-700 dark:text-rose-400" : "text-foreground";
    } else status = "الشيفت خلص.";

    // Where now sits on the shift.
    const span = shift ? shift.end - shift.start : 1;
    const pos = shift ? Math.min(100, Math.max(0, ((now - shift.start) / span) * 100)) : 0;
    const inPos = shift && attendance?.clock_in ? Math.min(100, Math.max(0, ((Date.parse(attendance.clock_in) - shift.start) / span) * 100)) : null;

    // What leaving now would cost.
    const leavingEarly = clockedIn && shift && now < shift.end - grace;
    const earlyCost = Number(settings.deduct_early) || 0;

    return (
        <section className="overflow-hidden rounded-2xl border bg-card">
            <div className="space-y-4 p-5">
                <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-sm font-medium text-muted-foreground">شيفتك</h2>
                    {shift && (
                        <span className="text-lg font-bold tabular-nums">
                            {fmtTime(shift.start)} <span className="font-normal text-muted-foreground">←</span> {fmtTime(shift.end)}
                        </span>
                    )}
                </div>

                {shift && (
                    <div className="relative pt-1" aria-hidden>
                        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                            <div className={cn("h-full rounded-full", clockedIn ? "bg-emerald-500" : "bg-muted-foreground/30")} style={{ width: `${pos}%` }} />
                        </div>
                        {inPos !== null && <span className="absolute top-0 h-4 w-0.5 bg-foreground/60" style={{ insetInlineStart: `${inPos}%` }} title="سجّلت حضور" />}
                        {now >= shift.start && now <= shift.end && (
                            <span className="absolute -top-0.5 h-5 w-5 -translate-x-1/2 rounded-full border-4 border-background bg-foreground shadow rtl:translate-x-1/2" style={{ insetInlineStart: `${pos}%` }} />
                        )}
                    </div>
                )}

                <p className={cn("text-sm font-medium", tone)}>{status}</p>

                {attendance?.items.filter(i => i.key === "late").map(i => (
                    <p key={i.key} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                        <TriangleAlert className="h-4 w-4 shrink-0" />
                        {i.detail}{i.amount > 0 && ` خصم ${egp(i.amount)}.`}
                    </p>
                ))}
            </div>

            {shift && !doneToday && (
                <div className="border-t bg-muted/30 p-3">
                    {clockedIn ? (
                        <Button onClick={onClockOut} disabled={busy} variant="outline" className="h-14 w-full gap-2 text-base font-semibold">
                            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}سجّل انصراف
                        </Button>
                    ) : (
                        <Button onClick={onClockIn} disabled={busy} className="h-14 w-full gap-2 bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700">
                            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}سجّل حضور
                        </Button>
                    )}
                    {leavingEarly && earlyCost > 0 && (
                        <p className="mt-2 text-center text-xs text-muted-foreground">لو سجّلت انصراف قبل {fmtTime(shift.end - grace)} هيتحسب خروج بدري: خصم {egp(earlyCost)}.</p>
                    )}
                </div>
            )}
        </section>
    );
}

// ---------------------------------------------------------------------------
// Today's targets
// ---------------------------------------------------------------------------

function TodayTargets({ card, settings, attendance, now }: { card: Scorecard; settings: TargetSettings; attendance: Attendance | null; now: number }) {
    const running = now < Date.parse(card.shift_end);
    const order: MetricKey[] = ["confirm", "messages", "followups", "rate"];
    const metrics = order.map(k => card.metrics.find(m => m.key === k)).filter(Boolean) as MetricResult[];
    const atRisk = metrics.filter(m => m.target !== null && !m.met).reduce((s, m) => s + deductionFor(settings, m.key), 0)
        + (attendance?.items.reduce((s, i) => s + i.amount, 0) || 0);
    const allMet = metrics.every(m => m.met);

    return (
        <section className="space-y-3 rounded-2xl border bg-card p-5">
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-base font-semibold">{running ? "عشان ماتتخصمش النهارده" : "تارجت النهارده"}</h2>
                {allMet ? (
                    <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">حققت كل حاجة</span>
                ) : atRisk > 0 ? (
                    <span className="text-sm font-medium text-rose-700 dark:text-rose-400">{running ? "لو فضل كده:" : "الخصم:"} {egp(atRisk)}</span>
                ) : null}
            </div>
            <ul className="divide-y">
                {metrics.map(m => <TargetRow key={m.key} m={m} cost={deductionFor(settings, m.key)} running={running} />)}
            </ul>
            <p className="text-xs text-muted-foreground">
                نصيبك من شغل الشيفت {Math.round(card.share * 100)}% (حسب مين معاك في نفس الوقت). بيتحدّث كل 5 دقايق، والكشف النهائي بعد الشيفت بنص ساعة.
            </p>
        </section>
    );
}

function TargetRow({ m, cost, running }: { m: MetricResult; cost: number; running: boolean }) {
    const asked = m.target !== null;
    const left = asked && !m.met && m.key !== "rate" ? m.target! - m.done : 0;
    const pct = !asked ? 0 : m.key === "rate" ? Math.min(100, (m.done / Math.max(1, m.target!)) * 100) : m.target! <= 0 ? 100 : Math.min(100, (m.done / m.target!) * 100);
    const [open, setOpen] = useState(false);
    return (
        <li className="py-3">
            <button type="button" onClick={() => setOpen(o => !o)} className="w-full space-y-2 text-start" aria-expanded={open}>
                <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-medium">
                        {!asked ? <Circle className="h-5 w-5 text-muted-foreground/40" />
                            : m.met ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                            : <Circle className={cn("h-5 w-5", running ? "text-amber-500" : "text-rose-500")} />}
                        {METRIC_LABEL[m.key]}
                    </span>
                    <span className="flex items-center gap-1.5 tabular-nums">
                        <span className="text-lg font-bold">{m.key === "rate" ? `${m.done}%` : m.done}</span>
                        {asked && <span className="text-sm text-muted-foreground">/ {m.key === "rate" ? `${m.target}%` : m.target}</span>}
                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
                    </span>
                </div>
                {asked && (
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full rounded-full", m.met ? "bg-emerald-500" : running ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${pct}%` }} />
                    </div>
                )}
                {m.key === "confirm" && m.parts && (
                    <div className="flex flex-wrap gap-1.5 text-xs">
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">اتأكد {m.parts.confirmed}</span>
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">اتلغى {m.parts.cancelled}</span>
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">محاولة متسجلة {m.parts.attempted}</span>
                    </div>
                )}
                <p className="text-sm">
                    {!asked ? <span className="text-muted-foreground">مش مطلوب النهارده.</span>
                        : m.met ? <span className="text-emerald-700 dark:text-emerald-400">تمام.</span>
                        : m.key === "rate" ? <span className={running ? "text-amber-700 dark:text-amber-400" : "text-rose-700 dark:text-rose-400"}>محتاج تعلّي النسبة لـ {m.target}%{cost > 0 && ` · خصم ${egp(cost)}`}</span>
                        : <span className={running ? "text-amber-700 dark:text-amber-400" : "text-rose-700 dark:text-rose-400"}>{running ? `فاضلك ${left}` : `ناقص ${left}`}{cost > 0 && ` · خصم ${egp(cost)}`}</span>}
                </p>
            </button>
            {open && <p className="mt-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">{m.detail}</p>}
        </li>
    );
}

// ---------------------------------------------------------------------------
// The month
// ---------------------------------------------------------------------------

function MonthSection({ pay, commission, past, measured }: {
    pay: PayItem[] | null | "missing";
    commission: Commission | null | "none";
    past: PastCard[];
    measured: boolean;
}) {
    const deductions = Array.isArray(pay) ? pay.filter(p => p.kind === "deduction") : [];
    const bonuses = Array.isArray(pay) ? pay.filter(p => p.kind === "bonus") : [];
    const totalDed = deductions.reduce((s, p) => s + p.amount, 0);
    const c = commission && commission !== "none" ? commission : null;
    const [showAll, setShowAll] = useState(false);
    const list = showAll ? deductions : deductions.slice(0, 5);
    const monthName = new Date().toLocaleDateString("ar-EG", { month: "long", timeZone: "Africa/Cairo" });

    return (
        <section className="space-y-3">
            <h2 className="px-1 text-base font-semibold">شهر {monthName}</h2>

            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border bg-border">
                <Stat label="كوميشن وصل" value={c?.commission ?? null} tone="text-emerald-700 dark:text-emerald-400" sub={c ? `${c.eligible_orders} أوردر` : "—"} />
                <Stat label="كوميشن مستني" value={c?.awaiting_commission ?? null} tone="text-sky-700 dark:text-sky-400" sub={c ? `${c.awaiting_orders} أوردر في الطريق` : "—"} />
                <Stat label="خصومات" value={pay === "missing" ? null : totalDed} tone={totalDed > 0 ? "text-rose-700 dark:text-rose-400" : ""} sub={`${deductions.length} خصم`} />
            </div>

            {c && (
                <div className="rounded-2xl border bg-card p-4 text-sm">
                    <h3 className="mb-2 font-medium">الكوميشن</h3>
                    <ul className="space-y-1.5 text-muted-foreground">
                        <li className="flex justify-between gap-3"><span>أوردرات وصلت للعميل</span><span className="tabular-nums text-foreground">{c.eligible_orders} · مبيعات {egp(c.eligible_sales)}</span></li>
                        <li className="flex justify-between gap-3"><span>أوردرات لسه في الطريق</span><span className="tabular-nums text-foreground">{c.awaiting_orders}</span></li>
                        {c.returned > 0 && <li className="flex justify-between gap-3"><span>رجعت</span><span className="tabular-nums">{c.returned}</span></li>}
                        {c.cancelled > 0 && <li className="flex justify-between gap-3"><span>اتلغت</span><span className="tabular-nums">{c.cancelled}</span></li>}
                        {c.below_min > 0 && <li className="flex justify-between gap-3"><span>وصلت بس أقل من {egp(c.min_total)}</span><span className="tabular-nums">{c.below_min}</span></li>}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">
                        {c.rate !== null ? `${c.rate}% ` : ""}من قيمة الأوردر من غير الشحن، على الأوردرات اللي {egp(c.min_total)} أو أكتر ووصلت للعميل. اللي في الطريق بيتحسب لما يوصل.
                    </p>
                </div>
            )}

            <div className="rounded-2xl border bg-card p-4">
                <h3 className="mb-2 text-sm font-medium">الخصومات وأسبابها</h3>
                {pay === "missing" ? (
                    <p className="text-sm text-muted-foreground">قايمة الخصومات هتظهر هنا قريب.</p>
                ) : deductions.length === 0 ? (
                    <p className="text-sm text-emerald-700 dark:text-emerald-400">مفيش خصومات الشهر ده.</p>
                ) : (
                    <ul className="divide-y">
                        {list.map((d, i) => (
                            <li key={i} className="flex items-start justify-between gap-3 py-2.5">
                                <div className="min-w-0">
                                    <p className="text-sm">{reasonText(d.reason || "خصم")}</p>
                                    <p className="text-xs text-muted-foreground">{fmtShort(d.entry_date)}{d.automatic ? " · من التارجت اليومي" : ""}</p>
                                </div>
                                <span className="shrink-0 font-semibold tabular-nums text-rose-700 dark:text-rose-400">{egp(d.amount)}</span>
                            </li>
                        ))}
                    </ul>
                )}
                {deductions.length > 5 && (
                    <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setShowAll(v => !v)}>{showAll ? "اعرض أقل" : `اعرض الكل (${deductions.length})`}</Button>
                )}
                {bonuses.length > 0 && (
                    <p className="mt-3 border-t pt-3 text-sm text-emerald-700 dark:text-emerald-400">
                        بونص الشهر ده: {egp(bonuses.reduce((s, b) => s + b.amount, 0))}
                    </p>
                )}
            </div>

            {measured && past.length > 0 && (
                <div className="rounded-2xl border bg-card p-4">
                    <h3 className="mb-2 text-sm font-medium">الشيفتات اللي فاتت</h3>
                    <ul className="divide-y">
                        {past.slice(0, 10).map(p => <PastRow key={p.id} p={p} />)}
                    </ul>
                </div>
            )}
        </section>
    );
}

function Stat({ label, value, sub, tone }: { label: string; value: number | null; sub: string; tone: string }) {
    return (
        <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={cn("mt-1 whitespace-nowrap text-[15px] font-bold tabular-nums sm:text-lg", tone)}>{value === null ? "—" : egp(Math.round(value))}</p>
            <p className="text-[11px] text-muted-foreground">{sub}</p>
        </div>
    );
}

function PastRow({ p }: { p: PastCard }) {
    const [open, setOpen] = useState(false);
    const missed = [
        ...p.missed.map(k => METRIC_LABEL[k]),
        ...((p.attendance?.items || []).map(i => ATTENDANCE_LABEL[i.key])),
    ];
    return (
        <li className="py-2.5">
            <button type="button" className="flex w-full items-center justify-between gap-3 text-start" onClick={() => setOpen(o => !o)} aria-expanded={open}>
                <span className="min-w-0">
                    <span className="block text-sm font-medium">{fmtShort(p.work_date)}</span>
                    <span className={cn("block truncate text-xs", missed.length ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400")}>
                        {p.status === "leave" ? "إجازة" : p.status === "absent" ? "مفيش نشاط" : missed.length ? `فاتك: ${missed.join("، ")}` : "حققت كل حاجة"}
                    </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                    {Number(p.deduction) > 0 && <span className={cn("text-sm font-semibold tabular-nums", p.adjustment_id ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground line-through")}>{egp(Number(p.deduction))}</span>}
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
                </span>
            </button>
            {open && p.status === "evaluated" && (
                <ul className="mt-2 space-y-1.5 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                    {(p.metrics || []).map(m => <li key={m.key}><span className="font-medium text-foreground">{METRIC_LABEL[m.key]}:</span> {m.detail}</li>)}
                    {(p.attendance?.items || []).map(i => <li key={i.key}><span className="font-medium text-foreground">{ATTENDANCE_LABEL[i.key]}:</span> {i.detail}</li>)}
                    {Number(p.deduction) > 0 && !p.adjustment_id && <li>الخصم ده ماتسجلش في المرتب{p.payroll_note ? ` (${p.payroll_note})` : " (الإدارة لغته)"}.</li>}
                </ul>
            )}
            {open && p.status !== "evaluated" && <p className="mt-2 text-xs text-muted-foreground">{p.status === "leave" ? "إجازة معتمدة، مفيش تارجت." : "مفيش أي نشاط ولا حضور في الشيفت ده. الإدارة هتراجعه."}</p>}
        </li>
    );
}

// ---------------------------------------------------------------------------
// The rules, in the numbers the owner set
// ---------------------------------------------------------------------------

function HowItWorks({ settings: s }: { settings: TargetSettings }) {
    const [open, setOpen] = useState(false);
    const lines = useMemo(() => {
        const out: string[] = [];
        out.push(`سرعة التأكيد: أي أوردر من المتجر لازم يتشغل عليه خلال ${s.confirm_within_hours} ساعة من وصوله. «يتشغل عليه» يعني يتأكد، أو يتلغى، أو تسجّل عليه محاولة اتصال (مابيردش، كلّمني بعدين...). المطلوب منك نصيبك من الأوردرات اللي وصلت في شيفتك + اللي كانت مستنية من آخر ${s.backlog_days} يوم.`
            + (s.deduct_confirm > 0 ? ` لو قلّيت عن نصيبك: خصم ${egp(s.deduct_confirm)}.` : ""));
        if (s.min_message_orders > 0) out.push(`أوردرات الرسايل: ${s.min_message_orders} أوردر على الأقل في الشيفت من الرسايل (فيسبوك، واتساب، إنستجرام) باسمك.` + (s.deduct_messages > 0 ? ` خصم ${egp(s.deduct_messages)} لو أقل.` : ""));
        out.push(`متابعة الشحن: كل شحنة متعطلة (Returning، Hold to redeliver، أو Shipped من ${s.stale_days} أيام) لازم تتتابع كل ${s.followup_every_days} يوم من صفحة مشاكل الشحن، وعليك نصيبك منها.` + (s.deduct_followups > 0 ? ` خصم ${egp(s.deduct_followups)} لو أقل.` : ""));
        if (s.min_confirm_rate > 0) out.push(`نسبة التأكيد: اللي اتأكد ÷ (اللي اتأكد + اللي اتلغى) لازم ${s.min_confirm_rate}% على الأقل، لو قفلت ${s.min_handled_for_rate} أوردر أو أكتر.` + (s.deduct_rate > 0 ? ` خصم ${egp(s.deduct_rate)} لو أقل.` : ""));
        const att: string[] = [];
        if (s.deduct_late > 0) att.push(`التأخير ${egp(s.deduct_late)}`);
        if (s.deduct_early > 0) att.push(`الخروج بدري ${egp(s.deduct_early)}`);
        if (s.deduct_no_clockout > 0) att.push(`نسيان الانصراف ${egp(s.deduct_no_clockout)}`);
        if (s.deduct_no_clockin > 0) att.push(`الشغل من غير تسجيل حضور ${egp(s.deduct_no_clockin)}`);
        if (att.length) out.push(`الحضور: سجّل حضور وانصراف من الصفحة دي. فيه سماح ${s.grace_minutes} دقيقة، وبعدها الخصم: ${att.join("، ")}.`);
        if (s.monthly_cap) out.push(`أقصى خصم في الشهر ${egp(s.monthly_cap)}.`);
        return out;
    }, [s]);
    return (
        <section className="rounded-2xl border bg-card">
            <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-start" onClick={() => setOpen(o => !o)} aria-expanded={open}>
                <span className="font-medium">التارجت والخصم بيتحسبوا إزاي؟</span>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
            </button>
            {open && (
                <ul className="list-disc space-y-2 px-4 pb-4 ps-8 text-sm leading-relaxed text-muted-foreground">
                    {lines.map(l => <li key={l}>{l}</li>)}
                </ul>
            )}
        </section>
    );
}
