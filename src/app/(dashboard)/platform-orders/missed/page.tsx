"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
    Bot, CheckCircle2, ChevronDown, Loader2, MessageCircle, Phone, PhoneMissed, PlusCircle, RefreshCw, ShieldCheck, ThumbsDown, UserX,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { normalizeGovernorate } from "@/lib/governorates";
import { ago } from "@/components/orders/confirmation-attempts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * Missed orders: visitors who typed their phone into the store's order form
 * and never ordered. Captured by our own script on the store (public/leads.js),
 * scored for bot behaviour on the way in, and closed automatically when an
 * order with the same phone arrives from any channel. Backed by
 * 20261025_missed_leads.sql.
 *
 * A lead shows as missed only after a quiet quarter of an hour, so people who
 * are still finishing their order are not called mid-checkout. Then, unless it
 * is a bot, it becomes a Waiting order on "New from stores", where sales
 * confirm it like any other (20261101_missed_orders_in_queue.sql); this page
 * is the record behind them, and where bots are reviewed.
 */

interface Lead {
    id: string;
    phone: string;
    name: string | null;
    phone2: string | null;
    address: string | null;
    governorate: string | null;
    product: string | null;
    page_url: string | null;
    referrer: string | null;
    utm: Record<string, string> | null;
    bot_score: number;
    bot_reasons: string[];
    submitted: boolean;
    status: "open" | "bot" | "converted" | "contacted" | "dismissed" | "promoted";
    order_id: string | null;
    touches: number;
    first_seen_at: string;
    last_seen_at: string;
    outcome: string | null;
    handled_by: string | null;
    handled_at: string | null;
}

type Tab = "new" | "contacted" | "converted" | "bot" | "dismissed";
const QUIET_MINUTES = 15;

const OUTCOMES: { key: string; label: string; status: Lead["status"]; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: "will_order", label: "هيطلب / عملتله أوردر", status: "contacted", icon: CheckCircle2 },
    { key: "no_answer", label: "مابيردش", status: "contacted", icon: PhoneMissed },
    { key: "call_later", label: "كلمه وقت تاني", status: "contacted", icon: Phone },
    { key: "not_interested", label: "مش مهتم", status: "dismissed", icon: ThumbsDown },
    { key: "wrong_number", label: "رقم غلط", status: "dismissed", icon: UserX },
];
const outcomeLabel = (k: string | null) => OUTCOMES.find(o => o.key === k)?.label ?? k ?? "";

const source = (l: Lead) => {
    const u = l.utm || {};
    if (u.utm_source) return u.utm_source;
    if (u.fbclid) return "facebook";
    if (u.ttclid) return "tiktok";
    const r = (l.referrer || "").toLowerCase();
    if (/facebook|fb\./.test(r)) return "facebook";
    if (/instagram/.test(r)) return "instagram";
    if (/tiktok/.test(r)) return "tiktok";
    if (/google/.test(r)) return "google";
    return null;
};

export default function MissedOrdersPage() {
    const { activeBusiness, currentUser } = useBusiness();
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);
    const [tab, setTab] = useState<Tab>("new");
    const [now, setNow] = useState(() => Date.now());
    const leadKey = activeBusiness?.theme_config?.integrations?.platforms?.easyorders?.leadKey as string | undefined;

    const load = useCallback(async (quiet = false) => {
        if (!activeBusiness) return;
        if (!quiet) setLoading(true);
        // Close the ones that have ordered since, from any channel.
        const refresh = await supabase.rpc("missed_leads_refresh", { p_business_id: activeBusiness.id });
        const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
        const { data, error } = await supabase.from("missed_leads")
            .select("id, phone, name, phone2, address, governorate, product, page_url, referrer, utm, bot_score, bot_reasons, submitted, status, order_id, touches, first_seen_at, last_seen_at, outcome, handled_by, handled_at")
            .eq("business_id", activeBusiness.id).gte("last_seen_at", since)
            .order("last_seen_at", { ascending: false }).limit(1000);
        if (error || refresh.error?.code === "PGRST202") {
            setMissing(/missed_leads|schema cache|does not exist/i.test(`${error?.message} ${refresh.error?.message}`));
        } else {
            setMissing(false);
            setLeads((data as Lead[]) || []);
        }
        setNow(Date.now());
        if (!quiet) setLoading(false);
    }, [activeBusiness]);

    useEffect(() => {
        load();
        const timer = setInterval(() => { if (document.visibilityState === "visible") load(true); }, 60_000);
        return () => clearInterval(timer);
    }, [load]);

    const quiet = (l: Lead) => now - new Date(l.last_seen_at).getTime() >= QUIET_MINUTES * 60_000;
    const groups = useMemo(() => ({
        new: leads.filter(l => l.status === "open" && quiet(l)),
        filling: leads.filter(l => l.status === "open" && !quiet(l)),
        contacted: leads.filter(l => l.status === "contacted"),
        converted: leads.filter(l => l.status === "converted" || l.status === "promoted"),
        bot: leads.filter(l => l.status === "bot"),
        dismissed: leads.filter(l => l.status === "dismissed"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [leads, now]);

    async function setStatus(l: Lead, status: Lead["status"], outcome: string | null) {
        const patch = { status, outcome, handled_by: currentUser?.email ?? null, handled_at: new Date().toISOString() };
        setLeads(ls => ls.map(x => (x.id === l.id ? { ...x, ...patch } : x)));
        const { error } = await supabase.from("missed_leads").update(patch).eq("id", l.id);
        if (error) { toast.error("ماتسجلش، جرّب تاني"); load(true); }
    }

    const newOrderHref = (l: Lead) => {
        const q = new URLSearchParams();
        if (l.name) q.set("name", l.name);
        q.set("phone", l.phone);
        if (l.phone2) q.set("phone2", l.phone2);
        if (l.address) q.set("address", l.address);
        const gov = normalizeGovernorate(l.governorate);
        if (gov) q.set("gov", gov);
        q.set("lead", l.id);
        return `/orders/new?${q.toString()}`;
    };

    const tabs: { key: Tab; label: string; count: number; tone?: string }[] = [
        { key: "new", label: "جديدة", count: groups.new.length, tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" },
        { key: "contacted", label: "اتكلمت", count: groups.contacted.length },
        { key: "converted", label: "اتنقلت للأوردرات", count: groups.converted.length, tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200" },
        { key: "bot", label: "بوتات", count: groups.bot.length, tone: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200" },
        { key: "dismissed", label: "اتقفلت", count: groups.dismissed.length },
    ];
    const list = groups[tab];

    return (
        <div className="space-y-5" dir="rtl">
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">طلبات ناقصة</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        ناس كتبوا رقمهم في فورم الطلب في المتجر ومشيوا من غير ما يطلبوا. بعد {QUIET_MINUTES} دقيقة من آخر حركة، اللي مش بوت
                        بيتنقل لوحده لـ <Link href="/platform-orders" className="font-medium underline">جديدة من المتاجر</Link> كأوردر عليه علامة «طلب ناقص»، والسيلز بيأكدوه من هناك.
                        البوتات بتفضل هنا في تاب لوحدها.
                    </p>
                </div>
                <Button variant="outline" onClick={() => load()} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />تحديث</Button>
            </div>

            {missing ? (
                <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                    شغّل الـ migration دي في Supabase الأول: <code className="rounded bg-muted px-1" dir="ltr">supabase/migrations/20261025_missed_leads.sql</code>
                </div>
            ) : !leadKey ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                    لسه سكريبت التتبع مش متركّب في المتجر. من <Link href="/settings?tab=integrations" className="font-medium underline">الإعدادات ← Integrations ← EasyOrders</Link> اعمل كود التتبع وحطه في EasyOrders.
                </div>
            ) : null}

            <div className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/50 p-1 sm:grid-cols-5">
                {tabs.map(t => (
                    <button key={t.key} type="button" onClick={() => setTab(t.key)}
                            className={cn("flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                tab === t.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                        {t.label}
                        <span className={cn("rounded-full px-2 text-xs font-bold tabular-nums", t.count && t.tone ? t.tone : "bg-muted text-foreground")}>{t.count}</span>
                    </button>
                ))}
            </div>
            {tab === "new" && groups.filling.length > 0 && (
                <p className="text-xs text-muted-foreground">{groups.filling.length} لسه بيكملوا الطلب دلوقتي، هيظهروا هنا لو مالطلبوش خلال {QUIET_MINUTES} دقيقة.</p>
            )}

            {loading ? (
                <div className="flex justify-center p-16"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
            ) : list.length === 0 ? (
                <div className="rounded-xl border p-12 text-center text-sm text-muted-foreground">
                    {tab === "new" ? "مفيش طلبات ناقصة دلوقتي." : tab === "bot" ? "مفيش بوتات اتمسكت." : "مفيش حاجة هنا."}
                </div>
            ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                    {list.map(l => <LeadCard key={l.id} l={l} tab={tab} newOrderHref={newOrderHref(l)} onStatus={setStatus} />)}
                </div>
            )}
        </div>
    );
}

function LeadCard({ l, tab, newOrderHref, onStatus }: {
    l: Lead; tab: Tab; newOrderHref: string; onStatus: (l: Lead, status: Lead["status"], outcome: string | null) => void;
}) {
    const [showReasons, setShowReasons] = useState(false);
    const src = source(l);
    const wa = `https://wa.me/2${l.phone}?text=${encodeURIComponent(`أهلاً ${l.name || ""}، شفنا إنك كنت بتطلب${l.product ? ` ${l.product}` : ""} ومكملتش الطلب. تحب نكمّله لك؟`)}`;
    return (
        <article className={cn("rounded-xl border bg-card p-4", l.status === "bot" && "opacity-80")}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-base font-semibold">{l.name || "من غير اسم"}</div>
                    <a href={`tel:${l.phone}`} className="font-mono text-xl font-bold tracking-wide hover:underline" dir="ltr">{l.phone}</a>
                    {l.phone2 && <span className="ms-2 font-mono text-sm text-muted-foreground" dir="ltr">{l.phone2}</span>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
                    <span>{ago(l.last_seen_at)}</span>
                    {l.touches > 1 && <span className="rounded-full bg-muted px-2">رجع {l.touches} مرات</span>}
                    {src && <span className="rounded-full bg-sky-50 px-2 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">{src}</span>}
                </div>
            </div>

            <div className="mt-2 space-y-0.5 text-sm">
                {l.product && <div className="truncate"><span className="text-muted-foreground">كان بيطلب: </span>{l.page_url ? <a href={l.page_url} target="_blank" rel="noreferrer" className="hover:underline">{l.product}</a> : l.product}</div>}
                {(l.governorate || l.address) && <div className="truncate text-muted-foreground">{[l.governorate, l.address].filter(Boolean).join("، ")}</div>}
                {l.submitted && l.status === "open" && <div className="text-xs font-medium text-amber-700">داس على زرار الطلب بس الأوردر ماوصلش</div>}
                {l.status === "converted" && l.order_id && <Link href={`/orders/${l.order_id}`} className="text-xs font-medium text-emerald-700 hover:underline">طلب: #{l.order_id.slice(0, 8)}</Link>}
                {l.status === "promoted" && <Link href="/platform-orders" className="text-xs font-medium text-violet-700 hover:underline">مستني التأكيد في جديدة من المتاجر</Link>}
                {l.outcome && <div className="text-xs text-muted-foreground">{outcomeLabel(l.outcome)}{l.handled_by ? `، ${l.handled_by.split("@")[0]}` : ""}{l.handled_at ? ` ${ago(l.handled_at)}` : ""}</div>}
            </div>

            {(l.bot_score > 0 || tab === "bot") && (
                <button type="button" onClick={() => setShowReasons(v => !v)}
                        className={cn("mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            l.bot_score >= 50 ? "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200" : "bg-muted text-muted-foreground")}>
                    <Bot className="h-3.5 w-3.5" />احتمال بوت {l.bot_score}%
                    <ChevronDown className={cn("h-3 w-3 transition-transform", showReasons && "rotate-180")} />
                </button>
            )}
            {showReasons && l.bot_reasons.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">{l.bot_reasons.map(r => <li key={r}>{r}</li>)}</ul>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                {tab === "bot" ? (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onStatus(l, "open", null)}>
                        <ShieldCheck className="h-4 w-4" />مش بوت
                    </Button>
                ) : (
                    <>
                        <Button asChild size="sm" variant="outline" className="gap-1.5"><a href={`tel:${l.phone}`}><Phone className="h-4 w-4" />اتصل</a></Button>
                        <Button asChild size="sm" variant="outline" className="gap-1.5 text-emerald-700 dark:text-emerald-400"><a href={wa} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />واتساب</a></Button>
                        {l.status !== "converted" && l.status !== "promoted" && (
                            <>
                                <Button asChild size="sm" className="gap-1.5"><Link href={newOrderHref}><PlusCircle className="h-4 w-4" />اعمل أوردر</Link></Button>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button size="sm" variant="outline" className="gap-1">سجّل النتيجة<ChevronDown className="h-3.5 w-3.5" /></Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        {OUTCOMES.map(o => (
                                            <DropdownMenuItem key={o.key} onSelect={() => onStatus(l, o.status, o.key)} className="gap-2">
                                                <o.icon className="h-4 w-4 opacity-70" />{o.label}
                                            </DropdownMenuItem>
                                        ))}
                                        <DropdownMenuItem onSelect={() => onStatus(l, "bot", "marked_bot")} className="gap-2"><Bot className="h-4 w-4 opacity-70" />ده بوت</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </>
                        )}
                    </>
                )}
            </div>
        </article>
    );
}
