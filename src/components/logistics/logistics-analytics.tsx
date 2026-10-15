"use client";

import Link from "next/link";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import { formatCurrency, cn } from "@/lib/utils";

/**
 * Logistics in numbers, built from the orders the page already loaded (so
 * every figure follows its filters): where the period's orders are between
 * the warehouse and the customer, how each courier and each governorate
 * delivers, day by day, and what has been on the road too long.
 *
 * An order is counted by its current status:
 *   في المخزن   Pending, Processing, Prepared
 *   في الطريق   Shipped, Hold To redeliver
 *   اتسلم       Delivered, Collected
 *   مرتجع       Returning, Returned
 * Waiting, Cancelled and Unavailable never left, so they sit outside the
 * pipeline. Delivery rate is delivered ÷ (delivered + returned), as on the
 * dashboard.
 */

export interface LogisticsOrder {
    id: string;
    created_at: string;
    status: string | null;
    status_changed_at?: string | null;
    total_amount: number | null;
    shipping_company_id: string | null;
    customer_info: { governorate?: string } | null;
}

export type Stage = "warehouse" | "transit" | "delivered" | "returned" | "out";

export function stageOf(status: string | null | undefined): Stage {
    switch ((status || "").toLowerCase().trim()) {
        case "pending": case "processing": case "prepared": return "warehouse";
        case "shipped": case "hold to redeliver": return "transit";
        case "delivered": case "collected": return "delivered";
        case "returning": case "returned": return "returned";
        default: return "out";
    }
}

/** A shipment on the road this long is followed up on the shipping issues page. */
export const STUCK_AFTER_DAYS = 5;

const int = (v: number) => Math.round(v).toLocaleString("en");
const money = (v: number) => formatCurrency(Math.round(v)).replace(/\.00$/, "");
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
const val = (o: LogisticsOrder) => Number(o.total_amount) || 0;
const daysSince = (iso: string | null | undefined) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : 0);

const STAGES: { key: Exclude<Stage, "out">; ar: string; en: string; bar: string; text: string }[] = [
    { key: "warehouse", ar: "في المخزن", en: "In warehouse", bar: "bg-slate-400", text: "text-slate-700 dark:text-slate-300" },
    { key: "transit", ar: "في الطريق", en: "On the road", bar: "bg-sky-500", text: "text-sky-700 dark:text-sky-400" },
    { key: "delivered", ar: "اتسلم", en: "Delivered", bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
    { key: "returned", ar: "مرتجع", en: "Returned", bar: "bg-red-400", text: "text-red-700 dark:text-red-400" },
];

function summarise(orders: LogisticsOrder[]) {
    const s = { warehouse: { n: 0, v: 0 }, transit: { n: 0, v: 0 }, delivered: { n: 0, v: 0 }, returned: { n: 0, v: 0 }, out: { n: 0, v: 0 } };
    for (const o of orders) { const k = stageOf(o.status); s[k].n++; s[k].v += val(o); }
    return s;
}

// ---------------------------------------------------------------------------
// The headline
// ---------------------------------------------------------------------------

export function LogisticsScoreboard({ orders, ar }: { orders: LogisticsOrder[]; ar: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const s = summarise(orders);
    const shipped = s.transit.n + s.delivered.n + s.returned.n;
    const shippedValue = s.transit.v + s.delivered.v + s.returned.v;
    const deliveryRate = pct(s.delivered.n, s.delivered.n + s.returned.n);
    const pipeline = s.warehouse.n + shipped;
    const stuck = orders.filter(o => stageOf(o.status) === "transit" && daysSince(o.status_changed_at || o.created_at) >= STUCK_AFTER_DAYS);

    return (
        <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border-2 bg-card p-5 sm:p-6">
                    <div className="text-base font-semibold text-muted-foreground">{t("الشحنات اللي خرجت", "Shipments sent")}</div>
                    <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
                        <span className="text-6xl font-bold tabular-nums leading-none tracking-tight">{int(shipped)}</span>
                        <span className="text-lg text-muted-foreground">{t("شحنة", "shipments")}</span>
                    </div>
                    <div className="mt-3 text-3xl font-semibold tabular-nums sm:text-4xl"><span dir="ltr">{money(shippedValue)}</span></div>
                </div>

                <div className="rounded-2xl bg-emerald-600 p-5 text-white shadow-sm sm:p-6 dark:bg-emerald-700">
                    <div className="text-base font-semibold text-emerald-50">{t("اتسلم للعميل", "Delivered")}</div>
                    <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
                        <span className="text-6xl font-bold tabular-nums leading-none tracking-tight">{int(s.delivered.n)}</span>
                        <span className="text-lg text-emerald-50">{t("أوردر", "orders")}</span>
                        {deliveryRate !== null && (
                            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-sm font-semibold tabular-nums">
                                {t(`${deliveryRate.toFixed(0)}% نسبة التسليم`, `${deliveryRate.toFixed(0)}% delivery rate`)}
                            </span>
                        )}
                    </div>
                    <div className="mt-3 text-3xl font-bold tabular-nums sm:text-4xl"><span dir="ltr">{money(s.delivered.v)}</span></div>
                </div>
            </div>

            {/* From the warehouse to the customer */}
            <div className="rounded-2xl border bg-card p-4 sm:p-5">
                {pipeline > 0 && (
                    <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-muted" role="img"
                         aria-label={STAGES.map(x => `${ar ? x.ar : x.en} ${s[x.key].n}`).join("، ")}>
                        {STAGES.filter(x => s[x.key].n > 0).map(x => (
                            <div key={x.key} className={x.bar} style={{ width: `${(s[x.key].n / pipeline) * 100}%` }} />
                        ))}
                    </div>
                )}
                <div className="grid grid-cols-2 gap-3 border-b pb-4 sm:grid-cols-4">
                    {STAGES.map(x => (
                        <div key={x.key} className="min-w-0">
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", x.bar)} aria-hidden />{ar ? x.ar : x.en}
                            </div>
                            <div className={cn("mt-1 text-3xl font-bold tabular-nums leading-tight", x.text)}>{int(s[x.key].n)}</div>
                            <div className="truncate text-base font-semibold tabular-nums text-foreground/80"><span dir="ltr">{money(s[x.key].v)}</span></div>
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-4 text-sm">
                    <span>
                        <span className="text-muted-foreground">{t("نسبة المرتجع", "Return rate")} </span>
                        <span className="font-semibold tabular-nums">{s.delivered.n + s.returned.n ? `${(100 - (deliveryRate ?? 0)).toFixed(0)}%` : "—"}</span>
                    </span>
                    {stuck.length > 0 ? (
                        <Link href="/logistics/issues" className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 font-semibold text-red-800 hover:bg-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-red-950/60 dark:text-red-300">
                            {t(`${int(stuck.length)} شحنة في الطريق من ${STUCK_AFTER_DAYS} أيام أو أكتر (${money(stuck.reduce((a, o) => a + val(o), 0))})، تابعها`,
                               `${int(stuck.length)} on the road ${STUCK_AFTER_DAYS}+ days (${money(stuck.reduce((a, o) => a + val(o), 0))}), follow up`)}
                        </Link>
                    ) : (
                        <span className="text-emerald-700 dark:text-emerald-400">{t("مفيش شحنات متأخرة في الطريق.", "Nothing late on the road.")}</span>
                    )}
                    {s.out.n > 0 && (
                        <span className="text-muted-foreground">
                            {t(`${int(s.out.n)} أوردر ملغي أو لسه مستني تأكيد، مش محسوب هنا`, `${int(s.out.n)} cancelled or unconfirmed, not counted here`)}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Couriers and governorates
// ---------------------------------------------------------------------------

interface Row { key: string; label: string; sent: number; delivered: number; transit: number; returned: number; deliveredValue: number }

function group(orders: LogisticsOrder[], keyOf: (o: LogisticsOrder) => string, labelOf: (k: string) => string): Row[] {
    const m = new Map<string, Row>();
    for (const o of orders) {
        const st = stageOf(o.status);
        if (st === "warehouse" || st === "out") continue;
        const k = keyOf(o);
        const r = m.get(k) ?? { key: k, label: labelOf(k), sent: 0, delivered: 0, transit: 0, returned: 0, deliveredValue: 0 };
        r.sent++;
        if (st === "delivered") { r.delivered++; r.deliveredValue += val(o); }
        if (st === "transit") r.transit++;
        if (st === "returned") r.returned++;
        m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.sent - a.sent);
}

const rateTone = (r: number | null) =>
    r === null ? "text-muted-foreground" : r >= 80 ? "text-emerald-700 dark:text-emerald-400" : r >= 65 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
const rateBar = (r: number | null) => (r === null ? "bg-muted" : r >= 80 ? "bg-emerald-500" : r >= 65 ? "bg-amber-400" : "bg-red-400");

function PerformanceTable({ title, description, nameHead, rows, ar, limit, compact }: {
    title: string; description: string; nameHead: string; rows: Row[]; ar: boolean; limit?: number;
    /** For a narrow column: the name, how many, the rate and the returns. */
    compact?: boolean;
}) {
    const t = (a: string, e: string) => (ar ? a : e);
    const shown = limit ? rows.slice(0, limit) : rows;
    return (
        <div className="min-w-0 rounded-2xl border bg-card">
            <div className="border-b px-4 py-3 sm:px-5">
                <h3 className="font-semibold">{title}</h3>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            {shown.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">{t("مفيش شحنات في الفترة دي.", "No shipments in this period.")}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className={cn("w-full text-sm", compact ? "min-w-[320px]" : "min-w-[520px]")}>
                        <thead className="text-xs text-muted-foreground">
                            <tr className="[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                                <th>{nameHead}</th>
                                <th>{t("اتبعت", "Sent")}</th>
                                <th>{t("نسبة التسليم", "Delivery rate")}</th>
                                {!compact && <th>{t("في الطريق", "On the road")}</th>}
                                <th>{t("مرتجع", "Returned")}</th>
                                {!compact && <th className="text-end">{t("قيمة المتسلّم", "Delivered value")}</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {shown.map(r => {
                                const rate = pct(r.delivered, r.delivered + r.returned);
                                return (
                                    <tr key={r.key} className="[&>td]:px-4 [&>td]:py-2.5">
                                        <td className="max-w-[12rem] truncate font-medium" title={r.label}>{r.label}</td>
                                        <td className="font-semibold tabular-nums">{int(r.sent)}</td>
                                        <td>
                                            <div className="flex items-center gap-2">
                                                <span className={cn("w-10 font-bold tabular-nums", rateTone(rate))}>{rate === null ? "—" : `${rate.toFixed(0)}%`}</span>
                                                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                                                    <div className={cn("h-full", rateBar(rate))} style={{ width: `${rate ?? 0}%` }} />
                                                </div>
                                            </div>
                                        </td>
                                        {!compact && <td className="tabular-nums text-sky-700 dark:text-sky-400">{int(r.transit)}</td>}
                                        <td className="tabular-nums text-red-700 dark:text-red-400">{int(r.returned)}</td>
                                        {!compact && <td className="text-end font-medium tabular-nums"><span dir="ltr">{money(r.deliveredValue)}</span></td>}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export function CourierPerformance({ orders, companies, ar }: { orders: LogisticsOrder[]; companies: { id: string; name: string }[]; ar: boolean }) {
    const names = new Map(companies.map(c => [c.id, c.name]));
    const rows = group(orders, o => o.shipping_company_id || "none", k => (k === "none" ? (ar ? "من غير شركة" : "No courier") : names.get(k) || (ar ? "شركة اتشالت" : "Removed courier")));
    return (
        <PerformanceTable ar={ar} rows={rows}
            title={ar ? "شركات الشحن" : "Couriers"}
            description={ar ? "كل شركة بعتنالها كام، وسلّمت كام، ورجّعت كام." : "What each courier was given, delivered and returned."}
            nameHead={ar ? "الشركة" : "Courier"} />
    );
}

export function GovernoratePerformance({ orders, ar }: { orders: LogisticsOrder[]; ar: boolean }) {
    const rows = group(orders, o => o.customer_info?.governorate || "—", k => k);
    return (
        <PerformanceTable ar={ar} rows={rows} limit={10} compact
            title={ar ? "المحافظات" : "Governorates"}
            description={ar ? "أكتر 10 محافظات شحن. النسبة الحمرا معناها مرتجع كتير هناك." : "The ten busiest. A red rate means many returns there."}
            nameHead={ar ? "المحافظة" : "Governorate"} />
    );
}

// ---------------------------------------------------------------------------
// Day by day, and what is late
// ---------------------------------------------------------------------------

export function DailyOutcomes({ orders, ar }: { orders: LogisticsOrder[]; ar: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const days = new Map<string, { day: string; sort: string; warehouse: number; transit: number; delivered: number; returned: number }>();
    for (const o of orders) {
        const st = stageOf(o.status);
        if (st === "out") continue;
        const d = new Date(o.created_at);
        const sort = format(d, "yyyy-MM-dd");
        const row = days.get(sort) ?? { day: format(d, "dd/MM"), sort, warehouse: 0, transit: 0, delivered: 0, returned: 0 };
        row[st]++;
        days.set(sort, row);
    }
    const data = [...days.values()].sort((a, b) => a.sort.localeCompare(b.sort));
    return (
        <div className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5">
            <h3 className="font-semibold">{t("يوم بيوم", "Day by day")}</h3>
            <p className="mb-3 text-xs text-muted-foreground">{t("أوردرات كل يوم، وكل واحد وصل لفين دلوقتي.", "Each day's orders, by where each one is now.")}</p>
            {data.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">{t("مفيش أوردرات في الفترة دي.", "No orders in this period.")}</p>
            ) : (
                <div dir="ltr">
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={data} margin={{ left: -16, right: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                            <XAxis dataKey="day" fontSize={11} tickLine={false} axisLine={false} />
                            <YAxis fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip contentStyle={{ borderRadius: 10 }} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="delivered" stackId="s" name={t("اتسلم", "Delivered")} fill="#10b981" />
                            <Bar dataKey="transit" stackId="s" name={t("في الطريق", "On the road")} fill="#0ea5e9" />
                            <Bar dataKey="returned" stackId="s" name={t("مرتجع", "Returned")} fill="#f87171" />
                            <Bar dataKey="warehouse" stackId="s" name={t("في المخزن", "In warehouse")} fill="#94a3b8" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}

const AGE_BUCKETS = [
    { max: 3, ar: "أقل من 3 أيام", en: "Under 3 days", bar: "bg-emerald-500" },
    { max: STUCK_AFTER_DAYS, ar: `3 لـ ${STUCK_AFTER_DAYS - 1} أيام`, en: `3–${STUCK_AFTER_DAYS - 1} days`, bar: "bg-amber-400" },
    { max: 10, ar: `${STUCK_AFTER_DAYS} لـ 9 أيام`, en: `${STUCK_AFTER_DAYS}–9 days`, bar: "bg-orange-500" },
    { max: Infinity, ar: "10 أيام أو أكتر", en: "10 days or more", bar: "bg-red-500" },
];

/** Shipments on the road, by how long since they left (or last changed). */
export function TransitAging({ orders, ar }: { orders: LogisticsOrder[]; ar: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const transit = orders.filter(o => stageOf(o.status) === "transit");
    const buckets = AGE_BUCKETS.map(b => ({ ...b, n: 0, v: 0 }));
    for (const o of transit) {
        const d = daysSince(o.status_changed_at || o.created_at);
        const b = buckets.find(x => d < x.max)!;
        b.n++; b.v += val(o);
    }
    const max = Math.max(1, ...buckets.map(b => b.n));
    return (
        <div className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="font-semibold">{t("في الطريق من إمتى", "How long on the road")}</h3>
                    <p className="text-xs text-muted-foreground">{t(`${int(transit.length)} شحنة في الطريق دلوقتي.`, `${int(transit.length)} shipments on the road now.`)}</p>
                </div>
                <Link href="/logistics/issues" className="shrink-0 text-sm text-primary underline-offset-4 hover:underline">{t("مشاكل الشحن", "Shipping issues")}</Link>
            </div>
            <ul className="mt-4 space-y-3">
                {buckets.map(b => (
                    <li key={b.en}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span>{ar ? b.ar : b.en}</span>
                            <span className="tabular-nums"><span className="text-lg font-bold">{int(b.n)}</span> <span className="text-xs text-muted-foreground" dir="ltr">{money(b.v)}</span></span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                            <div className={cn("h-full rounded-full", b.bar)} style={{ width: `${(b.n / max) * 100}%` }} />
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
