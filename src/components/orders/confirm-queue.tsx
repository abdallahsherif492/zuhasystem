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
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold text-white", other ? "bg-amber-500" : "bg-emerald-600")}>
            <PhoneCall className="h-3 w-3" />{other ? `${shortName(other)} بيكلّمه` : "انت بتكلّمه"}
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
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>خطوة {step} من 3 · {STEP_NAME[step]}</span>
                    <StepBar step={step} className="w-20" />
                </div>
                <p className="flex items-center gap-2 text-base font-semibold">
                    <CalendarClock className="h-5 w-5 shrink-0 text-muted-foreground" />
                    {order.last_attempt_reason === "deposit_pending" ? "نشوف الديبوزت" : "يرجع"} {dueLabel(at, now)}
                </p>
                <p className="text-sm text-muted-foreground">لو العميل كلّمك قبلها، تقدر تأكد أو تسجّل اللي حصل من تحت.</p>
                {children}
            </section>
        );
    }

    const { title, detail } = instructionFor(order, me, { missed }, now);
    return (
        <section dir="rtl" aria-label="المطلوب منك" className="mx-3 space-y-3 rounded-2xl bg-foreground p-4 text-background sm:mx-4 sm:p-5">
            <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs font-medium text-background/70">
                    <span>المطلوب منك · خطوة {step} من 3</span>
                    <span>{STEP_NAME[step]}</span>
                </div>
                <StepBar step={step} inverse />
            </div>
            <div className="space-y-1">
                <p className="text-lg font-bold leading-snug sm:text-xl">{title}</p>
                <p className="text-[15px] leading-relaxed text-background/80">{detail}</p>
            </div>
            {children}
        </section>
    );
}

function StepBar({ step, inverse, className }: { step: FlowStep; inverse?: boolean; className?: string }) {
    return (
        <div className={cn("flex gap-1", className)} aria-hidden>
            {[1, 2, 3].map(i => (
                <span key={i} className={cn("h-1 flex-1 rounded-full",
                    i <= step ? (inverse ? "bg-background" : "bg-foreground/60") : (inverse ? "bg-background/25" : "bg-muted"))} />
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
            <p className="text-xs font-medium text-muted-foreground">خد بالك</p>
            <ul className="space-y-1.5">
                {items.map(it => (
                    <li key={it.key} className={cn("text-sm", HEADS_UP_TONE[it.tone])}>
                        <div className="flex items-start gap-2">
                            <it.icon className="mt-0.5 h-4 w-4 shrink-0" />
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
    const big = "h-12 text-[15px] font-semibold [&_svg]:size-5";
    // Step 2 asks about the WhatsApp; if none was ever sent, this is the one.
    const noAnswer: { reason: AttemptReason; label: string } =
        step === 1 || !whatsappSent(order)
            ? { reason: "whatsapp_pending", label: "مردش، وبعتله واتساب" }
            : { reason: "no_reply", label: "مردش ولا اتصال ولا واتساب" };

    return (
        <div dir="rtl" className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">إيه اللي حصل؟</p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <Button onClick={onConfirm} disabled={!!busy}
                    className={cn(big, "col-span-2 h-14 bg-emerald-600 text-base text-white hover:bg-emerald-700 sm:h-12 sm:min-w-44 sm:flex-1")}>
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
