"use client";

import { AlertTriangle, Check, Loader2, MessageCircle, MoreHorizontal, Phone, PhoneCall, PhoneMissed, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    QUEUE_TABS, claimedByOther, dueLabel, instructionFor, isMine, nextAttemptAt, queueStateOf, shortName, stepOf, whatsappSent,
    type FlowStep, type QueueOrder, type QueueState,
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

const TONE: Record<QueueState, string> = {
    new: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
    whatsapp: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
    last: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
    scheduled: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
};

const STEP_LABEL: Record<FlowStep, string> = { 1: "خطوة 1 · جديد", 2: "خطوة 2 · اتبعتله واتساب", 3: "خطوة 3 · آخر فرصة" };
const STEP_TONE: Record<FlowStep, QueueState> = { 1: "new", 2: "whatsapp", 3: "last" };

/** Where the order stands, and who is on the phone with it. */
export function QueueStatus({ order, me, now }: { order: QueueOrder; me?: string | null; now: number }) {
    const st = queueStateOf(order, now);
    const at = nextAttemptAt(order);
    // A scheduled order shows the step it will come back at.
    const step = stepOf(order, st === "scheduled" ? at : now);
    const due = st === "scheduled"
        ? `${order.last_attempt_reason === "call_later" ? "ميعاده" : order.last_attempt_reason === "deposit_pending" ? "نشوف الديبوزت" : "يرجع"} ${dueLabel(at, now)}`
        : (order.confirm_attempts ?? 0) === 0 ? ago(order.created_at) : `عليه الدور ${ago(new Date(at).toISOString())}`;
    const other = claimedByOther(order, me, now);
    const mine = isMine(order, me, now);
    return (
        <div dir="rtl" className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", TONE[STEP_TONE[step]])}>{STEP_LABEL[step]}</span>
            <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", st === "scheduled" ? TONE.scheduled : "border-transparent text-muted-foreground")}>{due}</span>
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

/** What to do now, said plainly at the top of the card. */
export function FlowInstruction({ order, me, missed, now }: { order: QueueOrder; me?: string | null; missed?: boolean; now: number }) {
    const step = stepOf(order, now);
    const Icon = step === 1 ? Phone : step === 2 ? MessageCircle : AlertTriangle;
    return (
        <div dir="rtl" className={cn("flex items-start gap-2.5 rounded-xl border p-3 text-[15px] font-medium leading-relaxed", TONE[STEP_TONE[step]])}>
            <Icon className="mt-0.5 h-5 w-5 shrink-0" />
            <p>{instructionFor(order, me, { missed }, now)}</p>
        </div>
    );
}

/**
 * The buttons under every card, by step. Step 1 and 2: confirm, no answer,
 * the customer cancelled. Step 3: confirm or cancel. «حاجة تانية» on every
 * step for anything else the customer said.
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
    const step = stepOf(order, now);
    const spin = (k: AttemptReason | "confirm") => busy === k && <Loader2 className="h-4 w-4 animate-spin" />;
    const big = "h-12 text-[15px] font-semibold [&_svg]:size-5";
    // Step 2 asks about the WhatsApp; if none was ever sent, this is the one.
    const noAnswer: { reason: AttemptReason; label: string } =
        step === 1 || !whatsappSent(order)
            ? { reason: "whatsapp_pending", label: "مردش، وبعتله واتساب" }
            : { reason: "no_reply", label: "مردش ولا اتصال ولا واتساب" };

    return (
        <div dir="rtl" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button onClick={onConfirm} disabled={!!busy}
                className={cn(big, "col-span-2 h-14 bg-emerald-600 text-base text-white hover:bg-emerald-700 sm:h-12 sm:min-w-44 sm:flex-1")}>
                {spin("confirm") || <Check />}{step === 1 ? "العميل أكّد" : "أكّد الأوردر"}
            </Button>
            {step !== 3 && (
                <Button variant="outline" disabled={!!busy} onClick={() => onAttempt(noAnswer.reason)}
                    className={cn(big, "col-span-2 border-sky-300 text-sky-800 hover:bg-sky-50 dark:border-sky-900 dark:text-sky-300 sm:min-w-52")}>
                    {spin(noAnswer.reason) || (noAnswer.reason === "whatsapp_pending" ? <MessageCircle /> : <PhoneMissed />)}{noAnswer.label}
                </Button>
            )}
            <Button variant="outline" disabled={!!busy} onClick={onCancel}
                className={cn(big, "border-destructive/50 text-destructive hover:bg-destructive/10 sm:min-w-36", step === 3 && "col-span-2 sm:flex-1")}>
                {spin("no_reply") || <X />}{step === 3 ? "الغي الأوردر" : "ردّ ولغى"}
            </Button>
            <Button variant="outline" disabled={!!busy} onClick={onOther} className={cn(big, step === 3 && "col-span-2", "sm:min-w-32")}>
                <MoreHorizontal />حاجة تانية
            </Button>
        </div>
    );
}
