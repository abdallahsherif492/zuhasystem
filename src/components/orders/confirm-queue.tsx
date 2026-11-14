"use client";

import { useState } from "react";
import { CalendarClock, Check, ChevronLeft, Loader2, MoreHorizontal, PhoneCall, PhoneMissed, PhoneOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    QUEUE_TABS, callLaterChoices, claimedByOther, dueLabel, isMine, nextAttemptAt, queueStateOf, shortName,
    type QueueOrder, type QueueState,
} from "@/lib/orders/confirm-queue";
import { ago, type AttemptReason } from "@/components/orders/confirmation-attempts";

/** The queue's tabs: one per state, the count big enough to read at a glance. */
export function QueueTabs({ value, onChange, counts }: {
    value: QueueState;
    onChange: (v: QueueState) => void;
    counts: Record<QueueState, number>;
}) {
    return (
        <div dir="rtl" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {QUEUE_TABS.filter(t => t.key !== "old" || counts.old > 0 || value === "old").map(tab => {
                const active = value === tab.key;
                const n = counts[tab.key];
                return (
                    <button
                        key={tab.key}
                        type="button"
                        onClick={() => onChange(tab.key)}
                        className={cn(
                            "flex min-h-12 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors",
                            active ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted",
                        )}
                    >
                        <span>{tab.label}</span>
                        <span className={cn(
                            "min-w-7 rounded-full px-2 py-0.5 text-center text-sm font-bold tabular-nums",
                            active ? "bg-background/20" :
                                tab.key === "now" && n ? "bg-emerald-600 text-white" :
                                tab.key === "decide" && n ? "bg-red-600 text-white" : "bg-muted",
                        )}>{n}</span>
                    </button>
                );
            })}
        </div>
    );
}

const TONE: Record<QueueState, string> = {
    now: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
    scheduled: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
    customer: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300",
    decide: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
    old: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400",
};

/** Where the order stands, and who is on the phone with it. */
export function QueueStatus({ order, me, now }: { order: QueueOrder; me?: string | null; now: number }) {
    const st = queueStateOf(order, now);
    const n = order.confirm_attempts ?? 0;
    const at = nextAttemptAt(order);
    const text =
        st === "now" ? (n === 0 ? `جديد · ${ago(order.created_at)}` : `محاولة ${n + 1} · جاهز`) :
        st === "scheduled" ? `${order.last_attempt_reason === "call_later" ? "ميعاده" : "نكلّمه تاني"} ${at ? dueLabel(at, now) : ""}` :
        st === "customer" ? `مستني العميل · ${at ? dueLabel(at, now) : ""}` :
        st === "decide" ? (order.last_attempt_reason === "wrong_number" ? "الرقم غلط · محتاج قرار" : `${n} محاولات · محتاج قرار`) :
        `قديم · ${ago(order.created_at)}`;
    const other = claimedByOther(order, me, now);
    const mine = isMine(order, me, now);
    return (
        <div dir="rtl" className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", TONE[st])}>{text}</span>
            {other && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">
                    <PhoneCall className="h-3 w-3" />{shortName(other)} بيكلّمه
                </span>
            )}
            {mine && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-bold text-white">
                    <PhoneCall className="h-3 w-3" />انت بتكلّمه
                </span>
            )}
        </div>
    );
}

/**
 * The buttons under every card: confirm, the three things that happen most
 * on a call, everything else, and cancel. One tap records an attempt.
 */
export function QuickActions({ busy, onConfirm, onAttempt, onMore, onCancel }: {
    busy: AttemptReason | "confirm" | null;
    onConfirm: () => void;
    onAttempt: (reason: AttemptReason, nextAt?: number) => void;
    onMore: () => void;
    onCancel: () => void;
}) {
    const [laterOpen, setLaterOpen] = useState(false);
    const [choices, setChoices] = useState<{ label: string; at: number }[]>([]);
    const spin = (k: AttemptReason | "confirm") => busy === k && <Loader2 className="h-4 w-4 animate-spin" />;
    const big = "h-12 text-[15px] font-semibold [&_svg]:size-5";

    return (
        <div dir="rtl" className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
            <Button onClick={onConfirm} disabled={!!busy}
                className={cn(big, "col-span-3 h-14 bg-emerald-600 text-base text-white hover:bg-emerald-700 sm:h-12 sm:min-w-44 sm:flex-1")}>
                {spin("confirm") || <Check />}أكّد الأوردر
            </Button>
            <Button variant="outline" disabled={!!busy} onClick={() => onAttempt("no_answer")}
                className={cn(big, "border-orange-300 text-orange-800 hover:bg-orange-50 dark:border-orange-900 dark:text-orange-300 sm:min-w-32")}>
                {spin("no_answer") || <PhoneMissed />}مابيردش
            </Button>
            <Button variant="outline" disabled={!!busy} onClick={() => onAttempt("phone_off")}
                className={cn(big, "sm:min-w-32")}>
                {spin("phone_off") || <PhoneOff />}مقفول
            </Button>
            <Popover open={laterOpen} onOpenChange={o => { if (o) setChoices(callLaterChoices()); setLaterOpen(o); }}>
                <PopoverTrigger asChild>
                    <Button variant="outline" disabled={!!busy} className={cn(big, "border-sky-300 text-sky-800 hover:bg-sky-50 dark:border-sky-900 dark:text-sky-300 sm:min-w-32")}>
                        {spin("call_later") || <CalendarClock />}بعدين
                    </Button>
                </PopoverTrigger>
                <PopoverContent dir="rtl" align="center" className="w-60 p-1.5">
                    <p className="px-2 pb-1.5 pt-1 text-xs font-medium text-muted-foreground">نكلّمه إمتى؟</p>
                    {choices.map(c => (
                        <button key={c.at} type="button"
                            onClick={() => { setLaterOpen(false); onAttempt("call_later", c.at); }}
                            className="flex min-h-11 w-full items-center justify-between rounded-md px-3 text-sm font-medium hover:bg-muted">
                            {c.label}<ChevronLeft className="h-4 w-4 text-muted-foreground" />
                        </button>
                    ))}
                </PopoverContent>
            </Popover>
            <Button variant="outline" disabled={!!busy} onClick={onMore} className={cn(big, "col-span-2 sm:min-w-28")}>
                <MoreHorizontal />سبب تاني
            </Button>
            <Button variant="outline" disabled={!!busy} onClick={onCancel}
                className={cn(big, "border-destructive/50 text-destructive hover:bg-destructive/10 sm:min-w-24")}>
                إلغاء
            </Button>
        </div>
    );
}
