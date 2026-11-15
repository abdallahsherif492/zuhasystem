"use client";

import { useState } from "react";
import { CalendarClock, Check, Loader2, MessageCircle, MoreHorizontal, PhoneCall, PhoneMissed, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    QUEUE_TABS, STEP_NAME, claimedByOther, dueLabel, instructionFor, isMine, nextAttemptAt, queueStateOf, shortName, stepOf, whatsappSent,
    type FlowStep, type QueueOrder, type QueueState,
} from "@/lib/orders/confirm-queue";
import { type AttemptReason } from "@/components/orders/confirmation-attempts";

/** The queue's tabs: one per state, the count big enough to read at a glance. */
export function QueueTabs({ value, onChange, counts }: {
    value: QueueState;
    onChange: (v: QueueState) => void;
    counts: Record<QueueState, number>;
}) {
    return (
        <div dir="rtl" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {QUEUE_TABS.map(tab => {
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
                                tab.key === "new" && n ? "bg-emerald-600 text-white" :
                                tab.key === "whatsapp" && n ? "bg-sky-600 text-white" :
                                tab.key === "last" && n ? "bg-red-600 text-white" : "bg-muted",
                        )}>{n}</span>
                    </button>
                );
            })}
        </div>
    );
}

/** Who is on the phone with the order, if anyone. */
export function ClaimBadge({ order, me, now }: { order: QueueOrder; me?: string | null; now: number }) {
    const other = claimedByOther(order, me, now);
    const mine = isMine(order, me, now);
    if (!other && !mine) return null;
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold text-white", other ? "bg-amber-600" : "bg-emerald-600")}>
            <PhoneCall className="h-3.5 w-3.5" />{other ? `${shortName(other)} بيكلّمه` : "انت بتكلّمه"}
        </span>
    );
}

/**
 * What to do now: the one thing on the card that must not be missed. A dark
 * panel, unlike every warning (light, coloured), with the step it is at and
 * the buttons to do it with. An order whose time has not come gets a quiet
 * panel saying when it comes back.
 */
export function FlowInstruction({ order, me, missed, now, children }: {
    order: QueueOrder; me?: string | null; missed?: boolean; now: number;
    /** The call and WhatsApp buttons. */
    children?: React.ReactNode;
}) {
    const scheduled = queueStateOf(order, now) === "scheduled";
    const at = nextAttemptAt(order);
    const step = stepOf(order, scheduled ? at : now);

    if (scheduled) {
        return (
            <section dir="rtl" aria-label="ميعاد الأوردر" className="mx-3 space-y-3 rounded-2xl border border-dashed p-4 sm:mx-4">
                <div className="flex items-center justify-between gap-2 text-sm font-semibold text-muted-foreground">
                    <span>الخطوة {step} من 3: {STEP_NAME[step]}</span>
                    <StepBar step={step} className="w-20 opacity-60" />
                </div>
                <p className="flex items-center gap-2 text-lg font-bold">
                    <CalendarClock className="h-5 w-5 shrink-0 text-muted-foreground" />
                    {order.last_attempt_reason === "deposit_pending" ? "نشوف الديبوزت" : "يرجع"} {dueLabel(at, now)}
                </p>
                <p className="text-[15px] text-muted-foreground">لو العميل كلّمك قبل الميعاد، أكّد أو سجّل اللي حصل من الزراير تحت.</p>
                {children}
            </section>
        );
    }

    const { title, detail } = instructionFor(order, me, { missed }, now);
    return (
        <section dir="rtl" aria-label="المطلوب منك"
            className="mx-3 space-y-4 rounded-2xl border-2 border-indigo-200 bg-indigo-50/70 p-4 text-indigo-950 sm:mx-4 sm:p-5 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-50">
            <div className="flex items-center gap-3">
                <StepBar step={step} className="w-24 shrink-0" />
                <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">الخطوة {step} من 3: {STEP_NAME[step]}</span>
            </div>
            {/* What to do, then what to do if it does not work: a sequence, so numbered. */}
            <ol className="max-w-2xl space-y-2.5">
                {[title, detail].map((line, i) => (
                    <li key={i} className="flex items-start gap-3">
                        <span aria-hidden className={cn(
                            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums",
                            i === 0 ? "bg-indigo-600 text-white" : "border-2 border-indigo-300 text-indigo-700 dark:border-indigo-700 dark:text-indigo-300",
                        )}>{i + 1}</span>
                        <span className={i === 0 ? "text-xl font-bold leading-snug" : "pt-0.5 text-[17px] font-semibold leading-relaxed text-indigo-900 dark:text-indigo-100"}>{line}</span>
                    </li>
                ))}
            </ol>
            {children}
        </section>
    );
}

function StepBar({ step, className }: { step: FlowStep; className?: string }) {
    return (
        <div className={cn("flex gap-1", className)} aria-hidden>
            {[1, 2, 3].map(i => (
                <span key={i} className={cn("h-1.5 flex-1 rounded-full",
                    i <= step ? "bg-indigo-600 dark:bg-indigo-400" : "bg-indigo-200 dark:bg-indigo-900")} />
            ))}
        </div>
    );
}

export interface HeadsUpItem {
    key: string;
    tone: "danger" | "warning" | "info";
    icon: React.ComponentType<{ className?: string }>;
    text: React.ReactNode;
    /** Shown when the line is opened ("شوف"). */
    more?: React.ReactNode;
    moreLabel?: string;
}

const HEADS_UP_TONE = {
    danger: "text-red-700 dark:text-red-400",
    warning: "text-amber-700 dark:text-amber-400",
    info: "text-violet-700 dark:text-violet-300",
};

/** Everything to keep in mind on the call, one line each, under one heading. */
export function HeadsUp({ items }: { items: HeadsUpItem[] }) {
    const [open, setOpen] = useState<string | null>(null);
    if (!items.length) return null;
    return (
        <section dir="rtl" aria-label="خد بالك" className="space-y-1 px-4 sm:px-5">
            <h4 className="text-sm font-bold">خد بالك</h4>
            <ul className="space-y-2">
                {items.map(it => (
                    <li key={it.key} className={cn("text-[15px] font-medium", HEADS_UP_TONE[it.tone])}>
                        <div className="flex items-start gap-2">
                            <it.icon className="mt-0.5 h-5 w-5 shrink-0" />
                            <span className="min-w-0 flex-1 leading-relaxed">
                                {it.text}
                                {it.more && (
                                    <button type="button" onClick={() => setOpen(o => o === it.key ? null : it.key)}
                                        className="ms-1.5 font-semibold underline underline-offset-2">
                                        {open === it.key ? "اخفي" : it.moreLabel ?? "شوف"}
                                    </button>
                                )}
                            </span>
                        </div>
                        {it.more && open === it.key && <div className="mt-1.5">{it.more}</div>}
                    </li>
                ))}
            </ul>
        </section>
    );
}

/**
 * What happened on the call, by step. Steps 1 and 2: confirm, no answer, the
 * customer cancelled. Step 3: confirm or cancel. «حاجة تانية» on every step
 * for anything else the customer said.
 */
export function FlowActions({ order, now, busy, onConfirm, onAttempt, onCancel, onOther }: {
    order: QueueOrder;
    now: number;
    busy: AttemptReason | "confirm" | null;
    onConfirm: () => void;
    onAttempt: (reason: AttemptReason) => void;
    onCancel: () => void;
    onOther: () => void;
}) {
    const scheduled = queueStateOf(order, now) === "scheduled";
    const step = stepOf(order, scheduled ? nextAttemptAt(order) : now);
    const spin = (k: AttemptReason | "confirm") => busy === k && <Loader2 className="h-4 w-4 animate-spin" />;
    const big = "h-12 text-base font-semibold [&_svg]:size-5";
    // Step 2 asks about the WhatsApp; if none was ever sent, this is the one.
    const noAnswer: { reason: AttemptReason; label: string } =
        step === 1 || !whatsappSent(order)
            ? { reason: "whatsapp_pending", label: "مردش، وبعتله واتساب" }
            : { reason: "no_reply", label: "مردش ولا اتصال ولا واتساب" };

    return (
        <div dir="rtl" className="space-y-2">
            <h4 className="text-sm font-bold">إيه اللي حصل في المكالمة؟</h4>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <Button onClick={onConfirm} disabled={!!busy}
                    className={cn(big, "col-span-2 h-14 bg-emerald-600 text-lg text-white hover:bg-emerald-700 sm:min-w-44 sm:flex-1")}>
                    {spin("confirm") || <Check />}{step === 1 && !scheduled ? "العميل أكّد" : "أكّد الأوردر"}
                </Button>
                {step !== 3 && (
                    <Button variant="outline" disabled={!!busy} onClick={() => onAttempt(noAnswer.reason)}
                        className={cn(big, "col-span-2 bg-background sm:min-w-52")}>
                        {spin(noAnswer.reason) || (noAnswer.reason === "whatsapp_pending" ? <MessageCircle /> : <PhoneMissed />)}{noAnswer.label}
                    </Button>
                )}
                <Button variant="outline" disabled={!!busy} onClick={onCancel}
                    className={cn(big, "border-destructive/40 bg-background text-destructive hover:bg-destructive/10 hover:text-destructive sm:min-w-36")}>
                    {spin("no_reply") || <X />}{step === 3 ? "الغي الأوردر" : "ردّ ولغى"}
                </Button>
                <Button variant="outline" disabled={!!busy} onClick={onOther} className={cn(big, "bg-background sm:min-w-32")}>
                    <MoreHorizontal />حاجة تانية
                </Button>
            </div>
        </div>
    );
}
