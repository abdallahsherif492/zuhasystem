"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { formatCurrency, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, CalendarRange } from "lucide-react";
import {
    ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

interface MonthRow {
    month: number;
    orders_count: number;
    revenue: number;
    cogs: number;
    courier_cost: number;
    opex: number;
    ads: number;
    damages: number;
    net_profit: number;
    margin: number | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Month-by-month performance across one year.
 *
 * Deliberately independent of the page's date-range picker: the range answers
 * "how did this period do", this answers "is the year getting better or
 * worse", and tying the second to the first would make it impossible to ask.
 *
 * The arithmetic lives in get_monthly_performance() so it matches the cards
 * above line for line. Damages are shown but not subtracted from net, because
 * the page above does not subtract them either.
 */
export function MonthlyPerformance() {
    const { activeBusiness } = useBusiness();
    const thisYear = new Date().getFullYear();

    const [year, setYear] = useState(thisYear);
    const [years, setYears] = useState<number[]>([thisYear]);
    const [rows, setRows] = useState<MonthRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [unavailable, setUnavailable] = useState(false);

    useEffect(() => {
        if (!activeBusiness) return;
        let cancelled = false;
        (async () => {
            const { data } = await supabase.rpc("get_business_active_years", {
                p_business_id: activeBusiness.id,
            });
            if (cancelled) return;
            const list = (data as any[])?.map(r => Number(r.year ?? r)).filter(Boolean) ?? [];
            // Always offer the current year even before it has any orders.
            const merged = Array.from(new Set([thisYear, ...list])).sort((a, b) => b - a);
            setYears(merged);
        })();
        return () => { cancelled = true; };
    }, [activeBusiness, thisYear]);

    const load = useCallback(async () => {
        if (!activeBusiness) return;
        setLoading(true);
        const { data, error } = await supabase.rpc("get_monthly_performance", {
            p_business_id: activeBusiness.id,
            p_year: year,
        });
        if (error) {
            console.error("Monthly performance failed:", error);
            setUnavailable(true);
            setRows([]);
        } else {
            setUnavailable(false);
            setRows((data as MonthRow[]) || []);
        }
        setLoading(false);
    }, [activeBusiness, year]);

    useEffect(() => { load(); }, [load]);

    const totals = useMemo(() => {
        const sum = (k: keyof MonthRow) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
        const revenue = sum("revenue");
        const net = sum("net_profit");
        return {
            orders: sum("orders_count"), revenue, cogs: sum("cogs"),
            courier: sum("courier_cost"), opex: sum("opex"), ads: sum("ads"),
            damages: sum("damages"), net,
            margin: revenue > 0 ? (net / revenue) * 100 : null,
        };
    }, [rows]);

    // Months with no activity at all are dropped from the chart only — a run of
    // empty bars for months that have not happened yet reads as a collapse.
    const chartData = useMemo(
        () => rows.filter(r => Number(r.revenue) > 0 || Number(r.opex) > 0 || Number(r.ads) > 0)
                  .map(r => ({
                      name: MONTHS[r.month - 1],
                      Revenue: Number(r.revenue),
                      COGS: Number(r.cogs),
                      OpEx: Number(r.opex),
                      Ads: Number(r.ads),
                      Courier: Number(r.courier_cost),
                      NetProfit: Number(r.net_profit),
                  })),
        [rows]
    );

    if (unavailable) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Monthly Performance</CardTitle>
                    <CardDescription>
                        Run supabase/migrations/20260818_monthly_performance.sql to enable this section.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-4">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <CalendarRange className="h-5 w-5 text-primary" />
                        Monthly Performance
                    </CardTitle>
                    <CardDescription>
                        Every month of {year}, on the same basis as the figures above &mdash;
                        collected orders only. Not affected by the date range.
                    </CardDescription>
                </div>
                <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
                    <SelectTrigger className="w-[110px] shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                </Select>
            </CardHeader>

            <CardContent className="space-y-6">
                {loading ? (
                    <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : chartData.length === 0 ? (
                    <p className="py-16 text-center text-sm text-muted-foreground">
                        No collected orders or expenses recorded in {year}.
                    </p>
                ) : (
                    <>
                        <div className="h-[320px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                    <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis fontSize={11} tickLine={false} axisLine={false}
                                           tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                                    <Tooltip
                                        formatter={(value: any, name: any) => [formatCurrency(Number(value) || 0), name]}
                                        contentStyle={{ borderRadius: 8, fontSize: 12 }}
                                    />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Bar dataKey="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="COGS" fill="#ef4444" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="OpEx" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="Ads" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                                    {/* Net as a line, so it stays readable when it goes negative. */}
                                    <Line type="monotone" dataKey="NetProfit" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="rounded-lg border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Month</TableHead>
                                        <TableHead className="text-right">Orders</TableHead>
                                        <TableHead className="text-right">Revenue</TableHead>
                                        <TableHead className="text-right">COGS</TableHead>
                                        <TableHead className="text-right hidden md:table-cell">Courier</TableHead>
                                        <TableHead className="text-right hidden md:table-cell">OpEx</TableHead>
                                        <TableHead className="text-right hidden lg:table-cell">Ads</TableHead>
                                        <TableHead className="text-right hidden lg:table-cell">Damages</TableHead>
                                        <TableHead className="text-right">Net</TableHead>
                                        <TableHead className="text-right">Margin</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map(r => {
                                        const empty = Number(r.orders_count) === 0
                                            && Number(r.opex) === 0 && Number(r.ads) === 0;
                                        const net = Number(r.net_profit);
                                        return (
                                            <TableRow key={r.month} className={cn(empty && "opacity-40")}>
                                                <TableCell className="font-medium">{MONTHS[r.month - 1]}</TableCell>
                                                <TableCell className="text-right tabular-nums">{Number(r.orders_count).toLocaleString()}</TableCell>
                                                <TableCell className="text-right tabular-nums text-emerald-600">{formatCurrency(Number(r.revenue))}</TableCell>
                                                <TableCell className="text-right tabular-nums">{formatCurrency(Number(r.cogs))}</TableCell>
                                                <TableCell className="text-right tabular-nums hidden md:table-cell">{formatCurrency(Number(r.courier_cost))}</TableCell>
                                                <TableCell className="text-right tabular-nums hidden md:table-cell">{formatCurrency(Number(r.opex))}</TableCell>
                                                <TableCell className="text-right tabular-nums hidden lg:table-cell">{formatCurrency(Number(r.ads))}</TableCell>
                                                <TableCell className="text-right tabular-nums hidden lg:table-cell">{formatCurrency(Number(r.damages))}</TableCell>
                                                <TableCell className={cn("text-right tabular-nums font-bold",
                                                    net > 0 ? "text-emerald-600" : net < 0 ? "text-red-600" : "")}>
                                                    {formatCurrency(net)}
                                                </TableCell>
                                                <TableCell className={cn("text-right tabular-nums",
                                                    r.margin === null ? "text-muted-foreground"
                                                        : Number(r.margin) >= 0 ? "text-emerald-600" : "text-red-600")}>
                                                    {r.margin === null ? "—" : `${Number(r.margin).toFixed(1)}%`}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                    <TableRow className="bg-muted/40 font-bold border-t-2">
                                        <TableCell>{year}</TableCell>
                                        <TableCell className="text-right tabular-nums">{totals.orders.toLocaleString()}</TableCell>
                                        <TableCell className="text-right tabular-nums text-emerald-600">{formatCurrency(totals.revenue)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(totals.cogs)}</TableCell>
                                        <TableCell className="text-right tabular-nums hidden md:table-cell">{formatCurrency(totals.courier)}</TableCell>
                                        <TableCell className="text-right tabular-nums hidden md:table-cell">{formatCurrency(totals.opex)}</TableCell>
                                        <TableCell className="text-right tabular-nums hidden lg:table-cell">{formatCurrency(totals.ads)}</TableCell>
                                        <TableCell className="text-right tabular-nums hidden lg:table-cell">{formatCurrency(totals.damages)}</TableCell>
                                        <TableCell className={cn("text-right tabular-nums",
                                            totals.net > 0 ? "text-emerald-600" : totals.net < 0 ? "text-red-600" : "")}>
                                            {formatCurrency(totals.net)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {totals.margin === null ? "—" : `${totals.margin.toFixed(1)}%`}
                                        </TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </div>

                        <p className="text-xs text-muted-foreground">
                            Net is revenue minus COGS, courier, operating expenses and ads &mdash; the same
                            formula as the cards above. Damages are listed but not deducted, matching
                            how they are reported there. Purchases are stock, not an operating cost,
                            and are excluded.
                        </p>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
