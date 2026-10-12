"use client";

import { useState } from "react";
import {
    Ban, CalendarCheck, Check, CircleHelp, Clock, Loader2, MapPin, MessageCircle, Phone, PhoneCall,
    PhoneMissed, PhoneOff, Plane, ThumbsUp, Truck, XCircle, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { supabase } from "@/lib/supabase";
import { formatCurrency, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { ago, minutesSince } from "@/components/orders/confirmation-attempts";

/**
 * Following up orders stuck with the courier: what a call can end in, where
 * each order stands, what to do about it next, and the panel that records a
 * call. Used by /logistics/issues; backed by 20260825_shipping_issues.sql and
 * 20261007_shipping_followup_reasons.sql.
 */

export interface Issue {
    order_id: string;
    reference: string;
    status: string;
    bucket: "returning" | "hold" | "stale";
    customer_name: string | null;
    customer_phone: string | null;
    governorate: string | null;
    total_amount: number;
    courier: string | null;
    closed_by: string | null;
    days_stuck: number;
    followup_count: number;
    last_followup: string | null;
    last_outcome: string | null;
    next_action_at: string | null;
}

export interface Followup {
    id: string;
    outcome: string;
    note: string | null;
    next_action_at: string | null;
    created_by: string | null;
    created_at: string;
}

/**
 * Who the call got through to. The panel asks this first, then what was said:
 * two small questions instead of a dozen reasons at once.
 */
type Path = "customer" | "noanswer" | "courier" | "other";

/**
 * "reached" means the call got somewhere and the order now waits on the
 * delivery; "failed" means someone has to call again. A customer who answered
 * but asked to be called later still counts as failed — the order is not
 * settled — even though the panel lists it under "the customer answered".
 */
type OutcomeKind = "reached" | "failed";

interface Outcome {
    value: string;
    label: string;
    kind: OutcomeKind;
    path: Path;
    icon: React.ComponentType<{ className?: string }>;
    note?: { label: string; placeholder: string; required?: boolean };
    date?: { label: string; required?: boolean };
    /** Open the status choices straight away: this answer often changes it. */
    status?: boolean;
}

export const OUTCOMES: Outcome[] = [
    { value: "reached_rescheduled", label: "هيستلم في ميعاد اتفقنا عليه", kind: "reached", path: "customer", icon: CalendarCheck,
      date: { label: "ميعاد التسليم", required: true },
      note: { label: "تفاصيل للمندوب (اختياري)", placeholder: "وقت مناسب، علامة مميزة للعنوان..." } },
    { value: "reached_confirmed", label: "عايز الأوردر، من غير ميعاد محدد", kind: "reached", path: "customer", icon: ThumbsUp,
      note: { label: "ملاحظة (اختياري)", placeholder: "قال إيه بالظبط" } },
    { value: "call_later", label: "طلب نكلمه وقت تاني", kind: "failed", path: "customer", icon: Clock,
      date: { label: "نكلمه يوم إيه؟" },
      note: { label: "ملاحظة (اختياري)", placeholder: "الساعة كام، أو أي تفاصيل" } },
    { value: "address_issue", label: "العنوان غلط أو ناقص", kind: "failed", path: "customer", icon: MapPin,
      note: { label: "العنوان الصح", placeholder: "المحافظة، المنطقة، الشارع، رقم العمارة", required: true } },
    { value: "customer_away", label: "مسافر أو مش موجود دلوقتي", kind: "failed", path: "customer", icon: Plane,
      date: { label: "راجع إمتى؟" },
      note: { label: "ملاحظة (اختياري)", placeholder: "أي تفاصيل" } },
    { value: "customer_refused", label: "رفض الاستلام", kind: "failed", path: "customer", icon: XCircle, status: true,
      note: { label: "رفض ليه؟ (اختياري)", placeholder: "السعر، اتأخر، غيّر رأيه..." } },
    { value: "no_answer", label: "مابيردش", kind: "failed", path: "noanswer", icon: PhoneMissed },
    { value: "phone_off", label: "الموبايل مقفول أو خارج الخدمة", kind: "failed", path: "noanswer", icon: PhoneOff },
    { value: "wrong_number", label: "الرقم غلط", kind: "failed", path: "noanswer", icon: Ban,
      note: { label: "ملاحظة (اختياري)", placeholder: "لو لقيت رقم تاني للعميل اكتبه هنا" } },
    { value: "whatsapp_pending", label: "بعتله واتساب ومستني رده", kind: "failed", path: "noanswer", icon: MessageCircle },
    { value: "courier_contacted", label: "كلمت شركة الشحن", kind: "reached", path: "courier", icon: Truck, status: true,
      note: { label: "قالولك إيه؟", placeholder: "مثلاً: المندوب هيطلع بيه تاني يوم الخميس", required: true },
      date: { label: "نتابع معاهم تاني يوم" } },
    { value: "other", label: "حاجة تانية", kind: "failed", path: "other", icon: CircleHelp, status: true,
      note: { label: "حصل إيه؟", placeholder: "اكتب اللي حصل بالتفصيل", required: true },
      date: { label: "نتابع تاني يوم" } },
];

const outcomeOf = (v: string | null) => OUTCOMES.find(o => o.value === v);
export const outcomeLabel = (v: string | null) => outcomeOf(v)?.label || v || "—";
export const isFailed = (v: string | null) => outcomeOf(v)?.kind === "failed";

/**
 * How far following an order up has got — separate from its shipping status.
 *   new      nobody has called about it yet
 *   retry    the last call did not settle it: call again
 *   reached  the customer (or courier) was reached; waiting on the delivery
 */
export type Stage = "new" | "retry" | "reached";
export const stageOf = (r: { followup_count: number; last_outcome: string | null }): Stage =>
    Number(r.followup_count) === 0 ? "new" : isFailed(r.last_outcome) ? "retry" : "reached";

/** An hour after a failed call, the order is due to be tried again. */
export const RETRY_AFTER_MIN = 60;
/** From this many follow-ups that did not settle the order, a final return is suggested. */
export const SUGGEST_RETURN_AT = 3;

export const todayStr = () => format(new Date(), "yyyy-MM-dd");

/** "النهارده", "بكرة", or the weekday and date — how people say a delivery day. */
export function dayLabel(d: string) {
    const today = todayStr();
    if (d === today) return "النهارده";
    if (d === format(addDays(new Date(), 1), "yyyy-MM-dd")) return "بكرة";
    if (d === format(addDays(new Date(), -1), "yyyy-MM-dd")) return "إمبارح";
    return new Date(`${d}T12:00:00`).toLocaleDateString("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long" });
}

export type StepTone = "new" | "retry" | "wait" | "urgent" | "ok";

/**
 * The one thing to do about an order now, in words — so a moderator opening
 * the list reads what is expected of them instead of decoding badges.
 */
export function nextStep(r: Issue): { tone: StepTone; text: string } {
    const today = todayStr();
    const st = stageOf(r);
    const last = outcomeLabel(r.last_outcome);
    if (st === "new") return { tone: "new", text: "محدش كلّمه لسه. اتصل بالعميل." };
    if (r.last_outcome === "customer_refused")
        return { tone: "urgent", text: "العميل رفض الاستلام. لو متأكد، سجّله مرتجع نهائي." };
    if (st === "retry") {
        if (r.next_action_at && r.next_action_at > today)
            return { tone: "wait", text: `${last}. نكلمه ${dayLabel(r.next_action_at)}.` };
        if (r.next_action_at)
            return { tone: "retry", text: `${dayLabel(r.next_action_at)} ميعاد نكلمه. اتصل دلوقتي.` };
        if (Number(r.followup_count) >= SUGGEST_RETURN_AT)
            return { tone: "urgent", text: `${r.followup_count} محاولات ومفيش نتيجة. كلّم شركة الشحن أو رجّعه.` };
        const mins = minutesSince(r.last_followup) ?? RETRY_AFTER_MIN;
        if (mins < RETRY_AFTER_MIN)
            return { tone: "wait", text: `آخر مرة: ${last} ${ago(r.last_followup)}. جرّب تاني بعد ${RETRY_AFTER_MIN - mins} دقيقة.` };
        return { tone: "retry", text: `اتصل تاني. آخر مرة: ${last} ${ago(r.last_followup)}.` };
    }
    if (r.next_action_at && r.next_action_at <= today)
        return { tone: "urgent", text: `ميعاده كان ${dayLabel(r.next_action_at)}. اتأكد إنه اتسلم.` };
    if (r.next_action_at)
        return { tone: "ok", text: `اتفقنا على التسليم ${dayLabel(r.next_action_at)}. مفيش مطلوب دلوقتي.` };
    return { tone: "ok", text: `${last}. مستني التسليم.` };
}

export const STEP_TONES: Record<StepTone, string> = {
    new: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900",
    retry: "bg-orange-50 text-orange-900 border-orange-200 dark:bg-orange-950/30 dark:text-orange-200 dark:border-orange-900",
    wait: "bg-muted/50 text-muted-foreground border-border",
    urgent: "bg-red-50 text-red-900 border-red-200 dark:bg-red-950/30 dark:text-red-200 dark:border-red-900",
    ok: "bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900",
};
export const STEP_DOTS: Record<StepTone, string> = {
    new: "bg-amber-500", retry: "bg-orange-500", wait: "bg-muted-foreground/50", urgent: "bg-red-500", ok: "bg-emerald-500",
};

/**
 * A customer's phone field sometimes holds more than one number —
 * "0882232065 | 01159244278", a landline and a mobile. Split it and treat each
 * number separately, so every one gets a working call button.
 */
export const phoneNumbers = (p: string | null): string[] =>
    (p || "").split(/[^0-9]+/).map(x => x.trim()).filter(x => x.length >= 7);

/** WhatsApp only makes sense for an Egyptian mobile, not a landline. */
export const waLink = (num: string) => (/^01\d{9}$/.test(num) ? `https://wa.me/2${num}` : null);

const PATHS: { key: Exclude<Path, "other">; label: string; sub: string; icon: React.ComponentType<{ className?: string }>; on: string }[] = [
    { key: "customer", label: "العميل رد", sub: "اتكلمت معاه", icon: PhoneCall,
      on: "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500 text-emerald-900 dark:text-emerald-200" },
    { key: "noanswer", label: "ماوصلتش للعميل", sub: "مابيردش، مقفول، الرقم غلط", icon: PhoneMissed,
      on: "border-orange-500 bg-orange-500/10 ring-1 ring-orange-500 text-orange-900 dark:text-orange-200" },
    { key: "courier", label: "كلمت شركة الشحن", sub: "المندوب أو خدمة العملاء", icon: Truck,
      on: "border-sky-500 bg-sky-500/10 ring-1 ring-sky-500 text-sky-900 dark:text-sky-200" },
];

const STATUS_OPTIONS = [
    { value: "Hold To redeliver", label: "مؤجل للتسليم", hint: "اتفقنا على تسليم تاني" },
    { value: "Shipped", label: "رجّعه للشحن", hint: "المندوب هيطلع بيه تاني" },
    { value: "Collected", label: "اتسلم", hint: "العميل استلم ودفع" },
    { value: "Returned", label: "مرتجع نهائي", hint: "رجع المخزن أو العميل رفض نهائي" },
];
const statusLabel = (v: string) => STATUS_OPTIONS.find(s => s.value === v)?.label ?? v;

const who = (email: string | null | undefined) => (email ? email.split("@")[0] : "—");

/**
 * The panel a moderator records a call in. It keeps the customer's numbers at
 * the top so the call is made from here, shows what happened on earlier
 * calls, then asks two questions — who did you reach, and what was said — and
 * only then the details that answer needs. The footer says where the order
 * will go once it is saved, so nobody wonders where it disappeared to.
 */
export function FollowupRecorder({ issue, onClose, ...rest }: {
    issue: Issue | null;
    history: Followup[] | undefined;
    businessId: string;
    userEmail: string | null;
    hasNext: boolean;
    onClose: () => void;
    onSaved: (openNext: boolean) => void;
}) {
    return (
        <Sheet open={!!issue} onOpenChange={o => !o && onClose()}>
            <SheetContent side="left" dir="rtl" className="w-full gap-0 p-0 sm:max-w-lg">
                {/* Keyed by order: every order the panel opens on starts with a fresh form. */}
                {issue && <RecorderBody key={issue.order_id} issue={issue} onClose={onClose} {...rest} />}
            </SheetContent>
        </Sheet>
    );
}

function RecorderBody({
    issue, history, businessId, userEmail, hasNext, onClose, onSaved,
}: {
    issue: Issue;
    history: Followup[] | undefined;
    businessId: string;
    userEmail: string | null;
    hasNext: boolean;
    onClose: () => void;
    onSaved: (openNext: boolean) => void;
}) {
    const [path, setPath] = useState<Path | null>(null);
    const [outcome, setOutcome] = useState<string>("");
    const [note, setNote] = useState("");
    const [showNote, setShowNote] = useState(false);
    const [next, setNext] = useState("");
    const [newStatus, setNewStatus] = useState("");
    const [showStatus, setShowStatus] = useState(false);
    const [saving, setSaving] = useState(false);

    const chosen = OUTCOMES.find(o => o.value === outcome);

    function choosePath(p: Path) {
        setPath(p);
        // Talking to the courier, or "something else", is one answer on its
        // own: no second question.
        const only = OUTCOMES.filter(o => o.path === p);
        chooseOutcome(only.length === 1 ? only[0].value : "");
    }
    function chooseOutcome(v: string) {
        setOutcome(v);
        setNext("");
        const o = OUTCOMES.find(x => x.value === v);
        setShowStatus(!!o?.status);
        setNewStatus("");
        setShowNote(!!o?.note);
    }

    const noteRequired = !!chosen?.note?.required;
    const dateRequired = !!chosen?.date?.required;
    const missing = !chosen ? "اختار اللي حصل في المكالمة"
        : noteRequired && !note.trim() ? `اكتب ${chosen.note!.label}`
        : dateRequired && !next ? `اختار ${chosen.date!.label}`
        : null;

    // Where the order goes once this is saved.
    const willLeave = newStatus === "Collected" || newStatus === "Returned";
    const destination = !chosen ? null
        : willLeave ? `الأوردر هيبقى «${statusLabel(newStatus)}» ويخرج من القايمة.`
        : chosen.kind === "reached"
            ? `هيروح لتاب «اتوصلنا»${next ? ` ويرجعلك ${dayLabel(next)}` : ""}.`
            : `هيروح لتاب «إعادة المحاولة»${next ? ` ويرجعلك ${dayLabel(next)}` : " وتقدر تتصل تاني بعد ساعة"}.`;

    async function save(openNext: boolean) {
        if (!chosen) return;
        if (missing) { toast.error(missing); return; }
        setSaving(true);
        try {
            const { error } = await supabase.from("shipping_followups").insert({
                business_id: businessId,
                order_id: issue.order_id,
                outcome: chosen.value,
                note: note.trim() || null,
                next_action_at: next || null,
                created_by: userEmail || "Staff",
            }).select("id");
            if (error) throw error;

            if (newStatus && newStatus !== issue.status) {
                const { data, error: sErr } = await supabase
                    .from("orders").update({ status: newStatus })
                    .eq("id", issue.order_id).eq("business_id", businessId).select("id");
                if (sErr) throw sErr;
                if (!data || data.length === 0) throw new Error("المتابعة اتسجلت بس الحالة ماتغيرتش. حدّث الصفحة وجرّب تاني.");
                logBusinessAction({
                    businessId,
                    userEmail: userEmail || "Staff",
                    actionType: "update_status",
                    entityType: "order",
                    entityId: issue.order_id,
                    entityName: `Order #${issue.reference} (${issue.customer_name || "Customer"})`,
                    changes: [{ field: "Status", old_value: issue.status, new_value: newStatus }],
                    metadata: { source: "shipping_issues", outcome: chosen.value },
                });
            }
            toast.success(`اتسجلت المتابعة على #${issue.reference}`, { description: destination ?? undefined });
            onSaved(openNext);
        } catch (e) {
            const message = (e as { message?: string } | null)?.message || "";
            toast.error(/outcome_check/.test(message)
                ? "السبب ده محتاج migration 20261007_shipping_followup_reasons.sql يتشغّل الأول."
                : message || "المتابعة ماتسجلتش. جرّب تاني.");
        } finally {
            setSaving(false);
        }
    }

    const phones = phoneNumbers(issue.customer_phone);
    const quickDays = [0, 1, 2].map(d => format(addDays(new Date(), d), "yyyy-MM-dd"));
    const step3 = chosen && (chosen.date || chosen.note || chosen.path === "noanswer" || chosen.status || showStatus);

    return (
        <>
            <SheetHeader className="border-b p-4 pr-12 text-start">
                <SheetTitle className="flex flex-wrap items-baseline gap-x-3 text-base">
                    <span className="font-mono text-xl font-black tracking-wider" dir="ltr">#{issue.reference}</span>
                    <span className="truncate">{issue.customer_name || "—"}</span>
                </SheetTitle>
                <SheetDescription className="text-start">
                    {issue.status} عند {issue.courier || "شركة الشحن"}، عالق من {issue.days_stuck} يوم
                    {issue.governorate ? `، ${issue.governorate}` : ""}، <span dir="ltr">{formatCurrency(Number(issue.total_amount))}</span>
                </SheetDescription>
                <div className="flex flex-wrap gap-2 pt-2">
                    {phones.length === 0 ? <span className="text-sm text-muted-foreground">مفيش رقم مسجل للعميل</span> : phones.map(num => (
                        <div key={num} className="flex items-center gap-1">
                            <Button asChild size="sm" variant="outline" className="h-9 gap-1.5 font-mono text-base">
                                <a href={`tel:${num}`}><Phone className="h-4 w-4" />{num}</a>
                            </Button>
                            {waLink(num) && (
                                <Button asChild size="icon" variant="outline" className="h-9 w-9 text-emerald-700 dark:text-emerald-400" aria-label="واتساب">
                                    <a href={waLink(num)!} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" /></a>
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto p-4">
                <PreviousCalls history={history} />

                <Step n={1} title="المكالمة وصلت لإيه؟">
                    <div className="grid gap-2 sm:grid-cols-3">
                        {PATHS.map(p => (
                            <button key={p.key} type="button" onClick={() => choosePath(p.key)}
                                    className={cn("flex items-center gap-3 rounded-xl border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-col sm:items-start sm:gap-1",
                                        path === p.key ? p.on : "hover:bg-muted/60")}>
                                <p.icon className="h-5 w-5 shrink-0" />
                                <span className="flex flex-col gap-0.5">
                                    <span className="text-sm font-semibold">{p.label}</span>
                                    <span className="text-[11px] opacity-75">{p.sub}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                    <button type="button" onClick={() => choosePath("other")}
                            className={cn("mt-2 text-xs underline-offset-2 hover:underline", path === "other" ? "font-semibold text-foreground" : "text-muted-foreground")}>
                        {path === "other" ? "✓ حاجة تانية مش هنا" : "حاجة تانية مش هنا؟"}
                    </button>
                </Step>

                {(path === "customer" || path === "noanswer") && (
                    <Step n={2} title={path === "customer" ? "العميل قال إيه؟" : "إيه اللي حصل؟"}>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                            {OUTCOMES.filter(o => o.path === path).map(o => (
                                <button key={o.value} type="button" onClick={() => chooseOutcome(o.value)}
                                        className={cn("flex items-center gap-2 rounded-lg border px-3 py-2.5 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                            outcome === o.value
                                                ? o.kind === "reached" ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500" : "border-orange-500 bg-orange-500/10 ring-1 ring-orange-500"
                                                : "hover:bg-muted/60")}>
                                    <o.icon className="h-4 w-4 shrink-0 opacity-70" />
                                    {o.label}
                                </button>
                            ))}
                        </div>
                    </Step>
                )}

                {step3 && (
                    <Step n={path === "courier" || path === "other" ? 2 : 3} title={noteRequired || dateRequired ? "التفاصيل" : "التفاصيل (اختياري)"}>
                        <div className="space-y-4">
                            {chosen.date && (
                                <div className="space-y-1.5">
                                    <div className="text-sm font-medium">{chosen.date.label}{chosen.date.required ? "" : " (اختياري)"}</div>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {quickDays.map(d => (
                                            <button key={d} type="button" onClick={() => setNext(next === d ? "" : d)}
                                                    className={cn("rounded-full border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                        next === d ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/60")}>
                                                {dayLabel(d)}
                                            </button>
                                        ))}
                                        <Input type="date" value={next} min={todayStr()} onChange={e => setNext(e.target.value)}
                                               className="h-8 w-[150px]" aria-label="تاريخ تاني" />
                                    </div>
                                    {next && !quickDays.includes(next) && <div className="text-xs text-muted-foreground">{dayLabel(next)}</div>}
                                </div>
                            )}

                            {showNote ? (
                                <div className="space-y-1.5">
                                    <div className="text-sm font-medium">{chosen.note?.label ?? "ملاحظة (اختياري)"}</div>
                                    <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)}
                                              placeholder={chosen.note?.placeholder ?? "أي حاجة تفيد اللي هيكلمه بعدك"}
                                              autoFocus={noteRequired} />
                                </div>
                            ) : (
                                <button type="button" onClick={() => setShowNote(true)} className="block text-xs text-muted-foreground underline-offset-2 hover:underline">
                                    + ضيف ملاحظة
                                </button>
                            )}

                            {showStatus ? (
                                <div className="space-y-1.5">
                                    <div className="text-sm font-medium">تغيّر حالة الأوردر؟ (اختياري)</div>
                                    <div className="grid gap-1.5 sm:grid-cols-2">
                                        <StatusChoice active={!newStatus} onClick={() => setNewStatus("")} label="سيبها زي ما هي" hint={issue.status} />
                                        {STATUS_OPTIONS.filter(s => s.value !== issue.status).map(s => (
                                            <StatusChoice key={s.value} active={newStatus === s.value} onClick={() => setNewStatus(s.value)}
                                                          label={s.label} hint={s.hint} danger={s.value === "Returned"} />
                                        ))}
                                    </div>
                                    {newStatus === "Returned" && (
                                        <div className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-xs text-red-700 dark:text-red-400">
                                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                            بيتحسب مرتجع في نسبة التسليم. اختاره بس لو الأوردر رجع المخزن أو العميل رفض نهائي.
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <button type="button" onClick={() => setShowStatus(true)} className="block text-xs text-muted-foreground underline-offset-2 hover:underline">
                                    + غيّر حالة الأوردر كمان
                                </button>
                            )}
                        </div>
                    </Step>
                )}
            </div>

            <div className="space-y-2 border-t bg-muted/30 p-4">
                <div className={cn("text-sm", missing ? "text-muted-foreground" : "font-medium")}>
                    {missing ?? destination}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={saving}>إلغاء</Button>
                    <Button variant={hasNext ? "outline" : "default"} onClick={() => save(false)} disabled={saving || !!missing}>
                        {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}سجّل المتابعة
                    </Button>
                    {hasNext && (
                        <Button onClick={() => save(true)} disabled={saving || !!missing}>
                            {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}سجّل وافتح اللي بعده
                        </Button>
                    )}
                </div>
            </div>
        </>
    );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-2.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{n}</span>
                {title}
            </h3>
            {children}
        </section>
    );
}

function StatusChoice({ active, onClick, label, hint, danger }: { active: boolean; onClick: () => void; label: string; hint?: string; danger?: boolean }) {
    return (
        <button type="button" onClick={onClick}
                className={cn("rounded-lg border px-3 py-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? danger ? "border-red-500 bg-red-500/10 ring-1 ring-red-500" : "border-primary bg-primary/10 ring-1 ring-primary" : "hover:bg-muted/60")}>
            <div className="flex items-center gap-1.5 text-sm font-medium">{active && <Check className="h-3.5 w-3.5" />}{label}</div>
            {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
        </button>
    );
}

/** What happened on the calls before this one — the next caller starts informed. */
function PreviousCalls({ history }: { history: Followup[] | undefined }) {
    if (!history) return <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />بيحمّل المكالمات اللي فاتت</div>;
    if (history.length === 0) return <div className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">دي أول مكالمة على الأوردر ده.</div>;
    const shown = history.slice(0, 3);
    return (
        <div className="rounded-lg border bg-muted/20">
            <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
                قبل كده ({history.length} {history.length === 1 ? "متابعة" : "متابعات"})
            </div>
            <ol className="divide-y">
                {shown.map(f => (
                    <li key={f.id} className="px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-x-2">
                            <span className={cn("h-2 w-2 shrink-0 rounded-full", isFailed(f.outcome) ? "bg-orange-500" : "bg-emerald-500")} />
                            <span className="font-medium">{outcomeLabel(f.outcome)}</span>
                            <span className="text-xs text-muted-foreground">{who(f.created_by)}، {ago(f.created_at)}</span>
                            {f.next_action_at && <span className="text-xs text-muted-foreground">ميعاد {dayLabel(f.next_action_at)}</span>}
                        </div>
                        {f.note && <p className="mt-0.5 ps-4 text-xs text-muted-foreground">{f.note}</p>}
                    </li>
                ))}
            </ol>
            {history.length > shown.length && <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">والباقي في سجل الأوردر</div>}
        </div>
    );
}
