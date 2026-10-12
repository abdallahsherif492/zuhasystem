"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, cn, normalizeSearchText } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Loader2, LifeBuoy, Phone, MessageCircle, Search, RefreshCw,
    ChevronDown, Clock, Download, Truck, PhoneCall,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { format } from "date-fns";
import { minutesSince } from "@/components/orders/confirmation-attempts";
import {
    FollowupRecorder, RETRY_AFTER_MIN, STEP_DOTS, STEP_TONES, dayLabel, isFailed, nextStep, outcomeLabel,
    phoneNumbers, stageOf, todayStr, waLink, type Followup, type Issue, type Stage,
} from "@/components/logistics/shipping-followup";

const BUCKETS = [
    { key: "all", label: "الكل" },
    { key: "returning", label: "قيد الإرجاع" },
    { key: "hold", label: "مؤجل للتسليم" },
    { key: "stale", label: "شحن متأخر" },
];

/** Filter key for orders with no courier attached. */
const NO_COURIER = "__none__";

/**
 * Worklist for orders stuck with the courier.
 *
 * These are not lost orders. A parcel only becomes a return when it physically
 * reaches the warehouse, so until then a phone call still recovers it — and
 * recovering one is far cheaper than winning a new order, because the courier
 * fee and the ad spend have already been paid.
 *
 * Sorted by how long each order has been stuck rather than by when it was
 * created: an order placed three weeks ago that shipped yesterday is healthy,
 * and one that has been Returning since Tuesday is not.
 */
export default function ShippingIssuesPage() {
    const { activeBusiness, currentUser } = useBusiness();
    const { t } = useLanguage();

    const [rows, setRows] = useState<Issue[]>([]);
    const [loading, setLoading] = useState(true);
    const [unavailable, setUnavailable] = useState(false);
    const [bucket, setBucket] = useState("all");
    const [stage, setStage] = useState<Stage | "all">("new");
    // Courier by name — the RPC returns the name, and one courier's problems
    // are one conversation with one account manager.
    const [courier, setCourier] = useState("all");
    const [exporting, setExporting] = useState(false);
    const [query, setQuery] = useState("");
    const [staleDays, setStaleDays] = useState(5);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [history, setHistory] = useState<Record<string, Followup[]>>({});

    // The order the follow-up panel is open on.
    const [recording, setRecording] = useState<Issue | null>(null);

    // `quiet`: the automatic refresh — no spinner, and a failed refresh
    // leaves the list as it was instead of replacing it with an error.
    const load = useCallback(async (quiet = false) => {
        if (!activeBusiness) return;
        if (!quiet) setLoading(true);
        const { data, error } = await supabase.rpc("get_shipping_issues", {
            p_business_id: activeBusiness.id,
            p_stale_days: staleDays,
        });
        if (error) {
            console.error("Shipping issues failed to load:", error);
            if (!quiet) { setUnavailable(true); setRows([]); }
        } else {
            setUnavailable(false);
            // The reference is the order's own: its first 8 characters, as
            // printed on the waybill. The function in the database returned
            // the EasyOrders id for some orders — a UUID that matches no
            // parcel — so it is worked out here rather than trusted.
            setRows(((data as Issue[]) || []).map(r => ({ ...r, reference: String(r.order_id).slice(0, 8) })));
        }
        if (!quiet) setLoading(false);
    }, [activeBusiness, staleDays]);

    useEffect(() => { load(); }, [load]);

    // Several people work this list. Every minute while the page is visible,
    // and whenever someone comes back to the tab, it reloads quietly, so a
    // follow-up a colleague recorded moves the order to its tab here too.
    useEffect(() => {
        const refresh = () => { if (document.visibilityState === "visible") load(true); };
        const timer = setInterval(refresh, 60_000);
        document.addEventListener("visibilitychange", refresh);
        window.addEventListener("focus", refresh);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", refresh);
            window.removeEventListener("focus", refresh);
        };
    }, [load]);

    async function loadHistory(orderId: string) {
        if (history[orderId] || !activeBusiness) return;
        const { data } = await supabase
            .from("shipping_followups")
            .select("id, outcome, note, next_action_at, created_by, created_at")
            .eq("business_id", activeBusiness.id)
            .eq("order_id", orderId)
            .order("created_at", { ascending: false });
        setHistory(prev => ({ ...prev, [orderId]: (data as Followup[]) || [] }));
    }

    // Every filter except the follow-up stage: the tabs count from this.
    const base = useMemo(() => {
        const q = normalizeSearchText(query);
        return rows.filter(r => {
            if (bucket !== "all" && r.bucket !== bucket) return false;
            if (courier !== "all" && (r.courier || NO_COURIER) !== courier) return false;
            if (!q) return true;
            const hay = normalizeSearchText(
                `${r.reference} ${r.customer_name || ""} ${r.customer_phone || ""} ${r.governorate || ""} ${r.courier || ""}`);
            return hay.includes(q);
        });
    }, [rows, bucket, courier, query]);

    const stageCounts = useMemo(() => ({
        new: base.filter(r => stageOf(r) === "new").length,
        retry: base.filter(r => stageOf(r) === "retry").length,
        due: base.filter(r => stageOf(r) === "retry" && (minutesSince(r.last_followup) ?? 0) >= RETRY_AFTER_MIN).length,
        reached: base.filter(r => stageOf(r) === "reached").length,
        overdue: base.filter(r => stageOf(r) === "reached" && r.next_action_at && r.next_action_at <= todayStr()).length,
        all: base.length,
    }), [base]);

    // New keeps the longest-stuck first. Retry starts with whoever has waited
    // longest since the last failed call; Reached with the follow-up date that
    // comes first — today's and overdue ones at the top.
    const filtered = useMemo(() => {
        if (stage === "all") return base;
        const list = base.filter(r => stageOf(r) === stage);
        if (stage === "retry") return [...list].sort((a, b) => String(a.last_followup ?? "").localeCompare(String(b.last_followup ?? "")));
        if (stage === "reached") return [...list].sort((a, b) => String(a.next_action_at ?? "9999").localeCompare(String(b.next_action_at ?? "9999")));
        return list;
    }, [base, stage]);

    /** Couriers present in the current bucket, with how many each is holding. */
    const couriers = useMemo(() => {
        const m = new Map<string, number>();
        rows.filter(r => bucket === "all" || r.bucket === bucket)
            .forEach(r => m.set(r.courier || NO_COURIER, (m.get(r.courier || NO_COURIER) || 0) + 1));
        return [...m.entries()].sort((a, b) => b[1] - a[1]);
    }, [rows, bucket]);

    /**
     * The sheet is exactly what is on screen — same bucket, same courier, same
     * search — so filtering to one courier and exporting gives the file to send
     * that courier.
     *
     * The issues RPC carries what the cards need and no more, so the address,
     * second phone and payment are read for just these orders at export time.
     * A courier cannot chase a parcel without the address, and needs the
     * amount still due rather than the total when a deposit was taken. Read in
     * chunks: a few hundred ids in one filter overflows the request URL.
     */
    async function exportSheet() {
        if (!activeBusiness || filtered.length === 0) return;
        setExporting(true);
        try {
            const ids = filtered.map(r => r.order_id);
            const extra = new Map<string, any>();
            let partial = false;
            for (let i = 0; i < ids.length; i += 100) {
                const { data, error } = await supabase
                    .from("orders")
                    .select("id, created_at, customer_info, notes, payment_status, paid_amount")
                    .eq("business_id", activeBusiness.id)
                    .in("id", ids.slice(i, i + 100));
                if (error) { partial = true; continue; }
                (data || []).forEach(o => extra.set(o.id, o));
            }

            const bucketLabel = (b: string) => BUCKETS.find(x => x.key === b)?.label || b;
            const sheetRows = filtered.map(r => {
                const o = extra.get(r.order_id) || {};
                const info = o.customer_info || {};
                const total = Number(r.total_amount) || 0;
                const paid = Number(o.paid_amount) || 0;
                const due = o.payment_status === "Paid" ? 0 : Math.max(total - paid, 0);
                return {
                    "رقم الأوردر": r.reference,
                    "الحالة": r.status,
                    "نوع المشكلة": bucketLabel(r.bucket),
                    "عالق من (يوم)": r.days_stuck,
                    "شركة الشحن": r.courier || "",
                    "العميل": r.customer_name || "",
                    "موبايل 1": info.phone || r.customer_phone || "",
                    "موبايل 2": info.phone2 || "",
                    "المحافظة": r.governorate || "",
                    "العنوان": info.address || "",
                    "قيمة الأوردر": total,
                    "المطلوب تحصيله": due,
                    "عدد المتابعات": Number(r.followup_count) || 0,
                    "آخر متابعة": r.followup_count ? outcomeLabel(r.last_outcome) : "",
                    "المتابعة الجاية": r.next_action_at || "",
                    "أكده": r.closed_by || "",
                    "ملاحظات الأوردر": o.notes || "",
                    "تاريخ الأوردر": o.created_at ? String(o.created_at).slice(0, 10) : "",
                };
            });

            const ws = XLSX.utils.json_to_sheet(sheetRows);
            // Widths from the longest value in each column, so the sheet opens
            // readable instead of as a wall of truncated cells.
            const keys = Object.keys(sheetRows[0]);
            ws["!cols"] = keys.map(k => ({
                wch: Math.min(60, Math.max(k.length, ...sheetRows.map(r => String((r as any)[k] ?? "").length)) + 2),
            }));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "مشاكل الشحن");
            // Arabic content reads right to left in Excel too.
            wb.Workbook = { Views: [{ RTL: true }] } as any;

            const tag = courier === "all" ? "all" : courier.replace(/[^\p{L}\p{N}]+/gu, "_");
            XLSX.writeFile(wb, `shipping_issues_${tag}_${todayStr()}.xlsx`);

            if (partial) toast.warning("اتصدّر، بس بعض العناوين مااتحملتش. جرّب تاني لو محتاجها.");
            else toast.success(`اتصدّر ${sheetRows.length} أوردر`);
        } catch (e: any) {
            console.error("Export failed:", e);
            toast.error(e?.message || "مش قادر يصدّر الشيت");
        } finally {
            setExporting(false);
        }
    }

    // One sentence over the list instead of four cards: the tabs already
    // count the untouched and the due ones.
    const totals = useMemo(() => ({
        count: base.length,
        val: base.reduce((s, r) => s + Number(r.total_amount || 0), 0),
    }), [base]);

    function openRecorder(r: Issue) {
        setRecording(r);
        loadHistory(r.order_id);
    }

    /** The order after this one in the list as it is on screen. */
    const nextAfter = (r: Issue | null) => {
        if (!r) return null;
        const i = filtered.findIndex(x => x.order_id === r.order_id);
        return filtered.slice(i + 1).find(x => x.order_id !== r.order_id) ?? null;
    };

    // Saved: forget the cached history, reload quietly, and either close the
    // panel or carry straight on to the next order — a moderator working
    // through the list should not have to find their place again.
    function afterSave(openNext: boolean) {
        const done = recording;
        const following = openNext ? nextAfter(done) : null;
        if (done) setHistory(prev => { const n = { ...prev }; delete n[done.order_id]; return n; });
        load(true);
        if (following) openRecorder(following);
        else setRecording(null);
    }

    if (unavailable) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>{t("مشاكل الشحن")}</CardTitle>
                    <CardDescription>
                        شغّل supabase/migrations/20260825_shipping_issues.sql عشان الصفحة دي تشتغل.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <div className="space-y-5" dir="rtl">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                    <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
                        <LifeBuoy className="h-7 w-7 text-primary" />
                        {t("مشاكل الشحن")}
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {loading ? "أوردرات عالقة عند شركات الشحن ولسه ممكن تتنقذ."
                            : totals.count === 0 ? "مفيش أوردرات عالقة في الفلتر ده."
                            : <>{totals.count} أوردر عالق عند شركات الشحن بقيمة <span dir="ltr" className="font-semibold text-foreground">{formatCurrency(totals.val)}</span>، ولسه ممكن يتنقذوا.</>}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                        اقرا السطر الملوّن فوق كل أوردر، اتصل، وبعد المكالمة دوس «سجّل متابعة» واختار اللي حصل.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline" onClick={exportSheet}
                        disabled={exporting || loading || filtered.length === 0}
                        className="gap-2 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                    >
                        {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {/* The count says what will be in the file, so a filter
                            left on by accident is noticed before sending it. */}
                        تصدير Excel ({filtered.length})
                    </Button>
                    <Button variant="outline" onClick={() => load()} className="gap-2">
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                        {t("تحديث")}
                    </Button>
                </div>
            </div>

            <FollowupTabs value={stage} onChange={setStage} counts={stageCounts} />

            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-3">
                {BUCKETS.map(b => {
                    const c = b.key === "all" ? rows.length : rows.filter(r => r.bucket === b.key).length;
                    return (
                        <Button key={b.key} size="sm" variant={bucket === b.key ? "default" : "outline"}
                                onClick={() => setBucket(b.key)} className="gap-1.5">
                            {b.label}
                            <span className="text-[11px] opacity-70">({c})</span>
                        </Button>
                    );
                })}
                <Select value={courier} onValueChange={setCourier}>
                    <SelectTrigger className="h-9 w-[190px] bg-background">
                        <Truck className="h-4 w-4 text-muted-foreground" />
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">كل شركات الشحن</SelectItem>
                        {couriers.map(([name, n]) => (
                            <SelectItem key={name} value={name}>
                                {name === NO_COURIER ? "بدون شركة شحن" : name} ({n})
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <div className="relative ms-auto min-w-[180px] max-w-sm flex-1">
                    <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="رقم الأوردر أو العميل أو التليفون..." value={query}
                           onChange={e => setQuery(e.target.value)} className="h-9 bg-background ps-8" />
                </div>
                <div className="flex items-center gap-1.5">
                    <Label className="whitespace-nowrap text-xs text-muted-foreground">شحن متأخر بعد</Label>
                    <Input type="number" min={1} max={60} value={staleDays}
                           onChange={e => setStaleDays(Math.max(1, Number(e.target.value) || 5))}
                           className="h-9 w-16 bg-background" />
                    <span className="text-xs text-muted-foreground">يوم</span>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center p-16"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
            ) : filtered.length === 0 ? (
                <Card><CardContent className="p-16 text-center text-sm text-muted-foreground">
                    {stage === "new" ? "كل الأوردرات العالقة اتكلّمت مرة على الأقل."
                        : stage === "retry" ? "مفيش أوردرات مستنية مكالمة تانية."
                        : stage === "reached" ? "لسه مااتوصلناش لحد في الأوردرات دي."
                        : "مفيش أوردرات عالقة في الفلتر ده."}
                    {stage === "new" && stageCounts.retry > 0 && (
                        <button className="mt-2 block w-full text-primary underline" onClick={() => setStage("retry")}>
                            روح لإعادة المحاولة ({stageCounts.retry})
                        </button>
                    )}
                </CardContent></Card>
            ) : (
                <div className="space-y-3">
                    {filtered.map(r => {
                        const open = expanded === r.order_id;
                        const step = nextStep(r);
                        const phones = phoneNumbers(r.customer_phone);
                        return (
                            <article key={r.order_id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
                                {/* What to do about this order now — read before anything else. */}
                                <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5", STEP_TONES[step.tone])}>
                                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STEP_DOTS[step.tone])} aria-hidden />
                                    <span className="min-w-[12rem] flex-1 text-sm font-semibold">{step.text}</span>
                                    <Button size="sm" className="h-8 gap-1.5" onClick={() => openRecorder(r)}>
                                        <PhoneCall className="h-4 w-4" /> سجّل متابعة
                                    </Button>
                                </div>

                                <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3">
                                    <div className="min-w-0">
                                        {/* The same 8 characters printed on the waybill, so the
                                            number on the parcel matches the screen. */}
                                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                            <span className="font-mono text-xl font-black tracking-wider" dir="ltr">#{r.reference}</span>
                                            <span className="truncate text-base font-semibold">{r.customer_name || "—"}</span>
                                        </div>
                                        <div className="mt-0.5 text-sm text-muted-foreground">
                                            {[r.governorate, r.courier, r.closed_by ? `أكده ${r.closed_by.split("@")[0]}` : null].filter(Boolean).join("، ") || "—"}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline" className={cn("px-2.5",
                                            r.bucket === "returning" && "border-red-500/25 bg-red-500/10 text-red-600",
                                            r.bucket === "hold" && "border-amber-500/25 bg-amber-500/10 text-amber-600",
                                            r.bucket === "stale" && "border-blue-500/25 bg-blue-500/10 text-blue-600",
                                        )}>
                                            {r.status}
                                        </Badge>
                                        <span className={cn("text-sm font-semibold",
                                            r.days_stuck >= 14 ? "text-red-600" : r.days_stuck >= 7 ? "text-amber-600" : "text-muted-foreground")}>
                                            عالق من {r.days_stuck} يوم
                                        </span>
                                        <span className="text-lg font-bold tabular-nums" dir="ltr">{formatCurrency(Number(r.total_amount))}</span>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-3 pt-2">
                                    {phones.length === 0 ? (
                                        <span className="text-sm text-muted-foreground">مفيش رقم مسجل</span>
                                    ) : phones.map(num => (
                                        <div key={num} className="flex items-center gap-1.5">
                                            {/* Big and tappable — this screen exists to get someone on the phone. */}
                                            <a href={`tel:${num}`} className="font-mono text-xl font-bold tracking-wide hover:underline">{num}</a>
                                            <Button asChild size="icon" variant="outline" className="h-8 w-8" aria-label={`اتصل ${num}`}>
                                                <a href={`tel:${num}`}><Phone className="h-4 w-4" /></a>
                                            </Button>
                                            {waLink(num) && (
                                                <Button asChild size="icon" variant="outline" className="h-8 w-8 text-emerald-700 dark:text-emerald-400" aria-label={`واتساب ${num}`}>
                                                    <a href={waLink(num)!} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" /></a>
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                    {Number(r.followup_count) > 0 && (
                                        <button type="button"
                                                className="ms-auto inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                onClick={() => { setExpanded(open ? null : r.order_id); if (!open) loadHistory(r.order_id); }}
                                                aria-expanded={open}>
                                            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
                                            {open ? "اخفي المتابعات" : `${r.followup_count} ${Number(r.followup_count) === 1 ? "متابعة" : "متابعات"} قبل كده`}
                                        </button>
                                    )}
                                </div>

                                {open && (
                                    <div className="border-t bg-muted/20 px-4 py-3">
                                        {!history[r.order_id] ? (
                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                        ) : (
                                            <ol className="space-y-2.5">
                                                {history[r.order_id].map(f => (
                                                    <li key={f.id} className="flex gap-2.5 text-sm">
                                                        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", isFailed(f.outcome) ? "bg-orange-500" : "bg-emerald-500")} aria-hidden />
                                                        <div className="min-w-0">
                                                            <div className="flex flex-wrap items-center gap-x-2">
                                                                <span className="font-semibold">{outcomeLabel(f.outcome)}</span>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {(f.created_by || "—").split("@")[0]}، {format(new Date(f.created_at), "dd/MM hh:mm a")}
                                                                </span>
                                                                {f.next_action_at && (
                                                                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                                                        <Clock className="h-3 w-3" /> ميعاد {dayLabel(f.next_action_at)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {f.note && <p className="mt-0.5 text-muted-foreground">{f.note}</p>}
                                                        </div>
                                                    </li>
                                                ))}
                                            </ol>
                                        )}
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}

            {activeBusiness && (
                <FollowupRecorder
                    issue={recording}
                    history={recording ? history[recording.order_id] : undefined}
                    businessId={activeBusiness.id}
                    userEmail={currentUser?.email ?? null}
                    hasNext={!!nextAfter(recording)}
                    onClose={() => setRecording(null)}
                    onSaved={afterSave}
                />
            )}
        </div>
    );
}

/** Tabs over the list: by how far following each order up has got. */
function FollowupTabs({ value, onChange, counts }: {
    value: Stage | "all";
    onChange: (v: Stage | "all") => void;
    counts: { new: number; retry: number; due: number; reached: number; overdue: number; all: number };
}) {
    const tabs: { key: Stage | "all"; label: string; sub: string; count: number; tone?: string }[] = [
        { key: "new", label: "جديدة", sub: "محدش تابعها لسه", count: counts.new },
        { key: "retry", label: "إعادة المحاولة", sub: counts.due ? `${counts.due} جاهزين تتصل تاني` : "آخر مكالمة ماوصلتش", count: counts.retry, tone: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200" },
        { key: "reached", label: "اتوصلنا", sub: counts.overdue ? `${counts.overdue} ميعادهم النهارده أو فات` : "مستنيين التسليم", count: counts.reached, tone: counts.overdue ? "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200" },
        { key: "all", label: "الكل", sub: "كل الأوردرات العالقة", count: counts.all },
    ];
    return (
        <div dir="rtl" className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/50 p-1 sm:grid-cols-4">
            {tabs.map(tab => (
                <button key={tab.key} type="button" onClick={() => onChange(tab.key)}
                        className={cn("rounded-lg px-3 py-2 text-start transition-colors",
                            value === tab.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{tab.label}</span>
                        <span className={cn("rounded-full px-2 text-xs font-bold tabular-nums", tab.count && tab.tone ? tab.tone : "bg-muted text-foreground")}>{tab.count}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px]">{tab.sub}</div>
                </button>
            ))}
        </div>
    );
}
