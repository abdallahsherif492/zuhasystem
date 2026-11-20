"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { ShippingChatStatus, chatStateOf, useChatStates } from "@/components/whatsapp/order-chat-status";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, cn, normalizeSearchText } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Loader2, LifeBuoy, Phone, Search, RefreshCw,
    ChevronDown, Clock, Download, PhoneCall, PhoneMissed, PhoneOff, ClipboardCheck,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { format } from "date-fns";
import { ago } from "@/components/orders/confirmation-attempts";
import {
    FOLLOW_TABS, FOLLOW_TONE, FollowupRecorder, OrderBrief, byUrgency, loadOrderBriefs, type OrderBriefData, dayLabel, followChip, followDueAt, followStateOf, isFailed, outcomeLabel,
    phoneNumbers, quickFollowup, todayStr, type Followup, type FollowState, type Issue,
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
    const [tab, setTab] = useState<FollowState>("today");
    const [busy, setBusy] = useState<string | null>(null);
    // Worked out again each minute, so a retry whose time comes moves to "today".
    const [now, setNow] = useState(() => Date.now());
    const chatStates = useChatStates(activeBusiness?.id);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(timer);
    }, []);
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

    // Each order's products and address, fetched once for the orders on the page.
    const [briefs, setBriefs] = useState<Record<string, OrderBriefData>>({});
    const missingBriefs = useMemo(() => rows.map(r => r.order_id).filter(id => !(id in briefs)), [rows, briefs]);
    useEffect(() => {
        if (!activeBusiness || missingBriefs.length === 0) return;
        let live = true;
        loadOrderBriefs(activeBusiness.id, missingBriefs).then(found => {
            if (!live) return;
            // An order with nothing found is marked too, so it is not asked for again.
            const empty: OrderBriefData = { address: null, phone2: null, notes: null, shipping: 0, paid: 0, items: [] };
            setBriefs(prev => ({ ...prev, ...Object.fromEntries(missingBriefs.map(id => [id, found[id] ?? empty])) }));
        });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeBusiness?.id, missingBriefs.join(",")]);

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
                `${r.reference} ${r.customer_name || ""} ${r.customer_phone || ""} ${r.governorate || ""} ${r.courier || ""} ${(briefs[r.order_id]?.items || []).map(i => i.name).join(" ")}`);
            return hay.includes(q);
        });
    }, [rows, bucket, courier, query, briefs]);

    const byState = useMemo(() => {
        const m: Record<FollowState, Issue[]> = { today: [], later: [], delivering: [], decide: [] };
        for (const r of base) m[followStateOf(r, now)].push(r);
        // Today: the parcel on its way back first, then the longest stuck.
        // Later and delivering: whichever comes back first.
        m.today.sort(byUrgency);
        m.decide.sort(byUrgency);
        const due = (r: Issue) => followDueAt(r) ?? Infinity;
        m.later.sort((a, b) => due(a) - due(b));
        m.delivering.sort((a, b) => due(a) - due(b));
        return m;
    }, [base, now]);
    const counts = {
        today: byState.today.length, later: byState.later.length,
        delivering: byState.delivering.length, decide: byState.decide.length,
    };
    const filtered = byState[tab];

    /** Couriers present in the current bucket, with how many each is holding. */
    const couriers = useMemo(() => {
        const m = new Map<string, number>();
        rows.filter(r => bucket === "all" || r.bucket === bucket)
            .forEach(r => m.set(r.courier || NO_COURIER, (m.get(r.courier || NO_COURIER) || 0) + 1));
        return [...m.entries()].sort((a, b) => b[1] - a[1]);
    }, [rows, bucket]);

    /**
     * The sheet is every stuck order under the filters — same bucket, same
     * courier, same search, whatever list it is in — so picking one courier and
     * exporting gives the file to send that courier.
     *
     * The issues RPC carries what the cards need and no more, so the address,
     * second phone and payment are read for just these orders at export time.
     * A courier cannot chase a parcel without the address, and needs the
     * amount still due rather than the total when a deposit was taken. Read in
     * chunks: a few hundred ids in one filter overflows the request URL.
     */
    async function exportSheet() {
        if (!activeBusiness || base.length === 0) return;
        setExporting(true);
        try {
            const ids = base.map(r => r.order_id);
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
            const sheetRows = base.map(r => {
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
    /** One tap on a card: a call that got nowhere. */
    async function quick(r: Issue, outcome: "no_answer" | "phone_off") {
        if (!activeBusiness) return;
        setBusy(`${r.order_id}:${outcome}`);
        const error = await quickFollowup(activeBusiness.id, r.order_id, outcome, currentUser?.email ?? null);
        setBusy(null);
        if (error) { toast.error("ماتسجلتش، جرّب تاني."); return; }
        const n = Number(r.followup_count) + 1;
        const after = { ...r, followup_count: n, last_outcome: outcome, last_followup: new Date().toISOString(), next_action_at: null };
        setRows(prev => prev.map(x => x.order_id === r.order_id ? after : x));
        setHistory(prev => { const h = { ...prev }; delete h[r.order_id]; return h; });
        const st = followStateOf(after);
        toast.success(st === "decide" ? `اتسجلت. ${n} محاولات من غير نتيجة — في «محتاج قرار».` : `اتسجلت. هيرجعلك ${followChip(after).text.replace("نكلّمه ", "")}.`);
    }

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

    const selectedCourier = courier === "all" ? null : courier === NO_COURIER ? "بدون شركة شحن" : courier;

    return (
        <div className="space-y-4 pb-24 sm:pb-0" dir="rtl">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
                        <LifeBuoy className="h-6 w-6 text-primary sm:h-7 sm:w-7" />
                        {t("مشاكل الشحن")}
                    </h1>
                    {!loading && totals.count > 0 && (
                        <p className="mt-1 text-sm text-muted-foreground">
                            {totals.count} أوردر عالق بقيمة <span dir="ltr" className="font-semibold text-foreground">{formatCurrency(totals.val)}</span>
                        </p>
                    )}
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={exportSheet} disabled={exporting || loading || base.length === 0}
                        className="h-11 gap-2 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400">
                        {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {/* The count says what will be in the file, so a filter
                            left on by accident is noticed before sending it. */}
                        {selectedCourier ? `شيت ${selectedCourier}` : "Excel"} ({base.length})
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => load()} className="h-11 w-11" aria-label={t("تحديث")}>
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </Button>
                </div>
            </div>

            {/* The lists: what to do today, what has a time, what waits on the courier, what needs a decision. */}
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
                {FOLLOW_TABS.map(f => {
                    const active = tab === f.key;
                    const n = counts[f.key];
                    return (
                        <button key={f.key} type="button" onClick={() => setTab(f.key)}
                            className={cn("flex min-h-12 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors",
                                active ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted")}>
                            {f.label}
                            <span className={cn("min-w-7 rounded-full px-2 py-0.5 text-center text-sm font-bold tabular-nums",
                                active ? "bg-background/20" : f.key === "today" && n ? "bg-emerald-600 text-white" : f.key === "decide" && n ? "bg-red-600 text-white" : "bg-muted")}>{n}</span>
                        </button>
                    );
                })}
            </div>

            {/* Filters: the kind of problem, the courier, a search. */}
            <div className="space-y-2">
                <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
                    {BUCKETS.map(b => {
                        const c = b.key === "all" ? rows.length : rows.filter(r => r.bucket === b.key).length;
                        return (
                            <button key={b.key} type="button" onClick={() => setBucket(b.key)}
                                className={cn("h-10 shrink-0 rounded-full border px-3.5 text-sm font-medium",
                                    bucket === b.key ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>
                                {b.label} <span className="opacity-70">({c})</span>
                            </button>
                        );
                    })}
                </div>
                {couriers.length > 1 && (
                    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
                        <button type="button" onClick={() => setCourier("all")}
                            className={cn("h-10 shrink-0 rounded-full border px-3.5 text-sm font-medium",
                                courier === "all" ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>
                            كل الشركات
                        </button>
                        {couriers.map(([name, n]) => (
                            <button key={name} type="button" onClick={() => setCourier(name)}
                                className={cn("h-10 shrink-0 rounded-full border px-3.5 text-sm font-medium",
                                    courier === name ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>
                                {name === NO_COURIER ? "بدون شركة" : name} <span className="opacity-70">({n})</span>
                            </button>
                        ))}
                    </div>
                )}
                <div className="flex gap-2">
                    <div className="relative min-w-0 flex-1 sm:max-w-sm">
                        <Search className="absolute start-2.5 top-3 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="رقم الأوردر أو العميل أو التليفون" value={query}
                               onChange={e => setQuery(e.target.value)} className="h-10 bg-background ps-8" />
                    </div>
                    <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" title="الشحن يعتبر متأخر بعد كام يوم">
                        متأخر بعد
                        <Input type="number" min={1} max={60} value={staleDays}
                               onChange={e => setStaleDays(Math.max(1, Number(e.target.value) || 5))}
                               className="h-10 w-14 bg-background" />
                        يوم
                    </label>
                </div>
            </div>

            {/* The one button for working the list: the most urgent order
                due today, opened with its panel. On a phone, under the thumb. */}
            {counts.today > 0 && (
                <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
                    <Button onClick={() => { setTab("today"); openRecorder(byState.today[0]); }}
                        className="h-14 w-full gap-2 text-base font-bold sm:h-12 sm:w-auto sm:px-8 [&_svg]:size-5">
                        <PhoneCall />اللي عليه الدور ({counts.today})
                    </Button>
                </div>
            )}

            {loading ? (
                <div className="flex justify-center p-16"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
            ) : filtered.length === 0 ? (
                <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
                    {tab === "today" ? "مفيش حاجة عليها الدور النهارده 👌" : "مفيش أوردرات هنا"}
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(r => {
                        const open = expanded === r.order_id;
                        const chip = followChip(r, now);
                        const phones = phoneNumbers(r.customer_phone);
                        const n = Number(r.followup_count) || 0;
                        return (
                            <article key={r.order_id} className="overflow-hidden rounded-xl border-2 bg-card shadow-sm">
                                <div className="space-y-3 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            {/* The same 8 characters printed on the waybill. */}
                                            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                                                <span className="font-mono text-lg font-black tracking-wider" dir="ltr">#{r.reference}</span>
                                                <span className="truncate text-base font-semibold">{r.customer_name || "—"}</span>
                                            </div>
                                            <p className="mt-0.5 text-sm text-muted-foreground">
                                                {[r.courier, r.governorate].filter(Boolean).join(" · ") || "—"}
                                            </p>
                                        </div>
                                        <span className="shrink-0 text-lg font-bold tabular-nums" dir="ltr">{formatCurrency(Number(r.total_amount))}</span>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                            r.bucket === "returning" ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                                                : r.bucket === "hold" ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                                                : "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300")}>
                                            {BUCKETS.find(b => b.key === r.bucket)?.label ?? r.status} · {r.days_stuck} يوم
                                        </span>
                                        <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", FOLLOW_TONE[chip.state])}>{chip.text}</span>
                                    </div>

                                    <OrderBrief brief={briefs[r.order_id]} total={Number(r.total_amount)} />

                                    {n > 0 && (
                                        <p className="text-sm">
                                            <span className="font-semibold">{outcomeLabel(r.last_outcome)}</span>
                                            <span className="text-muted-foreground"> · {ago(r.last_followup)}</span>
                                        </p>
                                    )}

                                    {activeBusiness && (
                                        <ShippingChatStatus state={chatStateOf(chatStates, r.customer_phone)} phone={phones[0] || r.customer_phone} now={now}
                                            businessId={activeBusiness.id} orderId={r.order_id}
                                            kind={r.bucket === "hold" ? "hold" : r.bucket === "returning" ? "returning" : null} />
                                    )}

                                    {phones.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">مفيش رقم مسجل</p>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                                            {phones.map(num => (
                                                <Button key={num} asChild variant="outline" className="h-12 gap-1.5 font-mono text-base tabular-nums sm:min-w-44 [&_svg]:size-5">
                                                    <a href={`tel:${num}`}><Phone /><span>{num}</span></a>
                                                </Button>
                                            ))}
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                                        <Button onClick={() => openRecorder(r)} disabled={!!busy}
                                            className="col-span-2 h-14 gap-2 text-base font-semibold sm:h-12 sm:min-w-44 sm:flex-1 [&_svg]:size-5">
                                            <ClipboardCheck />سجّل اللي حصل
                                        </Button>
                                        <Button variant="outline" disabled={!!busy} onClick={() => quick(r, "no_answer")}
                                            className="h-12 gap-2 border-orange-300 text-[15px] font-semibold text-orange-800 hover:bg-orange-50 dark:border-orange-900 dark:text-orange-300 sm:min-w-32 [&_svg]:size-5">
                                            {busy === `${r.order_id}:no_answer` ? <Loader2 className="animate-spin" /> : <PhoneMissed />}مابيردش
                                        </Button>
                                        <Button variant="outline" disabled={!!busy} onClick={() => quick(r, "phone_off")}
                                            className="h-12 gap-2 text-[15px] font-semibold sm:min-w-32 [&_svg]:size-5">
                                            {busy === `${r.order_id}:phone_off` ? <Loader2 className="animate-spin" /> : <PhoneOff />}مقفول
                                        </Button>
                                    </div>

                                    {n > 0 && (
                                        <button type="button"
                                            className="flex min-h-10 w-full items-center justify-center gap-1 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                                            onClick={() => { setExpanded(open ? null : r.order_id); if (!open) loadHistory(r.order_id); }}
                                            aria-expanded={open}>
                                            {open ? "اخفي المتابعات" : `المتابعات (${n})`}
                                            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
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
                    brief={recording ? briefs[recording.order_id] : undefined}
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
