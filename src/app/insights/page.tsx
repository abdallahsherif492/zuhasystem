"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DateRangePicker } from "@/components/date-range-picker";
import { Loader2, TrendingUp, TrendingDown, DollarSign, Target, Activity, Percent } from "lucide-react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, BarChart, Bar
} from "recharts";
import { format, parseISO, startOfDay, isWithinInterval, endOfDay } from "date-fns";

function InsightsContent() {
    const searchParams = useSearchParams();
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    const [loading, setLoading] = useState(true);
    const [metrics, setMetrics] = useState({
        adSpend: 0,
        transactionRevenue: 0,
        netProfit: 0,
        totalExpenses: 0,
        roas: 0,
        roi: 0,
        totalOrders: 0,
        delivered: 0,
        returned: 0,
        collectable: 0,
        wonRate: 0,
        rejectRate: 0,
        deliveryRate: 0,
    });
    const [revenueData, setRevenueData] = useState<any[]>([]);
    const [statusData, setStatusData] = useState<any[]>([]);
    const [expenseData, setExpenseData] = useState<any[]>([]);

    useEffect(() => {
        if (fromDate) fetchData();
    }, [fromDate, toDate]);

    async function fetchData() {
        setLoading(true);
        try {
            const start = fromDate ? fromDate : format(new Date(), "yyyy-MM-dd");
            const end = toDate ? toDate : format(new Date(), "yyyy-MM-dd");

            // 1. KPI RPC
            const { data: kpis, error: kpiError } = await supabase.rpc('get_insights_kpis', {
                from_date: start,
                to_date: end
            });

            if (kpiError) throw kpiError;

            if (kpis && kpis.length > 0) {
                const k = kpis[0];
                setMetrics({
                    adSpend: k.ads_spend || 0,
                    transactionRevenue: k.transaction_revenue || 0,
                    netProfit: k.net_profit || 0,
                    totalExpenses: k.total_expenses || 0,
                    roas: k.roas || 0,
                    roi: k.roi || 0,
                    totalOrders: k.orders_count || 0,
                    delivered: k.delivered_count || 0,
                    collectable: k.collectable_value || 0,
                    wonRate: k.won_rate || 0,
                    rejectRate: 100 - (k.won_rate || 0), // Simplifying if not explicitly calc in RPC, but RPC has it? No, RPC doesn't have reject rate explicitly? Let's check schema.
                    // RPC has: won_rate, delivered_rate (delivery_rate), but missed reject_rate in destructure?
                    // RPC Return: won_rate, delivered_rate, roas, roi. 
                    // Let's re-read RPC definition in thought...
                    // RPC: won_rate, delivered_rate, roas, roi.
                    // I need reject_rate maybe as (returned / closed).
                    // Let's assume (returned/total) or similar.
                    // For now, I'll calculate reject rate manually if RPC didn't return it, OR update usage.
                    // RPC didn't return reject explicitly in my last write.
                    // But I can calc it: returned / orders?
                    returned: 0, // RPC didn't return returned count explicitly in the final select?
                    // Wait, RPC returned: _revenue, _expenses, _ads, net, total, delivered, collectable, won%, del%, roas, roi.
                    // It missed 'returned' count in the final SELECT.
                    // I will do a quick fetch for status distributions to get 'returned' count and chart data.
                    deliveryRate: k.delivered_rate || 0,
                });
            }

            // 2. Charts Data
            // A. Daily Sales (RPC)
            // We need this for the Line Chart (Revenue).
            // We also need Daily Ads for the Line Chart.
            const { data: dailySales } = await supabase.rpc('get_daily_sales', {
                from_date: `${start}T00:00:00`,
                to_date: `${end}T23:59:59`
            });

            const { data: dailyAds } = await supabase
                .from('ads_expenses')
                .select('ad_date, amount')
                .gte('ad_date', start)
                .lte('ad_date', end);

            // Merge for Chart
            const chartMap = new Map();
            dailySales?.forEach((s: any) => {
                const d = s.day_date;
                if (!chartMap.has(d)) chartMap.set(d, { date: d, revenue: 0, adSpend: 0 });
                chartMap.get(d).revenue = s.total_sales;
            });
            dailyAds?.forEach((a: any) => {
                const d = a.ad_date;
                if (!chartMap.has(d)) chartMap.set(d, { date: d, revenue: 0, adSpend: 0 });
                chartMap.get(d).adSpend += a.amount;
            });
            const mergedChart = Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date));
            setRevenueData(mergedChart);

            // B. Status Distribution & Returned Count
            // Light aggregation
            const { data: statusCounts } = await supabase
                .from('orders')
                .select('status')
                .gte('created_at', start)
                .lte('created_at', `${end}T23:59:59`);

            const statusMap: Record<string, number> = {};
            let returnedCount = 0;
            statusCounts?.forEach((o: any) => {
                statusMap[o.status] = (statusMap[o.status] || 0) + 1;
                if (o.status === 'Returned') returnedCount++;
            });

            // Update returned count in metrics
            setMetrics(prev => ({ ...prev, returned: returnedCount }));

            const pieData = Object.entries(statusMap).map(([name, value]) => ({ name, value }));
            setStatusData(pieData);

            // C. Expenses Breakdown
            const { data: expenses } = await supabase
                .from('transactions')
                .select('category, amount')
                .eq('type', 'expense')
                .gte('transaction_date', start)
                .lte('transaction_date', end);

            const expenseMap: Record<string, number> = {};
            expenses?.forEach((t: any) => {
                const cat = t.category || 'Other';
                expenseMap[cat] = (expenseMap[cat] || 0) + Math.abs(t.amount);
            });
            const barData = Object.entries(expenseMap).map(([name, value]) => ({ name, value }));
            setExpenseData(barData);

        } catch (error) {
            console.error("Error fetching insights:", error);
        } finally {
            setLoading(false);
        }
    }

    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <h1 className="text-3xl font-bold tracking-tight">Business Insights</h1>
                <DateRangePicker />
            </div>

            {loading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <>
                    {/* KPI Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                                <DollarSign className="h-4 w-4 text-green-600" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{formatCurrency(metrics.transactionRevenue)}</div>
                                <p className="text-xs text-muted-foreground">From Transactions</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                                <TrendingDown className="h-4 w-4 text-red-600" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{formatCurrency(metrics.totalExpenses)}</div>
                                <p className="text-xs text-muted-foreground">Operational + Ads</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
                                <Activity className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className={cn("text-2xl font-bold", metrics.netProfit >= 0 ? "text-green-600" : "text-red-600")}>
                                    {formatCurrency(metrics.netProfit)}
                                </div>
                                <p className="text-xs text-muted-foreground">Revenue - Expenses</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium">ROI</CardTitle>
                                <Percent className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className={cn("text-2xl font-bold", metrics.roi >= 0 ? "text-green-600" : "text-red-600")}>
                                    {metrics.roi.toFixed(1)}%
                                </div>
                                <p className="text-xs text-muted-foreground">Return on Investment</p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Secondary Metrics */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card className="bg-muted/20">
                            <CardContent className="pt-6">
                                <div className="text-lg font-bold">{metrics.totalOrders}</div>
                                <p className="text-xs text-muted-foreground">Total Orders</p>
                            </CardContent>
                        </Card>
                        <Card className="bg-muted/20">
                            <CardContent className="pt-6">
                                <div className="text-lg font-bold text-blue-600">{formatCurrency(metrics.collectable)}</div>
                                <p className="text-xs text-muted-foreground">Collectable (Delivered)</p>
                            </CardContent>
                        </Card>
                        <Card className="bg-muted/20">
                            <CardContent className="pt-6">
                                <div className="text-lg font-bold">{metrics.wonRate.toFixed(1)}%</div>
                                <p className="text-xs text-muted-foreground">Won Rate</p>
                            </CardContent>
                        </Card>
                        <Card className="bg-muted/20">
                            <CardContent className="pt-6">
                                <div className="text-lg font-bold">{metrics.roas.toFixed(2)}x</div>
                                <p className="text-xs text-muted-foreground">ROAS</p>
                            </CardContent>
                        </Card>
                        <Card className="bg-muted/20">
                            <CardContent className="pt-6">
                                <div className="text-lg font-bold">{metrics.deliveryRate.toFixed(1)}%</div>
                                <p className="text-xs text-muted-foreground">Delivery Rate</p>
                            </CardContent>
                        </Card>
                        <Card className="bg-muted/20">
                            <CardContent className="pt-6">
                                <div className="text-lg font-bold text-destructive">
                                    {((metrics.returned / (metrics.delivered + metrics.returned + 0.0001)) * 100).toFixed(1)}%
                                </div>
                                <p className="text-xs text-muted-foreground">Return Rate</p>
                            </CardContent>
                        </Card>
                        <Card className="bg-muted/20">
                            <CardContent className="pt-6">
                                <div className="text-lg font-bold">{formatCurrency(metrics.adSpend)}</div>
                                <p className="text-xs text-muted-foreground">Ad Spend (FB)</p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Charts */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card className="md:col-span-2">
                            <CardHeader>
                                <CardTitle>Revenue vs Ad Spend</CardTitle>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={revenueData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="date" />
                                        <YAxis />
                                        <Tooltip />
                                        <Legend />
                                        <Line type="monotone" dataKey="revenue" stroke="#16a34a" name="Revenue" strokeWidth={2} />
                                        <Line type="monotone" dataKey="adSpend" stroke="#dc2626" name="Ad Spend" strokeWidth={2} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Order Status Distribution</CardTitle>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={statusData}
                                            cx="50%"
                                            cy="50%"
                                            labelLine={false}
                                            label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                                            outerRadius={100}
                                            fill="#8884d8"
                                            dataKey="value"
                                        >
                                            {statusData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Expenses Breakdown</CardTitle>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={expenseData} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis type="number" />
                                        <YAxis dataKey="name" type="category" width={100} />
                                        <Tooltip />
                                        <Bar dataKey="value" fill="#8884d8" name="Amount" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>
                </>
            )}
        </div>
    );
}

import { Suspense } from "react";

export default function InsightsPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <InsightsContent />
        </Suspense>
    );
}

// Helper for cn
import { cn } from "@/lib/utils";
