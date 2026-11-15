"use client";

import { useEffect, useState } from "react";
import { teamName } from "@/lib/team-names";
import {
    Ban, CalendarClock, Wallet, CircleHelp, History, Loader2, MessageCircle, PencilLine, PhoneMissed, PhoneOff, Tag, ThumbsDown,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { callLaterChoices, clockLabel } from "@/lib/orders/confirm-queue";

/**
 * Confirmation attempts on a store order that is still Waiting: the reasons a
 * moderator can give for a call that did not confirm it, the badge that says
 * the dialog that records a failed attempt, and claiming an order.
 * Backed by 20261006_confirmation_attempts.sql and 20261119_confirm_queue.sql.
 */

export type AttemptReason =
    | "no_answer" | "phone_off" | "wrong_number" | "call_later" | "thinking"
    | "whatsapp_pending" | "wants_changes" | "price" | "other"
    // 20261120_confirm_flow.sql
    | "no_reply" | "deposit_pending";

export const ATTEMPT_REASONS: { key: AttemptReason; label: string; icon: React.ComponentType<{ className?: string }>; hint?: string }[] = [
    { key: "no_answer", label: "مابيردش", icon: PhoneMissed },
    { key: "phone_off", label: "الموبايل مقفول / خارج الخدمة", icon: PhoneOff },
    { key: "wrong_number", label: "الرقم غلط", icon: Ban },
    { key: "call_later", label: "طلب نكلمه وقت تاني", icon: CalendarClock, hint: "اكتب الميعاد اللي قال عليه" },
    { key: "whatsapp_pending", label: "مردش، وبعتناله واتساب", icon: MessageCircle },
    { key: "no_reply", label: "مردش ولا اتصال ولا واتساب", icon: PhoneMissed },
    { key: "deposit_pending", label: "وافق وهيحوّل الديبوزت", icon: Wallet, hint: "هيحوّل إمتى وعلى أنهي حساب" },
    { key: "thinking", label: "لسه بيفكر / متردد", icon: CircleHelp },
    { key: "wants_changes", label: "عايز يغيّر في الطلب", icon: PencilLine, hint: "اكتب التعديل المطلوب" },
    { key: "price", label: "معترض على السعر أو الشحن", icon: Tag },
    { key: "other", label: "سبب تاني", icon: ThumbsDown, hint: "لازم تكتب السبب" },
];

/** «حاجة تانية»: what can happen on a call besides confirm, no answer and cancel. */
export const OTHER_OUTCOMES: AttemptReason[] = ["call_later", "deposit_pending", "thinking", "wants_changes", "price", "wrong_number", "other"];

/** Before 20261120_confirm_flow.sql the new reasons are refused; the nearest old one. */
const ATTEMPT_FALLBACK: Partial<Record<AttemptReason, AttemptReason>> = { no_reply: "no_answer", deposit_pending: "call_later" };

export const reasonLabel = (r: string | null | undefined) => ATTEMPT_REASONS.find(x => x.key === r)?.label ?? "محاولة فشلت";

export interface AttemptSummary {
    confirm_attempts?: number | null;
    last_attempt_at?: string | null;
    last_attempt_reason?: string | null;
    last_attempt_note?: string | null;
    last_attempt_by?: string | null;
    // 20261119_confirm_queue.sql
    next_attempt_at?: string | null;
    claimed_by?: string | null;
    claimed_at?: string | null;
    // 20261120_confirm_flow.sql
    confirm_rounds?: number | null;
    whatsapp_sent_by?: string | null;
    whatsapp_sent_at?: string | null;
}

export function minutesSince(iso: string | null | undefined) {
    return iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)) : null;
}

export function ago(iso: string | null | undefined) {
    const m = minutesSince(iso);
    if (m === null) return "";
    if (m < 1) return "دلوقتي";
    if (m < 60) return `من ${m} دقيقة`;
    const h = Math.round(m / 60);
    if (h < 24) return `من ${h} ساعة`;
    const d = Math.round(h / 24);
    return d === 1 ? "من يوم" : `من ${d} أيام`;
}

const who = (email: string | null | undefined) => teamName(email);

const isMissingFn = (e: { code?: string; message?: string }) =>
    e.code === "PGRST202" || /could not find|does not exist/i.test(e.message || "");

/**
 * Record a call that did not confirm the order. With the queue migration the
 * database also sets when to call again; before it, the same call without
 * p_next_at still records the attempt.
 */
export async function recordAttempt(orderId: string, reason: AttemptReason, note: string | null, nextAt?: number | null)
    : Promise<{ ok: true; gone: boolean; summary: AttemptSummary } | { ok: false; message: string }> {
    const args = { p_order_id: orderId, p_reason: reason, p_note: note };
    let { data, error } = await supabase.rpc("record_confirmation_attempt", { ...args, p_next_at: nextAt ? new Date(nextAt).toISOString() : null });
    if (error && isMissingFn(error)) ({ data, error } = await supabase.rpc("record_confirmation_attempt", args));
    const older = ATTEMPT_FALLBACK[reason];
    if (error && older && (error.code === "23514" || /check constraint/i.test(error.message || ""))) {
        const label = ATTEMPT_REASONS.find(r => r.key === reason)?.label;
        ({ data, error } = await supabase.rpc("record_confirmation_attempt", {
            ...args, p_reason: older, p_note: [label, note].filter(Boolean).join(" — "), p_next_at: nextAt ? new Date(nextAt).toISOString() : null,
        }));
    }
    if (error) {
        console.error("record_confirmation_attempt failed:", error);
        return { ok: false, message: isMissingFn(error) ? "محتاج تشغّل migration 20261119_confirm_queue.sql الأول." : /[؀-ۿ]/.test(error.message) ? error.message : "ماتسجلتش، جرّب تاني." };
    }
    const r = data as AttemptSummary & { status: string };
    return { ok: true, gone: r?.status === "gone", summary: r };
}

/**
 * "I'm calling this one." Resolves to who holds the order afterwards; null
 * when claiming is not available yet (migration not run) or failed, which
 * never stops the call itself.
 */
export async function claimOrder(orderId: string, opts: { force?: boolean; release?: boolean } = {})
    : Promise<{ status: "done" | "taken" | "gone"; claimed_by: string | null; claimed_at: string | null } | null> {
    const { data, error } = await supabase.rpc("claim_order", { p_order_id: orderId, p_force: !!opts.force, p_release: !!opts.release });
    if (error) return null;
    return data as { status: "done" | "taken" | "gone"; claimed_by: string | null; claimed_at: string | null };
}

/** The last attempt, in one line. */
export function LastAttempt({ order }: { order: AttemptSummary }) {
    const n = order.confirm_attempts ?? 0;
    if (!n) return null;
    const R = ATTEMPT_REASONS.find(r => r.key === order.last_attempt_reason)?.icon ?? PhoneMissed;
    return (
        <div className="flex items-start gap-2 text-[15px]" dir="rtl">
            <R className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <p className="min-w-0">
                <span className="font-semibold">{reasonLabel(order.last_attempt_reason)}</span>
                {order.last_attempt_note && <span> — {order.last_attempt_note}</span>}
                <span className="text-muted-foreground"> ({[order.last_attempt_by ? who(order.last_attempt_by) : null, ago(order.last_attempt_at)].filter(Boolean).join("، ")})</span>
            </p>
        </div>
    );
}

/** Every attempt on one order, loaded when asked for. */
export function AttemptHistory({ orderId, count }: { orderId: string; count: number }) {
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<{ reason: string; note: string | null; attempted_by: string | null; created_at: string }[] | null>(null);

    useEffect(() => {
        if (!open || rows) return;
        supabase.from("order_confirmation_attempts").select("reason, note, attempted_by, created_at")
            .eq("order_id", orderId).order("created_at", { ascending: false })
            .then(({ data }) => setRows(data || []));
    }, [open, rows, orderId]);

    if (count < 2) return null;
    return (
        <div dir="rtl" className="text-sm">
            <button type="button" onClick={() => setOpen(o => !o)} className="flex min-h-9 items-center gap-1.5 font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                <History className="h-4 w-4" />{open ? "اخفي المحاولات" : `كل المحاولات (${count})`}
            </button>
            {open && (
                <div className="mt-1.5 space-y-1 border-s-2 ps-3">
                    {!rows ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : rows.map((r, i) => (
                        <div key={i}>
                            <span className="font-medium">{reasonLabel(r.reason)}</span>
                            {r.note && <span> — {r.note}</span>}
                            <span className="text-muted-foreground"> · {ago(r.created_at)}{r.attempted_by ? ` · ${who(r.attempted_by)}` : ""}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * «حاجة تانية»: what else can happen on a call — a time the customer asked
 * for, a deposit on its way, a wrong number... One must be picked (and for
 * "other", written) so whoever tries next knows what happened. None of them
 * moves the order a step on; the time picked brings it back.
 */
export function FailedAttemptDialog({ orderId, customerName, attempts, open, onOpenChange, onSaved, onGone }: {
    orderId: string;
    customerName: string;
    attempts: number;
    open: boolean;
    onOpenChange: (o: boolean) => void;
    onSaved: (summary: AttemptSummary) => void;
    onGone: () => void;
}) {
    const [reason, setReason] = useState<AttemptReason | null>(null);
    const [note, setNote] = useState("");
    const [laterAt, setLaterAt] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const needsNote = reason === "other";
    const hint = ATTEMPT_REASONS.find(r => r.key === reason)?.hint;
    const [choices] = useState(() => callLaterChoices());

    const save = async () => {
        if (!reason) { toast.error("اختار إيه اللي حصل"); return; }
        if (needsNote && !note.trim()) { toast.error("اكتب السبب"); return; }
        setSaving(true);
        const at = reason === "call_later" || reason === "deposit_pending" ? laterAt : null;
        const text = note.trim() || (at ? `${reason === "deposit_pending" ? "نشوف الديبوزت" : "نكلمه"} ${clockLabel(at)}` : null);
        const r = await recordAttempt(orderId, reason, text, at);
        setSaving(false);
        if (!r.ok) { toast.error(r.message); return; }
        if (r.gone) { onGone(); return; }
        onSaved(r.summary);
        setReason(null); setNote(""); setLaterAt(null);
    };

    return (
        <Dialog open={open} onOpenChange={o => { if (!saving) onOpenChange(o); }}>
            <DialogContent dir="rtl" className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>إيه اللي حصل؟ — {customerName}</DialogTitle>
                    <DialogDescription>المحاولة رقم {attempts + 1}. اختار اللي حصل في المكالمة.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {OTHER_OUTCOMES.map(k => ATTEMPT_REASONS.find(r => r.key === k)!).map(r => (
                        <button
                            key={r.key}
                            type="button"
                            onClick={() => { setReason(r.key); setLaterAt(null); }}
                            className={cn(
                                "flex min-h-12 items-center gap-2 rounded-lg border px-3 text-start text-sm transition-colors",
                                reason === r.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/60",
                            )}
                        >
                            <r.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span>{r.label}</span>
                        </button>
                    ))}
                </div>
                {(reason === "call_later" || reason === "deposit_pending") && (
                    <div className="grid grid-cols-2 gap-2">
                        {choices.map(c => (
                            <button key={c.at} type="button" onClick={() => setLaterAt(c.at)}
                                className={cn("min-h-11 rounded-lg border px-2 text-sm font-medium",
                                    laterAt === c.at ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/60")}>
                                {c.label}
                            </button>
                        ))}
                    </div>
                )}
                <Textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={2}
                    placeholder={hint ?? "ملاحظة للي هيكلمه بعدك (اختياري)"}
                    className={cn(needsNote && !note.trim() && "border-amber-400")}
                />
                <DialogFooter>
                    <Button size="lg" className="h-12 w-full text-base sm:w-auto" onClick={save} disabled={saving || !reason || (needsNote && !note.trim())}>
                        {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}سجّل
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
