"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import {
    METRIC_LABEL, dataSince, deductionFor, loadTargetData, recentDays, scoreDay, settingsOf,
    type MetricResult, type Scorecard, type TargetSettings,
} from "@/lib/hr/daily-targets";

const time = (iso: string) => new Date(iso).toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" });

/** One target: done against what was needed, and what missing it costs. */
export function MetricRow({ m, settings, live }: { m: MetricResult; settings: TargetSettings; live?: boolean }) {
    const cost = deductionFor(settings, m.key);
    const asked = m.target !== null;
    const pct = !asked ? 100 : m.key === "rate" ? Math.min(100, (m.done / Math.max(1, m.target!)) * 100) : m.target! <= 0 ? 100 : Math.min(100, (m.done / m.target!) * 100);
    const tone = !asked ? "text-muted-foreground" : m.met ? "text-emerald-700 dark:text-emerald-400" : live ? "text-amber-700 dark:text-amber-400" : "text-rose-700 dark:text-rose-400";
    const bar = !asked ? "bg-muted-foreground/30" : m.met ? "bg-emerald-500" : live ? "bg-amber-500" : "bg-rose-500";
    return (
        <li className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                    {asked ? (m.met ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : live ? <Clock className="h-4 w-4 text-amber-600" /> : <XCircle className="h-4 w-4 text-rose-600" />) : null}
                    {METRIC_LABEL[m.key]}
                </span>
                <span className={cn("text-sm font-semibold tabular-nums", tone)}>
                    {m.key === "rate" ? `${m.done}%` : m.done}
                    {asked && <span className="font-normal text-muted-foreground"> / {m.key === "rate" ? `${m.target}%` : m.target}</span>}
                </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full transition-[width]", bar)} style={{ width: `${pct}%` }} />
            </div>
            {m.parts && (
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">اتأكد {m.parts.confirmed}</span>
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">اتلغى {m.parts.cancelled}</span>
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">محاولة متسجلة {m.parts.attempted}</span>
                </div>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
                {m.detail}
                {asked && !m.met && cost > 0 && <span className="text-foreground"> {live ? "لو فضل كده: خصم" : "خصم"} {formatCurrency(cost)}.</span>}
            </p>
        </li>
    );
}

export function ScorecardCard({ card, settings, live, title }: { card: Scorecard; settings: TargetSettings; live?: boolean; title?: string }) {
    return (
        <div className="space-y-4 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{title ?? card.user_email}</h3>
                <span className="text-xs text-muted-foreground">
                    {live ? "الشيفت لسه شغال" : "الشيفت"} {time(card.shift_start)} – {time(card.shift_end)}
                    {card.status === "evaluated" && <> · نصيبك من الشغل {Math.round(card.share * 100)}%</>}
                </span>
            </div>
            {card.status === "leave" ? (
                <p className="text-sm text-muted-foreground">إجازة معتمدة، الشيفت ده مش بيتقاس.</p>
            ) : (
                <ul className="space-y-4">
                    {card.metrics.map(m => <MetricRow key={m.key} m={m} settings={settings} live={live} />)}
                </ul>
            )}
        </div>
    );
}

/**
 * Shifts running now, measured up to this minute: every included moderator
 * (a manager's view), or only `onlyEmail` (a moderator's own). Renders nothing
 * while targets are off or the person is not measured.
 */
export function LiveShifts({ businessId, onlyEmail, title }: { businessId: string; onlyEmail?: string; title?: string }) {
    const [state, setState] = useState<{ settings: TargetSettings; cards: Scorecard[] } | null | "off">(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const t = setInterval(() => setTick(n => n + 1), 5 * 60_000);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        let gone = false;
        (async () => {
            const { data, error } = await supabase.from("moderator_target_settings").select("*").eq("business_id", businessId).maybeSingle();
            const settings = settingsOf(data);
            const me = onlyEmail?.toLowerCase();
            if (error || !settings.enabled || (me && !settings.members.includes(me))) { if (!gone) setState("off"); return; }
            const days = recentDays();
            const loaded = await loadTargetData(supabase, businessId, dataSince(days, settings)).catch(() => null);
            if (!loaded || gone) { if (!gone) setState("off"); return; }
            const now = Date.now();
            const cards = days.flatMap(d => scoreDay(d, settings, loaded, now))
                .filter(c => Date.parse(c.shift_end) > now && (!me || c.user_email === me));
            setState({ settings, cards });
        })();
        return () => { gone = true; };
    }, [businessId, onlyEmail, tick]);

    if (state === "off") return null;
    if (state === null) return <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    return (
        <section className="space-y-3" dir="rtl">
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {state.cards.length === 0 ? (
                <p className="text-sm text-muted-foreground">{onlyEmail ? "مفيش شيفت شغال ليك دلوقتي." : "مفيش شيفتات شغالة دلوقتي."}</p>
            ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                    {state.cards.map(c => <ScorecardCard key={c.user_email + c.work_date} card={c} settings={state.settings} live title={onlyEmail ? "شيفتك النهارده لحد دلوقتي" : undefined} />)}
                </div>
            )}
            <p className="text-xs text-muted-foreground">بيتحدّث كل 5 دقايق. الكشف النهائي بيتعمل بعد الشيفت بنص ساعة.</p>
        </section>
    );
}

