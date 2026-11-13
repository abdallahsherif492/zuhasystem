"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, startOfMonth } from "date-fns";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchAll, supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { cn } from "@/lib/utils";
import { cairoDate, cairoDayStart, nextDay } from "@/lib/cairo-day";
import { DateRangePicker } from "@/components/date-range-picker";

/**
 * Advanced insights: what the period really made, where its orders went, what
 * the ads cost per order that mattered, and what the business is worth now.
 *
 * The same definitions as the dashboard's money panel (dashboard_money) and
 * Actual Returns, so the screens agree:
 *  - profit is earned on delivered orders only (orders.profit = total − cost −
 *    the courier's fee), less the courier's fee on returns, ads and running
 *    costs; orders still on the road are shown as expected, at the business's
 *    own recent delivery rate, never counted as earned;
 *  - ads are the "Ads" expenses booked in accounting (ads_expenses stopped
 *    being kept in October);
 *  - days are Cairo days.
 */

type Bucket = "waiting" | "cancelled" | "confirmed" | "transit" | "delivered" | "returned";

const bucketOf = (status: string | null): Bucket => {
    const s = (status || "").toLowerCase().trim();
    if (s === "waiting") return "waiting";
    if (s === "cancelled" || s === "canceled" || s === "unavailable") return "cancelled";
    if (s === "delivered" || s === "collected") return "delivered";
    if (s === "returned" || s === "returning") return "returned";
    if (s === "shipped" || s === "hold to redeliver") return "transit";
    return "confirmed"; // Pending, Processing, Prepared: confirmed, not yet with a courier
};

interface Order {
    created_at: string;
    status: string;
    total_amount: number | null;
    total_cost: number | null;
    actual_shipping_cost: number | null;
    profit: number | null;
    paid_amount: number | null;
}

interface Money {
    allowed?: boolean;
    ads: number;
    opex: number;
    payables: number;
    expenses_by_category: { category: string; amount: number }[];
}

const n = (v: unknown) => Number(v) || 0;
/** "−1,250 ج.م", the sign kept with the number inside Arabic text. */
const egp = (v: number) => `\u2066${Math.round(v) < 0 ? "−" : ""}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.abs(Math.round(v)))}\u2069 ج.م`;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

function InsightsContent() {
    const { activeBusiness } = useBusiness();
    const router = useRouter();
    const params = useSearchParams();
    const from = params.get("from");
    const to = params.get("to");
    const businessId = activeBusiness?.id;

    // Opens on this month.
    const defaulted = useRef(false);
    useEffect(() => {
        if (defaulted.current || (from && to)) return;
        defaulted.current = true;
        const q = new URLSearchParams(params.toString());
        q.set("from", format(startOfMonth(new Date()), "yyyy-MM-dd"));
        q.set("to", format(new Date(), "yyyy-MM-dd"));
        router.replace(`?${q.toString()}`, { scroll: false });
    }, [from, to, params, router]);

    const [state, setState] = useState<{
        key: string;
        orders: Order[];
        money: Money | null;
        adsByDay: Map<string, number>;
        deliveryRate: number | null;
        snapshot: Snapshot;
    } | null>(null);
    const key = `${businessId}|${from}|${to}`;

    useEffect(() => {
        if (!businessId || !from || !to) return;
        let gone = false;
        (async () => {
            const t0 = cairoDayStart(from);
            const t1 = cairoDayStart(nextDay(to));
            const ninety = new Date(Date.now() - 90 * 86_400_000).toISOString();
            const [orders, money, ads, decided, snapshot] = await Promise.all([
                fetchAll((a, b) => supabase.from("orders")
                    .select("created_at, status, total_amount, total_cost, actual_shipping_cost, profit, paid_amount")
                    .eq("business_id", businessId).gte("created_at", t0).lt("created_at", t1)
                    .or("order_type.is.null,order_type.eq.new").order("created_at").range(a, b)) as Promise<Order[]>,
                supabase.rpc("dashboard_money", { p_business_id: businessId, p_from: from, p_to: to }),
                fetchAll((a, b) => supabase.from("transactions").select("transaction_date, amount, category")
                    .eq("business_id", businessId).eq("type", "expense").ilike("category", "ads")
                    .gte("transaction_date", from).lte("transaction_date", to).range(a, b)),
                // The business's own delivery rate: orders of the last 90 days
                // that reached an end, delivered or back.
                fetchAll((a, b) => supabase.from("orders").select("status")
                    .eq("business_id", businessId).gte("created_at", ninety)
                    .in("status", ["Delivered", "Collected", "Returned", "Returning"]).range(a, b)),
                loadSnapshot(businessId),
            ]);
            if (gone) return;
            const adsByDay = new Map<string, number>();
            for (const t of ads as { transaction_date: string; amount: number }[]) {
                const d = String(t.transaction_date).slice(0, 10);
                adsByDay.set(d, (adsByDay.get(d) || 0) + Math.abs(n(t.amount)));
            }
            const won = (decided as { status: string }[]).filter(o => bucketOf(o.status) === "delivered").length;
            const m = money.error ? null : (money.data as Money);
            setState({
                key,
                orders,
                money: m && m.allowed !== false ? { ...m, ads: n(m.ads), opex: n(m.opex), payables: n(m.payables) } : null,
                adsByDay,
                deliveryRate: decided.length >= 20 ? won / decided.length : null,
                snapshot,
            });
        })().catch(e => console.error("insights failed:", e));
        return () => { gone = true; };
    }, [businessId, from, to, key]);

    const loading = !state || state.key !== key;

    return (
        <div className="mx-auto max-w-6xl space-y-8" dir="rtl">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">تحليلات متقدمة</h1>
                    <p className="mt-1 text-sm text-muted-foreground">الفترة كسبت كام فعلًا، الأوردرات راحت فين، الإعلانات كلّفت كام على الأوردر اللي وصل، والبيزنس قيمته كام دلوقتي.</p>
                </div>
                <DateRangePicker />
            </div>

            {loading ? (
                <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (
                <Report {...state!} from={from!} to={to!} />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// The business now
// ---------------------------------------------------------------------------

interface Snapshot {
    treasury: number;
    treasuries: { name: string; balance: number }[];
    withCouriers: number;
    inTransit: { count: number; value: number; courierFees: number };
    awaitingShipping: { count: number; value: number };
    stock: number;
    payables: number;
    invested: number;
    withdrawals: { date: string; amount: number }[];
}

async function loadSnapshot(businessId: string): Promise<Snapshot> {
    const [tr, cm, open, stock, pay, capital] = await Promise.all([
        supabase.rpc("get_treasury_balances", { p_business_id: businessId }),
        supabase.rpc("get_courier_collection_match", { p_business_id: businessId, p_from: "2020-01-01T00:00:00Z", p_to: new Date().toISOString() }),
        fetchAll((a, b) => supabase.from("orders").select("status, total_amount, paid_amount, actual_shipping_cost")
            .eq("business_id", businessId).in("status", ["Shipped", "Hold To redeliver", "Pending", "Processing", "Prepared"])
            .or("order_type.is.null,order_type.eq.new").range(a, b)),
        fetchAll((a, b) => supabase.from("variants").select("cost_price, stock_qty").eq("business_id", businessId).range(a, b)),
        supabase.rpc("get_total_payables", { p_business_id: businessId }),
        fetchAll((a, b) => supabase.from("transactions").select("type, amount, transaction_date")
            .eq("business_id", businessId).in("type", ["investment", "withdrawal"]).range(a, b)),
    ]);
    const treasuries = ((tr.data || []) as { account_name: string; balance: number }[])
        .filter(t => t.account_name).map(t => ({ name: t.account_name, balance: n(t.balance) }));
    const inTransit = { count: 0, value: 0, courierFees: 0 };
    const awaitingShipping = { count: 0, value: 0 };
    for (const o of open as { status: string; total_amount: number; paid_amount: number; actual_shipping_cost: number }[]) {
        // What is still to come in: the deposit is already in a treasury.
        const due = Math.max(0, n(o.total_amount) - n(o.paid_amount));
        if (bucketOf(o.status) === "transit") { inTransit.count++; inTransit.value += due; inTransit.courierFees += n(o.actual_shipping_cost); }
        else { awaitingShipping.count++; awaitingShipping.value += due; }
    }
    const caps = capital as { type: string; amount: number; transaction_date: string }[];
    return {
        treasury: treasuries.reduce((s, t) => s + t.balance, 0),
        treasuries,
        withCouriers: ((cm.data || []) as { outstanding: number }[]).reduce((s, r) => s + Math.max(0, n(r.outstanding)), 0),
        inTransit,
        awaitingShipping,
        stock: (stock as { cost_price: number; stock_qty: number }[]).reduce((s, v) => s + n(v.cost_price) * Math.max(0, n(v.stock_qty)), 0),
        payables: n(pay.data),
        invested: caps.reduce((s, t) => s + n(t.amount), 0),
        withdrawals: caps.filter(t => t.type === "withdrawal").map(t => ({ date: String(t.transaction_date).slice(0, 10), amount: Math.abs(n(t.amount)) })),
    };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function Report({ orders, money, adsByDay, deliveryRate, snapshot, from, to }: {
    orders: Order[]; money: Money | null; adsByDay: Map<string, number>; deliveryRate: number | null; snapshot: Snapshot; from: string; to: string;
}) {
    const f = useMemo(() => {
        const c = { waiting: 0, cancelled: 0, confirmed: 0, transit: 0, delivered: 0, returned: 0 } as Record<Bucket, number>;
        const v = { waiting: 0, cancelled: 0, confirmed: 0, transit: 0, delivered: 0, returned: 0 } as Record<Bucket, number>;
        let deliveredCost = 0, deliveredCourier = 0, deliveredProfit = 0, returnFees = 0, openProfit = 0, openFees = 0;
        for (const o of orders) {
            const b = bucketOf(o.status);
            c[b]++; v[b] += n(o.total_amount);
            if (b === "delivered") { deliveredCost += n(o.total_cost); deliveredCourier += n(o.actual_shipping_cost); deliveredProfit += n(o.profit); }
            if (b === "returned") returnFees += n(o.actual_shipping_cost);
            if (b === "transit" || b === "confirmed") { openProfit += n(o.profit); openFees += n(o.actual_shipping_cost); }
        }
        return { c, v, deliveredCost, deliveredCourier, deliveredProfit, returnFees, openProfit, openFees, total: orders.length };
    }, [orders]);

    const ads = money?.ads ?? [...adsByDay.values()].reduce((s, x) => s + x, 0);
    const opex = money?.opex ?? 0;
    const net = f.deliveredProfit - f.returnFees - ads - opex;
    const confirmedAll = f.c.confirmed + f.c.transit + f.c.delivered + f.c.returned;
    const decidedInPeriod = f.c.delivered + f.c.returned;
    const rate = deliveryRate;
    // Orders of the period still on their way, at the usual delivery rate:
    // the profit of those delivered, less the courier's fee on those returned.
    const expected = rate === null ? null : f.openProfit * rate - f.openFees * (1 - rate);

    return (
        <div className="space-y-10">
            {/* 1. The answer */}
            <section className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                <div className="rounded-2xl border bg-card p-6">
                    <h2 className="text-sm font-medium text-muted-foreground">صافي ربح الفترة لحد دلوقتي</h2>
                    <p className={cn("mt-2 text-4xl font-bold tabular-nums tracking-tight sm:text-5xl", net < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>{egp(net)}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                        من الأوردرات اللي وصلت للعميل بس ({f.c.delivered} أوردر)، بعد الإعلانات والمصاريف ومصاريف المرتجع.
                    </p>
                    {expected !== null && f.c.transit + f.c.confirmed > 0 && (
                        <div className="mt-5 rounded-xl bg-muted/50 p-4 text-sm">
                            <p>
                                لسه <span className="font-semibold">{f.c.transit + f.c.confirmed}</span> أوردر من الفترة دي في الطريق أو مستني يتشحن.
                                لو وصلوا بنسبة التوصيل بتاعتك ({Math.round(rate! * 100)}% آخر 90 يوم)، هيضيفوا حوالي
                                <span className={cn("mx-1 font-semibold tabular-nums", expected < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>{egp(expected)}</span>
                                والصافي يبقى حوالي <span className="font-semibold tabular-nums">{egp(net + expected)}</span>.
                            </p>
                        </div>
                    )}
                </div>
                <Waterfall rows={[
                    { label: "مبيعات الأوردرات اللي وصلت", value: f.v.delivered, strong: true },
                    { label: "تكلفة البضاعة", value: -f.deliveredCost },
                    { label: "شحن (اللي شركة الشحن خدته)", value: -f.deliveredCourier },
                    { label: "ربح الأوردرات اللي وصلت", value: f.deliveredProfit, strong: true, rule: true },
                    { label: `مصاريف شحن المرتجع (${f.c.returned} أوردر)`, value: -f.returnFees },
                    { label: "الإعلانات", value: -ads },
                    { label: "مصاريف التشغيل", value: -opex, hint: "كل المصاريف ما عدا الإعلانات ومشتريات البضاعة" },
                    { label: "الصافي", value: net, strong: true, rule: true },
                ]} />
            </section>

            {/* 2. Where the orders went */}
            <section className="space-y-4">
                <SectionTitle title="الأوردرات راحت فين" note={`${f.total} أوردر جديد اتعمل في الفترة`} />
                <Funnel c={f.c} v={f.v} total={f.total} />
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
                    <Kpi label="نسبة التأكيد" value={`${pct(confirmedAll, confirmedAll + f.c.cancelled)}%`} hint="من اللي اتقرر فيهم (اتأكد أو اتلغى)" />
                    <Kpi label="نسبة التوصيل" value={decidedInPeriod ? `${pct(f.c.delivered, decidedInPeriod)}%` : "—"} hint={`من اللي وصلوا لنهاية (${decidedInPeriod})`} />
                    <Kpi label="متوسط الأوردر اللي وصل" value={f.c.delivered ? egp(f.v.delivered / f.c.delivered) : "—"} />
                    <Kpi label="ربح الأوردر اللي وصل" value={f.c.delivered ? egp(f.deliveredProfit / f.c.delivered) : "—"} hint="قبل الإعلانات والمصاريف" />
                </div>
            </section>

            {/* 3. Ads */}
            <section className="space-y-4">
                <SectionTitle title="الإعلانات" note={`${egp(ads)} في الفترة، من مصاريف «Ads» في الحسابات`} />
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
                    <Kpi label="تكلفة الأوردر اللي جه" value={f.total ? egp(ads / f.total) : "—"} />
                    <Kpi label="تكلفة الأوردر المتأكد" value={confirmedAll ? egp(ads / confirmedAll) : "—"} />
                    <Kpi label="تكلفة الأوردر اللي وصل" value={f.c.delivered ? egp(ads / f.c.delivered) : "—"} hint="ده الرقم اللي بيهم" strong />
                    <Kpi label="العائد على الإعلان (ROAS)" value={ads ? `${(f.v.delivered / ads).toFixed(1)}×` : "—"} hint="مبيعات اللي وصل ÷ الإعلانات" />
                </div>
                <DailyChart orders={orders} adsByDay={adsByDay} from={from} to={to} />
            </section>

            {/* 4. The business now */}
            <ValueSection s={snapshot} rate={rate} />

            {money?.expenses_by_category?.length ? (
                <p className="text-center text-xs text-muted-foreground">
                    تفاصيل المصاريف في <Link href="/insights/expenses" className="underline underline-offset-4">تحليل المصاريف</Link>، والتحصيل الفعلي في <Link href="/insights/actual-returns" className="underline underline-offset-4">Actual Returns</Link>.
                </p>
            ) : null}
        </div>
    );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
    return (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{title}</h2>
            {note && <span className="text-sm text-muted-foreground">{note}</span>}
        </div>
    );
}

function Kpi({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
    return (
        <div className={cn("bg-card p-4", strong && "bg-muted/60")}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
            {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
    );
}

function Waterfall({ rows }: { rows: { label: string; value: number; strong?: boolean; rule?: boolean; hint?: string }[] }) {
    return (
        <div className="rounded-2xl border bg-card p-5">
            <ul className="space-y-2 text-sm">
                {rows.map(r => (
                    <li key={r.label} className={cn("flex items-baseline justify-between gap-3", r.rule && "border-t pt-2")}>
                        <span className={cn(r.strong ? "font-semibold" : "text-muted-foreground")}>
                            {r.label}
                            {r.hint && <span className="block text-[11px] font-normal text-muted-foreground">{r.hint}</span>}
                        </span>
                        <span className={cn("shrink-0 tabular-nums", r.strong && "font-semibold", r.value < 0 && "text-rose-700 dark:text-rose-400")}>{egp(r.value)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

const STAGES: { key: Bucket; label: string; tone: string; hint: string }[] = [
    { key: "delivered", label: "وصلت للعميل", tone: "bg-emerald-500", hint: "Delivered و Collected" },
    { key: "transit", label: "مع شركة الشحن", tone: "bg-sky-500", hint: "Shipped و Hold to redeliver" },
    { key: "confirmed", label: "متأكدة ولسه ماتشحنتش", tone: "bg-indigo-400", hint: "Pending و Processing و Prepared" },
    { key: "returned", label: "رجعت", tone: "bg-amber-500", hint: "Returned و Returning" },
    { key: "cancelled", label: "اتلغت", tone: "bg-rose-500", hint: "قبل الشحن" },
    { key: "waiting", label: "لسه مستنية تأكيد", tone: "bg-muted-foreground/40", hint: "Waiting" },
];

function Funnel({ c, v, total }: { c: Record<Bucket, number>; v: Record<Bucket, number>; total: number }) {
    return (
        <div className="space-y-4 rounded-2xl border bg-card p-5">
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={STAGES.map(s => `${s.label} ${c[s.key]}`).join("، ")}>
                {STAGES.map(s => c[s.key] > 0 && <div key={s.key} className={s.tone} style={{ width: `${(c[s.key] / Math.max(1, total)) * 100}%` }} />)}
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {STAGES.map(s => (
                    <li key={s.key} className="flex items-start gap-3">
                        <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", s.tone)} aria-hidden />
                        <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                                <span className="text-sm font-medium">{s.label}</span>
                                <span className="tabular-nums text-sm font-semibold">{c[s.key]} <span className="text-xs font-normal text-muted-foreground">({pct(c[s.key], total)}%)</span></span>
                            </span>
                            <span className="flex justify-between gap-2 text-xs text-muted-foreground">
                                <span>{s.hint}</span>
                                <span className="tabular-nums">{egp(v[s.key])}</span>
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function DailyChart({ orders, adsByDay, from, to }: { orders: Order[]; adsByDay: Map<string, number>; from: string; to: string }) {
    const data = useMemo(() => {
        const rows = new Map<string, { day: string; ads: number; orders: number; confirmed: number; delivered: number }>();
        for (let d = from; d <= to; d = nextDay(d)) rows.set(d, { day: d, ads: adsByDay.get(d) || 0, orders: 0, confirmed: 0, delivered: 0 });
        for (const o of orders) {
            const r = rows.get(cairoDate(o.created_at));
            if (!r) continue;
            r.orders++;
            const b = bucketOf(o.status);
            if (b !== "waiting" && b !== "cancelled") r.confirmed++;
            if (b === "delivered") r.delivered++;
        }
        return [...rows.values()].map(r => ({ ...r, label: r.day.slice(8) + "/" + r.day.slice(5, 7) }));
    }, [orders, adsByDay, from, to]);
    if (data.length < 2) return null;
    return (
        <div className="rounded-2xl border bg-card p-4">
            <p className="mb-2 text-sm font-medium">كل يوم: الإعلانات (عمود) والأوردرات (خطوط)</p>
            <div className="h-64" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis yAxisId="ads" tick={{ fontSize: 11 }} width={48} />
                        <YAxis yAxisId="orders" orientation="right" tick={{ fontSize: 11 }} width={32} allowDecimals={false} />
                        <Tooltip formatter={(value, name) => [name === "ads" ? egp(Number(value) || 0) : Number(value) || 0, name === "ads" ? "إعلانات" : name === "orders" ? "أوردرات جت" : name === "confirmed" ? "اتأكدت" : "وصلت"]} />
                        <Bar yAxisId="ads" dataKey="ads" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                        <Line yAxisId="orders" type="monotone" dataKey="orders" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
                        <Line yAxisId="orders" type="monotone" dataKey="confirmed" stroke="#6366f1" strokeWidth={2} dot={false} />
                        <Line yAxisId="orders" type="monotone" dataKey="delivered" stroke="#10b981" strokeWidth={2} dot={false} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-muted-foreground/25" />إعلانات</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-slate-400" />أوردرات جت</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-indigo-500" />اتأكدت</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-emerald-500" />وصلت</span>
            </div>
        </div>
    );
}

function ValueSection({ s, rate }: { s: Snapshot; rate: number | null }) {
    const r = rate ?? 0.75;
    // On the road: what comes in if they arrive at the usual rate, less the
    // courier's fee on all of them (paid whether delivered or returned).
    const transitExpected = s.inTransit.value * r - s.inTransit.courierFees;
    const awaitingExpected = s.awaitingShipping.value * r;
    const value = s.treasury + s.withCouriers + transitExpected + awaitingExpected + s.stock - s.payables;
    const growth = s.invested > 0 ? ((value - s.invested) / s.invested) * 100 : null;
    // Two withdrawals of the same amount on the same day look like one entered twice.
    const dupes = s.withdrawals.filter((w, i) => s.withdrawals.findIndex(x => x.date === w.date && x.amount === w.amount) !== i);

    const rows = [
        { label: "في الخزن", value: s.treasury, hint: s.treasuries.map(t => `${t.name}: ${egp(t.balance)}`).join(" · ") },
        { label: "عند شركات الشحن", value: s.withCouriers, hint: "أوردرات اتسلمت وفلوسها لسه ماتحصلتش" },
        { label: `في الطريق (${s.inTransit.count} أوردر)`, value: transitExpected, hint: `${egp(s.inTransit.value)} لو وصلوا كلهم؛ محسوب بنسبة التوصيل ${Math.round(r * 100)}% وناقص الشحن` },
        { label: `متأكدة ولسه ماتشحنتش (${s.awaitingShipping.count})`, value: awaitingExpected, hint: `بنسبة التوصيل ${Math.round(r * 100)}%` },
        { label: "المخزون (بالتكلفة)", value: s.stock },
        { label: "علينا للموردين", value: -s.payables },
    ];

    return (
        <section className="space-y-4">
            <SectionTitle title="البيزنس قيمته كام دلوقتي" note="مش مرتبطة بالفترة" />
            <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
                <div className="rounded-2xl border bg-card p-6">
                    <p className="text-sm text-muted-foreground">القيمة التقديرية</p>
                    <p className={cn("mt-1 text-4xl font-bold tabular-nums", value < 0 && "text-destructive")}>{egp(value)}</p>
                    <div className="mt-4 space-y-1 text-sm">
                        <p className="flex justify-between gap-3"><span className="text-muted-foreground">صافي الاستثمار (ضخ − سحب)</span><span className="tabular-nums">{egp(s.invested)}</span></p>
                        {growth !== null ? (
                            <p className="flex justify-between gap-3"><span className="text-muted-foreground">نمو عن الاستثمار</span><span className={cn("font-semibold tabular-nums", growth < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>{growth > 0 ? "+" : ""}{growth.toFixed(0)}%</span></p>
                        ) : (
                            <p className="text-xs text-muted-foreground">صافي الاستثمار بالسالب (اللي اتسحب أكتر من اللي اتضخ)، فنسبة النمو مالهاش معنى.</p>
                        )}
                    </div>
                    {dupes.length > 0 && (
                        <p className="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            فيه سحب استثمار متسجل مرتين بنفس المبلغ في نفس اليوم ({dupes.map(d => `${egp(d.amount)} يوم ${d.date}`).join("، ")}). لو اتسجل بالغلط امسحه من الحسابات.
                        </p>
                    )}
                    {s.treasuries.some(t => t.balance < 0) && (
                        <p className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            فيه خزنة رصيدها بالسالب. غالبًا فيه مصروف أو سحب متسجل من خزنة غلط، أو دخل ماتسجلش.
                        </p>
                    )}
                </div>
                <Waterfall rows={[...rows.map(x => ({ label: x.label, value: x.value, hint: x.hint })), { label: "القيمة التقديرية", value, strong: true, rule: true }]} />
            </div>
        </section>
    );
}

export default function InsightsPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <InsightsContent />
        </Suspense>
    );
}
