"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Activity, MapPin, Package, TrendingUp, TrendingDown } from "lucide-react";
import { format } from "date-fns";
import {
    ResponsiveContainer, ComposedChart, AreaChart, Area, Bar, Line,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Cell,
} from "recharts";

interface FunnelRow {
    day: string;
    orders_count: number; confirmed_count: number; cancelled_count: number;
    waiting_count: number; delivered_count: number; returned_count: number;
    in_transit_count: number; items_count: number; all_items_count: number;
    sales_value: number; confirmed_value: number; delivered_value: number;
    confirm_rate: number | null; confirm_rate_decided: number | null;
    delivery_rate: number | null; settled_rate: number | null;
    items_per_order: number | null; avg_order_value: number | null;
}

interface GovRow {
    governorate: string; orders_count: number; confirmed_count: number;
    delivered_count: number; returned_count: number; delivery_rate: number | null;
    sales_value: number; delivered_value: number; avg_order_value: number | null;
    shipping_cost: number; profit: number;
}

interface ProductRow {
    product_id: string; product_name: string; units: number; orders_count: number;
    revenue: number; delivered_units: number; returned_units: number;
    return_rate: number | null; avg_price: number | null;
}

/**
 * The dashboard's numbers, broken out by day and by where the orders came from.
 *
 * The tiles above say what the period totalled. That is the wrong shape for
 * every question worth asking of it — a confirmation rate of 88% is only
 * useful next to last week's, a return rate only means something once you know
 * which governorate is producing it, and a best-selling product that comes back
 * a third of the time is not a best-seller.
 *
 * Everything is aggregated in SQL and dated by when the order was placed, so a
 * parcel that came back on Friday counts against the Monday that produced it.
 */
export function AdvancedAnalytics({ from, to }: { from: string | null; to: string | null }) {
    const { activeBusiness } = useBusiness();
    const { t } = useLanguage();

    const [funnel, setFunnel] = useState<FunnelRow[]>([]);
    const [govs, setGovs] = useState<GovRow[]>([]);
    const [products, setProducts] = useState<ProductRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);
    const [mode, setMode] = useState<"counts" | "rates">("counts");
    const [govSort, setGovSort] = useState<"orders_count" | "delivery_rate" | "profit">("orders_count");

    const load = useCallback(async () => {
        if (!activeBusiness || !from) return;
        setLoading(true);
        const args = {
            p_business_id: activeBusiness.id,
            p_from: new Date(`${from}T00:00:00`).toISOString(),
            // Inclusive end date from the picker, exclusive bound in the query.
            p_to: new Date(new Date(`${(to || from)}T00:00:00`).getTime() + 86400000).toISOString(),
        };
        const [f, g, p] = await Promise.all([
            supabase.rpc("get_daily_funnel", args),
            supabase.rpc("get_governorate_performance", args),
            supabase.rpc("get_product_performance", { ...args, p_limit: 15 }),
        ]);
        if (f.error) { setMissing(true); setFunnel([]); setGovs([]); setProducts([]); }
        else {
            setMissing(false);
            setFunnel((f.data || []) as FunnelRow[]);
            setGovs((g.data || []) as GovRow[]);
            setProducts((p.data || []) as ProductRow[]);
        }
        setLoading(false);
    }, [activeBusiness, from, to]);

    useEffect(() => { load(); }, [load]);

    /**
     * Period totals, recomputed from the daily rows.
     *
     * Rates are summed-then-divided, never an average of the daily rates: a day
     * with four orders would otherwise weigh the same as a day with four
     * hundred and the headline would drift away from the truth.
     */
    const totals = useMemo(() => {
        const s = (k: keyof FunnelRow) => funnel.reduce((a, r) => a + Number(r[k] || 0), 0);
        const orders = s("orders_count"), confirmed = s("confirmed_count");
        const delivered = s("delivered_count"), returned = s("returned_count");
        const resolved = delivered + returned;
        return {
            orders, confirmed, delivered, returned, resolved,
            cancelled: s("cancelled_count"), waiting: s("waiting_count"),
            inTransit: s("in_transit_count"), items: s("items_count"),
            sales: s("sales_value"), confirmedValue: s("confirmed_value"),
            deliveredValue: s("delivered_value"),
            confirmRate: orders ? (100 * confirmed) / orders : null,
            // Of orders someone has actually decided on. An order placed an
            // hour ago is still Waiting and would otherwise drag today down.
            confirmRateDecided: (confirmed + s("cancelled_count"))
                ? (100 * confirmed) / (confirmed + s("cancelled_count")) : null,
            // Collected out of every confirmed order — the definition the
            // Moderators League uses, so the two sections cannot disagree.
            deliveryRate: confirmed ? (100 * delivered) / confirmed : null,
            // And out of parcels that have finished moving, which is the
            // courier's performance rather than the month's.
            settledRate: resolved ? (100 * delivered) / resolved : null,
            returnRate: resolved ? (100 * returned) / resolved : null,
            // Units on confirmed orders over confirmed orders. Counting units
            // from cancelled and uncalled orders here inflated it by a third.
            itemsPerOrder: confirmed ? s("items_count") / confirmed : null,
            aov: confirmed ? s("confirmed_value") / confirmed : null,
        };
    }, [funnel]);

    /**
     * The same totals for the first half of the range against the second, so
     * every headline carries a direction as well as a value. Split by row count
     * rather than by date, which keeps the halves equal even when the range is
     * an odd number of days.
     */
    const trend = useMemo(() => {
        if (funnel.length < 4) return null;
        const mid = Math.floor(funnel.length / 2);
        const part = (rows: FunnelRow[]) => {
            const s = (k: keyof FunnelRow) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
            const o = s("orders_count"), c = s("confirmed_count");
            const d = s("delivered_count");
            return {
                orders: o, confirmed: c,
                confirmRate: o ? (100 * c) / o : null,
                deliveryRate: c ? (100 * d) / c : null,
                aov: c ? s("confirmed_value") / c : null,
                itemsPerOrder: c ? s("items_count") / c : null,
            };
        };
        return { first: part(funnel.slice(0, mid)), second: part(funnel.slice(mid)) };
    }, [funnel]);

    const chart = useMemo(() => funnel.map(r => ({
        label: format(new Date(`${String(r.day).slice(0, 10)}T00:00:00`), "dd MMM"),
        orders: Number(r.orders_count),
        confirmed: Number(r.confirmed_count),
        cancelled: Number(r.cancelled_count),
        delivered: Number(r.delivered_count),
        returned: Number(r.returned_count),
        inTransit: Number(r.in_transit_count),
        confirmRate: r.confirm_rate === null ? null : Number(r.confirm_rate),
        confirmRateDecided: r.confirm_rate_decided === null ? null : Number(r.confirm_rate_decided),
        deliveryRate: r.delivery_rate === null ? null : Number(r.delivery_rate),
        settledRate: r.settled_rate === null ? null : Number(r.settled_rate),
        aov: r.avg_order_value === null ? null : Number(r.avg_order_value),
    })), [funnel]);

    const sortedGovs = useMemo(() => {
        const rows = [...govs];
        if (govSort === "delivery_rate") {
            // Rank on the rate, but only where enough parcels have landed for
            // it to mean anything; one delivery out of one is not 100%.
            return rows
                .filter(g => Number(g.delivered_count) + Number(g.returned_count) >= 10)
                .sort((a, b) => Number(b.delivery_rate || 0) - Number(a.delivery_rate || 0));
        }
        return rows.sort((a, b) => Number(b[govSort] || 0) - Number(a[govSort] || 0));
    }, [govs, govSort]);

    if (missing) {
        return (
            <Card>
                <CardContent className="py-6 text-sm text-muted-foreground">
                    شغّل <code className="text-xs">supabase/migrations/20260905_advanced_analytics.sql</code> عشان
                    قسم التحليلات المتقدمة يشتغل.
                </CardContent>
            </Card>
        );
    }

    if (loading) {
        return (
            <Card><CardContent className="py-16 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent></Card>
        );
    }

    const delta = (now: number | null, before: number | null) => {
        if (now === null || before === null || !before) return null;
        return now - before;
    };

    const kpi = (
        label: string, value: string, sub: string,
        change: number | null, unit: string, goodUp = true,
    ) => {
        const good = change === null ? null : (goodUp ? change > 0 : change < 0);
        return (
            <div className="rounded-xl border p-4 bg-card">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
                <p className="text-2xl font-black tabular-nums mt-1">{value}</p>
                <div className="flex items-center gap-1.5 mt-1">
                    {change !== null && Math.abs(change) >= 0.05 && (
                        <span className={cn("flex items-center gap-0.5 text-xs font-semibold",
                            good ? "text-emerald-600" : "text-destructive")}>
                            {change > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {Math.abs(change).toFixed(unit === "%" ? 1 : 2)}{unit}
                        </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">{sub}</span>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-xl font-bold tracking-tight">{t("Advanced analytics")}</h2>
            </div>

            {/* Headlines, each with the direction across the range. */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {kpi(t("Orders"), totals.orders.toLocaleString(),
                    `${totals.waiting.toLocaleString()} ${t("waiting")}`,
                    trend ? delta(trend.second.orders, trend.first.orders) : null, "", true)}
                {kpi(t("Confirmed"), totals.confirmed.toLocaleString(),
                    `${totals.cancelled.toLocaleString()} ${t("cancelled")}`,
                    trend ? delta(trend.second.confirmed, trend.first.confirmed) : null, "", true)}
                {kpi(t("Confirmation rate"),
                    totals.confirmRate === null ? "—" : `${totals.confirmRate.toFixed(1)}%`,
                    totals.confirmRateDecided === null
                        ? t("of orders placed")
                        : `${totals.confirmRateDecided.toFixed(1)}% ${t("of decided")} · ${totals.waiting.toLocaleString()} ${t("waiting")}`,
                    trend ? delta(trend.second.confirmRate, trend.first.confirmRate) : null, "%", true)}
                {kpi(t("Delivery rate"),
                    totals.deliveryRate === null ? "—" : `${totals.deliveryRate.toFixed(1)}%`,
                    totals.settledRate === null
                        ? `${totals.inTransit.toLocaleString()} ${t("still moving")}`
                        : `${totals.settledRate.toFixed(1)}% ${t("of settled")} · ${totals.inTransit.toLocaleString()} ${t("still moving")}`,
                    trend ? delta(trend.second.deliveryRate, trend.first.deliveryRate) : null, "%", true)}
                {kpi(t("Items / order"),
                    totals.itemsPerOrder === null ? "—" : totals.itemsPerOrder.toFixed(2),
                    `${totals.items.toLocaleString()} ${t("items")}`,
                    trend ? delta(trend.second.itemsPerOrder, trend.first.itemsPerOrder) : null, "", true)}
                {kpi(t("Average order"),
                    totals.aov === null ? "—" : formatCurrency(totals.aov),
                    formatCurrency(totals.confirmedValue),
                    trend ? delta(trend.second.aov, trend.first.aov) : null, "", true)}
            </div>

            {/* Confirmed per day — the thing that was missing. */}
            <Card>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                    <div>
                        <CardTitle className="text-base">{t("Every day in the range")}</CardTitle>
                        <CardDescription>
                            {t("Orders placed against orders confirmed, with the rate over them. An order counts on the day it was placed.")}
                        </CardDescription>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                        <Button size="sm" variant={mode === "counts" ? "default" : "outline"}
                            onClick={() => setMode("counts")}>{t("Counts")}</Button>
                        <Button size="sm" variant={mode === "rates" ? "default" : "outline"}
                            onClick={() => setMode("rates")}>{t("Rates")}</Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="h-80 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            {mode === "counts" ? (
                                <ComposedChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                                    <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={18} />
                                    <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
                                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }}
                                        domain={[0, 100]} unit="%" />
                                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Bar yAxisId="l" dataKey="orders" name={t("Placed")}
                                        fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                                    <Bar yAxisId="l" dataKey="confirmed" name={t("Confirmed")}
                                        fill="#7A5544" radius={[3, 3, 0, 0]} />
                                    <Line yAxisId="r" type="monotone" dataKey="confirmRateDecided"
                                        name={t("Confirmation rate")} stroke="#2563eb"
                                        strokeWidth={2} dot={false} connectNulls />
                                </ComposedChart>
                            ) : (
                                <ComposedChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                                    <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={18} />
                                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }}
                                        formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Line type="monotone" dataKey="confirmRateDecided" name={t("Confirmation rate (decided)")}
                                        stroke="#2563eb" strokeWidth={2} dot={false} connectNulls />
                                    <Line type="monotone" dataKey="confirmRate" name={t("Confirmation rate (all)")}
                                        stroke="#93c5fd" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
                                    <Line type="monotone" dataKey="deliveryRate" name={t("Collected / confirmed")}
                                        stroke="#059669" strokeWidth={2} dot={false} connectNulls />
                                    <Line type="monotone" dataKey="settledRate" name={t("Collected / settled")}
                                        stroke="#a7f3d0" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
                                </ComposedChart>
                            )}
                        </ResponsiveContainer>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                        {t("Confirmation rate is out of orders someone has decided on — an order placed an hour ago is still Waiting. Delivery rate is Collected out of every confirmed order, the same way the Moderators League counts it, so an order still in transit counts against it until it lands.")}
                    </p>
                </CardContent>
            </Card>

            {/* What happened to each day's confirmed orders. */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t("Where each day's orders ended up")}</CardTitle>
                    <CardDescription>
                        {t("Collected, returned, and still moving. The moving band shrinks as a day's orders settle, so recent days always look tall.")}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                                <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={18} />
                                <YAxis tick={{ fontSize: 11 }} />
                                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Area type="monotone" dataKey="delivered" name={t("Collected")} stackId="1"
                                    stroke="#059669" fill="#059669" fillOpacity={0.7} />
                                <Area type="monotone" dataKey="returned" name={t("Returned")} stackId="1"
                                    stroke="#dc2626" fill="#dc2626" fillOpacity={0.7} />
                                <Area type="monotone" dataKey="inTransit" name={t("Still moving")} stackId="1"
                                    stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.5} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Governorates */}
            <Card>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                    <div>
                        <CardTitle className="text-base flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            {t("Governorates")}
                        </CardTitle>
                        <CardDescription>
                            {t("A governorate can be second by volume and last by delivery rate. Only one of those changes what you do.")}
                        </CardDescription>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                        {([
                            ["orders_count", t("By orders")],
                            ["delivery_rate", t("By delivery %")],
                            ["profit", t("By profit")],
                        ] as const).map(([k, label]) => (
                            <Button key={k} size="sm" variant={govSort === k ? "default" : "outline"}
                                onClick={() => setGovSort(k as any)}>{label}</Button>
                        ))}
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={sortedGovs.slice(0, 12).map(g => ({
                                name: g.governorate,
                                v: govSort === "delivery_rate" ? Number(g.delivery_rate || 0)
                                    : govSort === "profit" ? Number(g.profit || 0)
                                        : Number(g.orders_count),
                                rate: Number(g.delivery_rate || 0),
                            }))} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30}
                                    textAnchor="end" height={62} />
                                <YAxis tick={{ fontSize: 11 }} />
                                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }}
                                    formatter={(v: any) => govSort === "profit" ? formatCurrency(Number(v))
                                        : govSort === "delivery_rate" ? `${Number(v).toFixed(1)}%`
                                            : Number(v).toLocaleString()} />
                                <Bar dataKey="v" radius={[4, 4, 0, 0]}>
                                    {/* Coloured by delivery rate whatever the bars measure, so a
                                        tall bar that returns badly cannot look like good news. */}
                                    {sortedGovs.slice(0, 12).map((g, i) => (
                                        <Cell key={i} fill={
                                            Number(g.delivery_rate || 0) >= 85 ? "#059669"
                                                : Number(g.delivery_rate || 0) >= 75 ? "#d97706" : "#dc2626"} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="rounded-lg border overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="w-full text-sm min-w-[720px]">
                            <thead className="bg-muted/50 sticky top-0">
                                <tr>
                                    <th className="text-start p-2.5 font-medium text-xs">{t("Governorate")}</th>
                                    <th className="text-end p-2.5 font-medium text-xs">{t("Orders")}</th>
                                    <th className="text-end p-2.5 font-medium text-xs">{t("Confirmed")}</th>
                                    <th className="text-end p-2.5 font-medium text-xs">{t("Collected")}</th>
                                    <th className="text-end p-2.5 font-medium text-xs">{t("Returned")}</th>
                                    <th className="text-end p-2.5 font-medium text-xs">{t("Delivery rate")}</th>
                                    <th className="text-end p-2.5 font-medium text-xs">{t("Average order")}</th>
                                    <th className="text-end p-2.5 font-medium text-xs">{t("Profit")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedGovs.map(g => (
                                    <tr key={g.governorate} className="border-t">
                                        <td className="p-2.5 font-medium">{g.governorate}</td>
                                        <td className="p-2.5 text-end tabular-nums">{Number(g.orders_count).toLocaleString()}</td>
                                        <td className="p-2.5 text-end tabular-nums">{Number(g.confirmed_count).toLocaleString()}</td>
                                        <td className="p-2.5 text-end tabular-nums text-emerald-600">{Number(g.delivered_count).toLocaleString()}</td>
                                        <td className="p-2.5 text-end tabular-nums text-destructive">{Number(g.returned_count).toLocaleString()}</td>
                                        <td className={cn("p-2.5 text-end tabular-nums font-semibold",
                                            Number(g.delivery_rate || 0) >= 85 ? "text-emerald-600"
                                                : Number(g.delivery_rate || 0) >= 75 ? "text-amber-600" : "text-destructive")}>
                                            {g.delivery_rate === null ? "—" : `${Number(g.delivery_rate).toFixed(1)}%`}
                                        </td>
                                        <td className="p-2.5 text-end tabular-nums text-muted-foreground">
                                            {g.avg_order_value === null ? "—" : formatCurrency(Number(g.avg_order_value))}
                                        </td>
                                        <td className={cn("p-2.5 text-end tabular-nums font-semibold",
                                            Number(g.profit) < 0 ? "text-destructive" : "")}>
                                            {formatCurrency(Number(g.profit))}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Products */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        {t("Top products")}
                    </CardTitle>
                    <CardDescription>
                        {t("Units on confirmed orders, with the return rate beside them — the best seller and the most returned product are often the same one.")}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-lg border overflow-x-auto">
                        <table className="w-full text-sm min-w-[680px]">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="w-8 p-2.5"></th>
                                    <th className="text-start p-2.5 font-medium text-xs">{t("Product")}</th>
                                    <th className="text-end p-2.5 font-medium text-xs">{t("Units")}</th>
                                    <th className="text-end p-2.5 font-medium text-xs">{t("Orders")}</th>
                                    <th className="text-end p-2.5 font-medium text-xs">{t("Average price")}</th>
                                    <th className="text-end p-2.5 font-medium text-xs">{t("Revenue")}</th>
                                    <th className="text-end p-2.5 font-medium text-xs">{t("Return rate")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {products.map((p, i) => (
                                    <tr key={p.product_id} className="border-t">
                                        <td className="p-2.5 font-mono text-xs text-muted-foreground">{i + 1}</td>
                                        <td className="p-2.5 font-medium">{p.product_name}</td>
                                        <td className="p-2.5 text-end tabular-nums font-semibold">{Number(p.units).toLocaleString()}</td>
                                        <td className="p-2.5 text-end tabular-nums text-muted-foreground">{Number(p.orders_count).toLocaleString()}</td>
                                        <td className="p-2.5 text-end tabular-nums text-muted-foreground">
                                            {p.avg_price === null ? "—" : formatCurrency(Number(p.avg_price))}
                                        </td>
                                        <td className="p-2.5 text-end tabular-nums">{formatCurrency(Number(p.revenue))}</td>
                                        <td className={cn("p-2.5 text-end tabular-nums font-semibold",
                                            Number(p.return_rate || 0) >= 25 ? "text-destructive"
                                                : Number(p.return_rate || 0) >= 15 ? "text-amber-600" : "text-emerald-600")}>
                                            {p.return_rate === null ? "—" : `${Number(p.return_rate).toFixed(1)}%`}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {products.length === 0 && (
                        <p className="text-sm text-muted-foreground py-6 text-center">
                            {t("No confirmed orders with mapped products in this range.")}
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
