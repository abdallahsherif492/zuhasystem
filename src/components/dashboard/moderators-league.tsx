"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Trophy, Target, Settings2, Users, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, subMonths, subDays, startOfYear } from "date-fns";
import {
    ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";

interface LeagueRow {
    /** Null for the bucket of orders nobody has been assigned to. */
    closed_by: string | null;
    orders_count: number;
    items_count: number;
    items_per_order: number;
    sales_value: number;
    delivered_count: number;
    returned_count: number;
    delivery_rate: number | null;
}

interface DailyRow {
    day: string;
    closed_by: string;
    orders_count: number;
    items_count: number;
    delivered_count: number;
    returned_count: number;
    sales_value: number;
}

/** Stable per-person colour: the same moderator keeps their line across charts. */
const LINE_COLORS = [
    "#7A5544", "#2563eb", "#059669", "#d97706", "#9333ea", "#dc2626", "#0891b2", "#65a30d",
];

interface Targets {
    orders_target: number;
    delivery_rate_target: number;
    items_per_order_target: number;
}

const DEFAULT_TARGETS: Targets = {
    orders_target: 2000,
    delivery_rate_target: 86,
    items_per_order_target: 1.5,
};

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * The ranges people actually ask for, plus a custom pair.
 *
 * `to` is stored as the last day shown and made exclusive only when the query
 * is built, so the inputs read the way a person means them: 1 to 31 August is
 * August, not August plus a day.
 */
const PRESETS: { key: string; label: string; range: () => { from: string; to: string } }[] = [
    { key: "this_month", label: "الشهر ده", range: () => {
        const n = new Date(); return { from: ymd(startOfMonth(n)), to: ymd(endOfMonth(n)) }; } },
    { key: "last_month", label: "الشهر اللي فات", range: () => {
        const n = subMonths(new Date(), 1); return { from: ymd(startOfMonth(n)), to: ymd(endOfMonth(n)) }; } },
    { key: "last_30", label: "آخر 30 يوم", range: () => ({
        from: ymd(subDays(new Date(), 29)), to: ymd(new Date()) }) },
    { key: "last_90", label: "آخر 90 يوم", range: () => ({
        from: ymd(subDays(new Date(), 89)), to: ymd(new Date()) }) },
    { key: "ytd", label: "من أول السنة", range: () => ({
        from: ymd(startOfYear(new Date())), to: ymd(new Date()) }) },
];

/**
 * Moderator standings for the current month.
 *
 * Two things at once, deliberately: progress against the month's target, and a
 * ranking that rewards cross-selling. Ranking on order count alone would tell
 * moderators to take as many orders as possible and say nothing about whether
 * they offered the customer a second product, so items per order is shown as
 * its own column with its own leader.
 */
export function ModeratorsLeague() {
    const { activeBusiness, userRole, isSystemAdmin } = useBusiness();
    const { t } = useLanguage();
    // LanguageContext rebuilds `t` on every render and hands down a fresh
    // context object with it. Depending on `t` inside the fetch callback would
    // therefore give `load` a new identity whenever anything above re-renders,
    // and the effect that calls it would fire again — a refetch loop driven by
    // an unrelated part of the tree. It is only used for toast text, so read it
    // through a ref and keep it out of the dependency list.
    const tRef = useRef(t);
    tRef.current = t;

    // Someone being measured against a number should not be able to move it.
    // Enforced in RLS too — this only decides whether the button is worth
    // showing. Role spellings vary across the app's history ('super_admin'
    // from seed data, 'super admin' from the team screen), so normalise.
    const canSetTargets = isSystemAdmin || ["owner", "admin", "super admin"]
        .includes((userRole || "").toLowerCase().replace(/_/g, " "));

    const [rows, setRows] = useState<LeagueRow[]>([]);
    const [daily, setDaily] = useState<DailyRow[]>([]);
    const [dailyMissing, setDailyMissing] = useState(false);
    const [targets, setTargets] = useState<Targets>(DEFAULT_TARGETS);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [draft, setDraft] = useState<Targets>(DEFAULT_TARGETS);
    const [saving, setSaving] = useState(false);

    const [preset, setPreset] = useState("this_month");
    const [range, setRange] = useState(() => PRESETS[0].range());
    /** Empty means everyone; otherwise only these are charted and ranked. */
    const [picked, setPicked] = useState<string[]>([]);
    const [metric, setMetric] = useState<"orders_count" | "items_count" | "sales_value">("orders_count");

    const from = useMemo(() => new Date(`${range.from}T00:00:00`), [range.from]);
    // The picker's end date is inclusive; the query bound is not.
    const to = useMemo(() => new Date(new Date(`${range.to}T00:00:00`).getTime() + 86400000), [range.to]);

    // Targets are set per calendar month, so they only mean something when the
    // range is one. Anything else shows the numbers without a bar to beat.
    const monthKey = useMemo(() => format(startOfMonth(from), "yyyy-MM-dd"), [from]);
    const isWholeMonth = useMemo(() =>
        range.from === format(startOfMonth(from), "yyyy-MM-dd")
        && range.to === format(endOfMonth(from), "yyyy-MM-dd"), [range, from]);

    const load = useCallback(async () => {
        if (!activeBusiness) return;
        setLoading(true);
        try {
            const args = {
                p_business_id: activeBusiness.id,
                p_from: from.toISOString(),
                p_to: to.toISOString(),
            };
            const [leagueRes, dailyRes, targetRes] = await Promise.all([
                supabase.rpc("get_moderator_league", args),
                supabase.rpc("get_moderator_daily", args),
                supabase
                    .from("moderator_targets")
                    .select("orders_target, delivery_rate_target, items_per_order_target")
                    .eq("business_id", activeBusiness.id)
                    .eq("month", monthKey)
                    .maybeSingle(),
            ]);

            if (leagueRes.error) throw leagueRes.error;
            setRows((leagueRes.data || []) as LeagueRow[]);
            if (dailyRes.error) { setDailyMissing(true); setDaily([]); }
            else { setDailyMissing(false); setDaily((dailyRes.data || []) as DailyRow[]); }
            setTargets(targetRes.data ? targetRes.data as Targets : DEFAULT_TARGETS);
        } catch (e: any) {
            console.error("Moderators league failed to load:", e);
            toast.error(tRef.current("Failed to load the moderators league"));
        } finally {
            setLoading(false);
        }
    }, [activeBusiness, from, to, monthKey]);

    useEffect(() => { load(); }, [load]);

    // The standings rank people, so only claimed orders belong in the table.
    const allRanked = useMemo(() => rows.filter(r => r.closed_by), [rows]);
    const ranked = useMemo(() =>
        picked.length === 0 ? allRanked : allRanked.filter(r => picked.includes(r.closed_by!)),
        [allRanked, picked]);
    const unassigned = useMemo(() => rows.find(r => !r.closed_by) || null, [rows]);

    /** Who each colour belongs to, fixed by the full standings so filtering
        does not recolour everyone. */
    const colorOf = useMemo(() => {
        const m = new Map<string, string>();
        allRanked.forEach((r, i) => m.set(r.closed_by!, LINE_COLORS[i % LINE_COLORS.length]));
        return m;
    }, [allRanked]);

    const shown = useMemo(() =>
        (picked.length ? picked : allRanked.map(r => r.closed_by!)), [picked, allRanked]);

    /** One row per day, one column per moderator on show. */
    const series = useMemo(() => {
        const byDay = new Map<string, any>();
        for (const d of daily) {
            if (!shown.includes(d.closed_by)) continue;
            const key = String(d.day).slice(0, 10);
            const row = byDay.get(key) || { day: key, label: format(new Date(`${key}T00:00:00`), "dd MMM") };
            row[d.closed_by] = (row[d.closed_by] || 0) + Number(d[metric] || 0);
            byDay.set(key, row);
        }
        return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    }, [daily, shown, metric]);

    /** Running total against the month's order target — the pace chart. */
    const cumulative = useMemo(() => {
        const byDay = new Map<string, number>();
        for (const d of daily) {
            if (!shown.includes(d.closed_by)) continue;
            const key = String(d.day).slice(0, 10);
            byDay.set(key, (byDay.get(key) || 0) + Number(d.orders_count || 0));
        }
        let run = 0;
        return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, n]) => {
            run += n;
            return { day, label: format(new Date(`${day}T00:00:00`), "dd MMM"), total: run };
        });
    }, [daily, shown]);

    function togglePicked(name: string) {
        setPicked(p => p.includes(name) ? p.filter(x => x !== name) : [...p, name]);
    }
    function applyPreset(key: string) {
        const p = PRESETS.find(x => x.key === key);
        if (!p) return;
        setPreset(key);
        setRange(p.range());
    }

    // The meter measures the month, not how much of it has been labelled, so it
    // counts every order — including the ones placed before attribution existed
    // and any confirmed since without a moderator picked. Both come from the
    // same query as the table, so the two can never disagree.
    const totals = useMemo(() => {
        // Unfiltered, the meter counts every order including the unassigned
        // ones, because it measures the month rather than how much of it has
        // been labelled. Filtered, it has to follow the filter or the bars
        // would describe a different population than the table under them.
        const base: LeagueRow[] = picked.length ? ranked : rows;
        const sum = (k: keyof LeagueRow) => base.reduce((s, r) => s + Number(r[k] || 0), 0);
        const orders = sum("orders_count");
        const items = sum("items_count");
        const delivered = sum("delivered_count");
        const returned = sum("returned_count");
        const resolved = delivered + returned;
        return {
            orders, items, delivered, returned, resolved,
            sales: sum("sales_value"),
            // Collected out of every confirmed order — the same denominator the
            // orders meter uses, so the two read off one population.
            deliveryRate: orders ? (100 * delivered) / orders : null,
            itemsPerOrder: orders ? items / orders : 0,
        };
    }, [rows, ranked, picked]);

    // Only rows with enough orders to mean something can win the cross-sell
    // prize — one order with three items is not a track record.
    const CROSS_SELL_MIN_ORDERS = 10;
    const crossSellLeader = useMemo(() => {
        const eligible = ranked.filter(r => Number(r.orders_count) >= CROSS_SELL_MIN_ORDERS);
        if (!eligible.length) return null;
        return eligible.reduce((best, r) =>
            Number(r.items_per_order) > Number(best.items_per_order) ? r : best);
    }, [ranked]);

    async function saveTargets() {
        if (!activeBusiness) return;
        setSaving(true);
        try {
            const { error } = await supabase
                .from("moderator_targets")
                .upsert({
                    business_id: activeBusiness.id,
                    month: monthKey,
                    orders_target: Math.max(0, Math.round(draft.orders_target)),
                    delivery_rate_target: Math.min(100, Math.max(0, draft.delivery_rate_target)),
                    items_per_order_target: Math.max(0, draft.items_per_order_target),
                    updated_at: new Date().toISOString(),
                }, { onConflict: "business_id,month" });
            if (error) throw error;
            toast.success(t("Targets saved"));
            setDialogOpen(false);
            load();
        } catch (e: any) {
            toast.error(e.message || t("Failed to save targets"));
        } finally {
            setSaving(false);
        }
    }

    const ordersPct = targets.orders_target
        ? Math.min(100, (totals.orders / targets.orders_target) * 100) : 0;
    const ratePct = targets.delivery_rate_target && totals.deliveryRate !== null
        ? Math.min(100, (totals.deliveryRate / targets.delivery_rate_target) * 100) : 0;

    return (
        <Card id="moderators-league">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <Trophy className="h-5 w-5 text-amber-500" />
                        {t("Moderators League")}
                    </CardTitle>
                    <CardDescription>
                        {range.from} → {range.to} · {t("confirmed orders — everything except Waiting and Cancelled")}
                    </CardDescription>
                </div>
                {canSetTargets && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setDraft(targets); setDialogOpen(true); }}
                    >
                        <Settings2 className="h-4 w-4 mr-2" />
                        {t("Targets")}
                    </Button>
                )}
            </CardHeader>

            <CardContent className="space-y-6">
                {/* Range */}
                <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
                    <div className="flex flex-wrap gap-1.5">
                        {PRESETS.map(p => (
                            <Button
                                key={p.key}
                                size="sm"
                                variant={preset === p.key ? "default" : "outline"}
                                onClick={() => applyPreset(p.key)}
                            >
                                {p.label}
                            </Button>
                        ))}
                    </div>
                    <div className="flex items-end gap-2 ms-auto">
                        <div>
                            <Label className="text-[11px] text-muted-foreground">من</Label>
                            <Input
                                type="date" className="h-9 w-[9.5rem]"
                                value={range.from}
                                onChange={e => { setPreset("custom"); setRange(r => ({ ...r, from: e.target.value })); }}
                            />
                        </div>
                        <div>
                            <Label className="text-[11px] text-muted-foreground">إلى</Label>
                            <Input
                                type="date" className="h-9 w-[9.5rem]"
                                value={range.to}
                                onChange={e => { setPreset("custom"); setRange(r => ({ ...r, to: e.target.value })); }}
                            />
                        </div>
                    </div>
                </div>

                {/* Who to look at. Nothing picked means everyone. */}
                {allRanked.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <Button
                            size="sm"
                            variant={picked.length === 0 ? "default" : "outline"}
                            onClick={() => setPicked([])}
                        >
                            {t("Everyone")}
                        </Button>
                        {allRanked.map(r => {
                            const on = picked.includes(r.closed_by!);
                            return (
                                <Button
                                    key={r.closed_by}
                                    size="sm"
                                    variant={on ? "default" : "outline"}
                                    onClick={() => togglePicked(r.closed_by!)}
                                    style={on ? { backgroundColor: colorOf.get(r.closed_by!) } : undefined}
                                >
                                    <span
                                        className="h-2 w-2 rounded-full me-2"
                                        style={{ backgroundColor: on ? "#fff" : colorOf.get(r.closed_by!) }}
                                    />
                                    {r.closed_by}
                                </Button>
                            );
                        })}
                    </div>
                )}

                {/* Progress against the month */}
                <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                        <div className="flex items-baseline justify-between text-sm">
                            <span className="text-muted-foreground">{t("Orders")}</span>
                            <span className="font-semibold">
                                {totals.orders.toLocaleString()} / {targets.orders_target.toLocaleString()}
                            </span>
                        </div>
                        <Progress value={ordersPct} />
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-baseline justify-between text-sm">
                            <span className="text-muted-foreground">{t("Delivery rate")}</span>
                            <span className={cn(
                                "font-semibold",
                                totals.deliveryRate !== null && totals.deliveryRate >= targets.delivery_rate_target
                                    ? "text-emerald-600" : "text-amber-600"
                            )}>
                                {totals.deliveryRate === null ? "—" : `${totals.deliveryRate.toFixed(1)}%`}
                                {" / "}{targets.delivery_rate_target}%
                            </span>
                        </div>
                        <Progress value={ratePct} />
                        {/* Out of every confirmed order, so early in the month
                            this reads low and climbs as orders come back
                            collected — the opposite of the settled-only ratio.
                            Spelling out how much of the month is still moving
                            stops a mid-month figure being read as the result. */}
                        <p className="text-[11px] text-muted-foreground">
                            {totals.orders === 0
                                ? t("no confirmed orders yet")
                                : `${totals.delivered.toLocaleString()} ${t("collected of")} ${totals.orders.toLocaleString()} ${t("confirmed")} · ${(totals.orders - totals.resolved).toLocaleString()} ${t("still in progress")}`}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-baseline justify-between text-sm">
                            <span className="text-muted-foreground">{t("Items per order")}</span>
                            <span className={cn(
                                "font-semibold",
                                totals.itemsPerOrder >= targets.items_per_order_target
                                    ? "text-emerald-600" : "text-amber-600"
                            )}>
                                {totals.itemsPerOrder.toFixed(2)} / {targets.items_per_order_target}
                            </span>
                        </div>
                        <Progress value={targets.items_per_order_target
                            ? Math.min(100, (totals.itemsPerOrder / targets.items_per_order_target) * 100) : 0} />
                    </div>
                </div>

                {!isWholeMonth && (
                    <p className="text-xs text-amber-600">
                        {t("Targets are set per calendar month. The bars above compare this range against the target for")}{" "}
                        {format(from, "MMMM yyyy")}.
                    </p>
                )}

                {/* Charts */}
                {dailyMissing ? (
                    <p className="text-sm text-muted-foreground">
                        شغّل <code className="text-xs">20260905_advanced_analytics.sql</code> عشان الرسوم البيانية تشتغل.
                    </p>
                ) : series.length > 0 && (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="text-sm font-semibold flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                                {t("Day by day")}
                            </h4>
                            <div className="flex gap-1.5">
                                {([
                                    ["orders_count", t("Orders")],
                                    ["items_count", t("Items")],
                                    ["sales_value", t("Sales")],
                                ] as const).map(([k, label]) => (
                                    <Button
                                        key={k} size="sm"
                                        variant={metric === k ? "default" : "outline"}
                                        onClick={() => setMetric(k as any)}
                                    >
                                        {label}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className="h-72 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                                    <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={18} />
                                    <YAxis tick={{ fontSize: 11 }} />
                                    <Tooltip
                                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                                        formatter={(v: any, name: any) =>
                                            [metric === "sales_value" ? formatCurrency(Number(v)) : Number(v).toLocaleString(), name]}
                                    />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    {shown.map(name => (
                                        <Line
                                            key={name} type="monotone" dataKey={name}
                                            stroke={colorOf.get(name) || "#7A5544"}
                                            strokeWidth={2} dot={false} connectNulls
                                        />
                                    ))}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-3">
                            {/* Pace. A straight line to the target is what "on
                                track" looks like; the area either keeps up
                                with it or it does not. */}
                            <div className="rounded-lg border p-3">
                                <p className="text-xs font-medium mb-2">{t("Cumulative orders")}</p>
                                <div className="h-44">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={cumulative} margin={{ top: 4, right: 6, bottom: 0, left: -24 }}>
                                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                                            <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24} />
                                            <YAxis tick={{ fontSize: 10 }} />
                                            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                            {picked.length === 0 && isWholeMonth && targets.orders_target > 0 && (
                                                <ReferenceLine
                                                    y={targets.orders_target} stroke="#d97706"
                                                    strokeDasharray="4 4"
                                                    label={{ value: t("Target"), position: "insideTopRight", fontSize: 10 }}
                                                />
                                            )}
                                            <Area
                                                type="monotone" dataKey="total"
                                                stroke="#7A5544" fill="#7A5544" fillOpacity={0.15} strokeWidth={2}
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Two comparisons that a ranking by order count
                                cannot show: who keeps parcels from coming back,
                                and who sells a second item. */}
                            <div className="rounded-lg border p-3">
                                <p className="text-xs font-medium mb-2">{t("Collected %")}</p>
                                <div className="h-44">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={ranked.map(r => ({
                                                name: (r.closed_by || "").split("@")[0],
                                                v: Number(r.delivery_rate) || 0,
                                                full: r.closed_by,
                                            }))}
                                            margin={{ top: 4, right: 6, bottom: 0, left: -24 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                                            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                                            <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                                            <Tooltip
                                                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                                                formatter={(v: any) => [`${Number(v).toFixed(1)}%`, t("Collected %")]}
                                            />
                                            <ReferenceLine
                                                y={targets.delivery_rate_target} stroke="#d97706" strokeDasharray="4 4"
                                            />
                                            <Bar dataKey="v" radius={[4, 4, 0, 0]} fill="#059669" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="rounded-lg border p-3">
                                <p className="text-xs font-medium mb-2">{t("Items / order")}</p>
                                <div className="h-44">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={ranked.map(r => ({
                                                name: (r.closed_by || "").split("@")[0],
                                                v: Number(r.items_per_order) || 0,
                                            }))}
                                            margin={{ top: 4, right: 6, bottom: 0, left: -24 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                                            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                                            <YAxis tick={{ fontSize: 10 }} />
                                            <Tooltip
                                                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                                                formatter={(v: any) => [Number(v).toFixed(2), t("Items / order")]}
                                            />
                                            <ReferenceLine
                                                y={targets.items_per_order_target} stroke="#d97706" strokeDasharray="4 4"
                                            />
                                            <Bar dataKey="v" radius={[4, 4, 0, 0]} fill="#7A5544" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Standings */}
                {loading ? (
                    <div className="py-10 flex justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : ranked.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground space-y-1">
                        <p>
                            {unassigned
                                ? `${Number(unassigned.orders_count).toLocaleString()} ${t("orders in this range, none assigned to a moderator yet.")}`
                                : t("No orders have been attributed to a moderator in this range.")}
                        </p>
                        <p className="text-xs">
                            {t("Pick who closed the order in Platform Orders, or when creating and editing an order.")}
                        </p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[40px]">#</TableHead>
                                <TableHead>{t("Moderator")}</TableHead>
                                <TableHead className="text-right">{t("Orders")}</TableHead>
                                <TableHead className="text-right hidden sm:table-cell">{t("Items")}</TableHead>
                                <TableHead className="text-right">{t("Items / order")}</TableHead>
                                <TableHead className="text-right hidden lg:table-cell">{t("Collected %")}</TableHead>
                                <TableHead className="text-right">{t("Sales")}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {ranked.map((r, i) => {
                                const isCrossSellLeader = crossSellLeader?.closed_by === r.closed_by;
                                return (
                                    <TableRow key={r.closed_by}>
                                        <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate max-w-[220px]">{r.closed_by}</span>
                                                {isCrossSellLeader && (
                                                    <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 shrink-0">
                                                        <Target className="h-3 w-3 mr-1" />
                                                        {t("Cross-sell")}
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="sm:hidden text-xs text-muted-foreground">
                                                {Number(r.items_count).toLocaleString()} {t("items")}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-semibold">
                                            {Number(r.orders_count).toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right hidden sm:table-cell">
                                            {Number(r.items_count).toLocaleString()}
                                        </TableCell>
                                        <TableCell className={cn(
                                            "text-right font-semibold",
                                            Number(r.items_per_order) >= targets.items_per_order_target
                                                ? "text-emerald-600" : "text-muted-foreground"
                                        )}>
                                            {Number(r.items_per_order).toFixed(2)}
                                        </TableCell>
                                        <TableCell className="text-right hidden lg:table-cell">
                                            {r.delivery_rate === null ? (
                                                <span className="text-muted-foreground">—</span>
                                            ) : (
                                                <span className={cn(
                                                    Number(r.delivery_rate) >= targets.delivery_rate_target
                                                        ? "text-emerald-600" : "text-amber-600"
                                                )}>
                                                    {Number(r.delivery_rate).toFixed(1)}%
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">{formatCurrency(Number(r.sales_value))}</TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                        {unassigned && (
                            <TableBody>
                                {/* Counted in the meter above but deliberately outside the
                                    ranking — these are orders, not someone's work. Shown
                                    rather than hidden so the gap between the two is visible
                                    instead of looking like the numbers disagree. */}
                                <TableRow className="bg-muted/30">
                                    <TableCell />
                                    <TableCell className="text-muted-foreground italic">
                                        {t("Not assigned")}
                                    </TableCell>
                                    <TableCell className="text-right text-muted-foreground">
                                        {Number(unassigned.orders_count).toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right text-muted-foreground hidden sm:table-cell">
                                        {Number(unassigned.items_count).toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right text-muted-foreground">
                                        {Number(unassigned.items_per_order).toFixed(2)}
                                    </TableCell>
                                    <TableCell className="text-right text-muted-foreground hidden lg:table-cell">
                                        {unassigned.delivery_rate === null
                                            ? "—" : `${Number(unassigned.delivery_rate).toFixed(1)}%`}
                                    </TableCell>
                                    <TableCell className="text-right text-muted-foreground">
                                        {formatCurrency(Number(unassigned.sales_value))}
                                    </TableCell>
                                </TableRow>
                            </TableBody>
                        )}
                    </Table>
                )}

                {rows.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                        {t("Counts confirmed orders — everything except Waiting and Cancelled — assigned or not. The ranking only lists orders someone was assigned to. Delivery rate is Collected out of confirmed, so orders still in transit count against it until they land.")}
                    </p>
                )}
            </CardContent>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("Targets for")} {format(from, "MMMM yyyy")}</DialogTitle>
                        <DialogDescription>
                            {t("Team-wide for the month. Each month keeps its own targets, so changing these does not rewrite past months.")}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>{t("Total orders")}</Label>
                            <Input
                                type="number"
                                value={draft.orders_target}
                                onChange={e => setDraft({ ...draft, orders_target: Number(e.target.value) })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{t("Delivery rate (%)")}</Label>
                            <Input
                                type="number" step="0.1"
                                value={draft.delivery_rate_target}
                                onChange={e => setDraft({ ...draft, delivery_rate_target: Number(e.target.value) })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{t("Items per order")}</Label>
                            <Input
                                type="number" step="0.1"
                                value={draft.items_per_order_target}
                                onChange={e => setDraft({ ...draft, items_per_order_target: Number(e.target.value) })}
                            />
                            <p className="text-xs text-muted-foreground">
                                {t("The cross-sell goal. A rate rather than a count, so it cannot be won by simply taking more orders.")}
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("Cancel")}</Button>
                        <Button onClick={saveTargets} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {t("Save")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
