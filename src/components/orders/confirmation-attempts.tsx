"use client";

import { useEffect, useState } from "react";
import {
    Ban, CalendarClock, CircleHelp, History, Loader2, MessageCircle, PencilLine, PhoneMissed, PhoneOff, Tag, ThumbsDown,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * Confirmation attempts on a store order that is still Waiting: the reasons a
 * moderator can give for a call that did not confirm it, the badge that says
 * where an order stands, and the dialog that records a failed attempt.
 * Backed by 20261006_confirmation_attempts.sql.
 */

export type AttemptReason =
    | "no_answer" | "phone_off" | "wrong_number" | "call_later" | "thinking"
    | "whatsapp_pending" | "wants_changes" | "price" | "other";

export const ATTEMPT_REASONS: { key: AttemptReason; label: string; icon: React.ComponentType<{ className?: string }>; hint?: string }[] = [
    { key: "no_answer", label: "مابيردش", icon: PhoneMissed },
    { key: "phone_off", label: "الموبايل مقفول / خارج الخدمة", icon: PhoneOff },
    { key: "wrong_number", label: "الرقم غلط", icon: Ban },
    { key: "call_later", label: "طلب نكلمه وقت تاني", icon: CalendarClock, hint: "اكتب الميعاد اللي قال عليه" },
    { key: "whatsapp_pending", label: "بعتناله واتساب ومستنيين رده", icon: MessageCircle },
    { key: "thinking", label: "لسه بيفكر / متردد", icon: CircleHelp },
    { key: "wants_changes", label: "عايز يغيّر في الطلب", icon: PencilLine, hint: "اكتب التعديل المطلوب" },
    { key: "price", label: "معترض على السعر أو الشحن", icon: Tag },
    { key: "other", label: "سبب تاني", icon: ThumbsDown, hint: "لازم تكتب السبب" },
];

export const reasonLabel = (r: string | null | undefined) => ATTEMPT_REASONS.find(x => x.key === r)?.label ?? "محاولة فشلت";

export interface AttemptSummary {
    confirm_attempts?: number | null;
    last_attempt_at?: string | null;
    last_attempt_reason?: string | null;
    last_attempt_note?: string | null;
    last_attempt_by?: string | null;
}

export type ConfirmStage = "new" | "retry";
export const stageOf = (o: AttemptSummary): ConfirmStage => ((o.confirm_attempts ?? 0) > 0 ? "retry" : "new");

/** An hour after the last try, an order is due to be called again. */
export const RETRY_AFTER_MIN = 60;
/** From this many failed attempts, cancelling is suggested. */
export const SUGGEST_CANCEL_AT = 3;

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

const who = (email: string | null | undefined) => (email ? email.split("@")[0] : "");

/** Where a Waiting order stands, at the top of its card. */
export function AttemptBadge({ order }: { order: AttemptSummary }) {
    const n = order.confirm_attempts ?? 0;
    if (n === 0) {
        return <span dir="rtl" className="rounded-full border border-yellow-200 bg-yellow-50 px-2.5 py-0.5 text-xs font-medium text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-300">جديد — محدش كلّمه لسه</span>;
    }
    const due = (minutesSince(order.last_attempt_at) ?? 0) >= RETRY_AFTER_MIN;
    return (
        <span dir="rtl" className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs font-medium",
            n >= SUGGEST_CANCEL_AT ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                : "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300",
        )}>
            {n === 1 ? "محاولة فشلت" : `${n} محاولات فشلت`}{due ? " · جاهز تتصل تاني" : ""}
        </span>
    );
}

/** The last attempt, in one line, for orders on the retry list. */
export function LastAttempt({ order }: { order: AttemptSummary }) {
    if (!(order.confirm_attempts ?? 0)) return null;
    const n = order.confirm_attempts ?? 0;
    const R = ATTEMPT_REASONS.find(r => r.key === order.last_attempt_reason)?.icon ?? PhoneMissed;
    return (
        <div className={cn(
            "flex flex-wrap items-start gap-x-2 gap-y-1 rounded-md border p-2.5 text-sm",
            n >= SUGGEST_CANCEL_AT ? "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20" : "border-orange-200 bg-orange-50/60 dark:border-orange-900 dark:bg-orange-950/20",
        )} dir="rtl">
            <R className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
                <div>
                    <span className="font-semibold">{reasonLabel(order.last_attempt_reason)}</span>
                    {order.last_attempt_note && <span> — {order.last_attempt_note}</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                    آخر محاولة {ago(order.last_attempt_at)}{order.last_attempt_by ? ` · ${who(order.last_attempt_by)}` : ""}
                </div>
                {n >= SUGGEST_CANCEL_AT && (
                    <div className="mt-1 text-xs font-medium text-red-700 dark:text-red-300">
                        {n} محاولات من غير تأكيد — لو العميل مش هيرد، الأفضل تلغي الأوردر.
                    </div>
                )}
            </div>
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
        <div dir="rtl" className="text-xs">
            <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <History className="h-3.5 w-3.5" />{open ? "اخفي المحاولات" : `كل المحاولات (${count})`}
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
 * Record a call that did not confirm the order. A reason must be picked —
 * and for "other", written — so whoever tries next knows what happened.
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
    const [saving, setSaving] = useState(false);
    const needsNote = reason === "other";
    const hint = ATTEMPT_REASONS.find(r => r.key === reason)?.hint;

    const save = async () => {
        if (!reason) { toast.error("اختار سبب فشل التأكيد"); return; }
        if (needsNote && !note.trim()) { toast.error("اكتب السبب"); return; }
        setSaving(true);
        const { data, error } = await supabase.rpc("record_confirmation_attempt", { p_order_id: orderId, p_reason: reason, p_note: note.trim() || null });
        setSaving(false);
        if (error) {
            console.error("record_confirmation_attempt failed:", error);
            const missing = error.code === "PGRST202" || /could not find|does not exist/i.test(error.message);
            toast.error(missing ? "محتاج تشغّل migration 20261006_confirmation_attempts.sql الأول." : /[؀-ۿ]/.test(error.message) ? error.message : "ماتسجلتش، جرّب تاني.");
            return;
        }
        const r = data as AttemptSummary & { status: string };
        if (r?.status === "gone") { onGone(); return; }
        onSaved(r);
        setReason(null); setNote("");
    };

    return (
        <Dialog open={open} onOpenChange={o => { if (!saving) onOpenChange(o); }}>
            <DialogContent dir="rtl" className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>ماتأكدش — {customerName}</DialogTitle>
                    <DialogDescription>
                        {attempts > 0
                            ? `دي المحاولة رقم ${attempts + 1}. اختار إيه اللي حصل عشان اللي هيكلمه بعدك يبقى عارف.`
                            : "اختار إيه اللي حصل، والأوردر هيروح لتاب \"إعادة المحاولة\" عشان أي حد يكمّل عليه."}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {ATTEMPT_REASONS.map(r => (
                        <button
                            key={r.key}
                            type="button"
                            onClick={() => setReason(r.key)}
                            className={cn(
                                "flex items-center gap-2 rounded-lg border p-2.5 text-start text-sm transition-colors",
                                reason === r.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/60",
                            )}
                        >
                            <r.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span>{r.label}</span>
                        </button>
                    ))}
                </div>
                <Textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={2}
                    placeholder={hint ?? "ملاحظة للي هيكلمه بعدك (اختياري)"}
                    className={cn(needsNote && !note.trim() && "border-amber-400")}
                />
                <DialogFooter>
                    <Button onClick={save} disabled={saving || !reason || (needsNote && !note.trim())}>
                        {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}سجّل المحاولة
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** The tabs over the list: new orders, orders to try again, everything. */
export function ConfirmTabs({ value, onChange, counts }: {
    value: ConfirmStage | "all";
    onChange: (v: ConfirmStage | "all") => void;
    counts: { new: number; retry: number; due: number; all: number };
}) {
    const tabs: { key: ConfirmStage | "all"; label: string; sub: string; count: number }[] = [
        { key: "new", label: "جديدة", sub: "محدش كلّمها لسه", count: counts.new },
        { key: "retry", label: "إعادة المحاولة", sub: counts.due ? `${counts.due} جاهزين تتصل تاني` : "اتكلمت ومتأكدتش", count: counts.retry },
        { key: "all", label: "الكل", sub: "كل الويتينج", count: counts.all },
    ];
    return (
        <div dir="rtl" className="grid grid-cols-3 gap-1 rounded-xl border bg-muted/50 p-1">
            {tabs.map(tab => (
                <button
                    key={tab.key}
                    type="button"
                    onClick={() => onChange(tab.key)}
                    className={cn(
                        "rounded-lg px-2 py-2 text-start transition-colors sm:px-3",
                        value === tab.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                >
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{tab.label}</span>
                        <span className={cn(
                            "rounded-full px-2 text-xs font-bold tabular-nums",
                            tab.key === "retry" && tab.count ? "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200" : "bg-muted text-foreground",
                        )}>{tab.count}</span>
                    </div>
                    <div className="mt-0.5 hidden truncate text-[11px] sm:block">{tab.sub}</div>
                </button>
            ))}
        </div>
    );
}
