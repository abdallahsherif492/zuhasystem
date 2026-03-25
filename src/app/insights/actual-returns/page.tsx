"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, DollarSign, ArrowDownRight, ArrowUpRight, Percent, Package, Wallet, TrendingDown, Truck } from "lucide-react";
import { DateRangePicker } from "@/components/date-range-picker";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell
} from "recharts";

import { Suspense } from "react";

const COLORS = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6'];

function ActualReturnsContent() {
    const searchParams = useSearchParams();
    const [loading, setLoading] = useState(true);

    const [metrics, setMetrics] = useState({
        deliveredRevenue: 0,
        deliveredCogs: 0,
        operationalExpenses: 0,
        adsExpenses: 0,
        courierShippingCost: 0,
        netProfit: 0,
        profitMargin: 0,
        totalShippingCost: 0
    });

    const [dailyData, setDailyData] = useState<any[]>([]);

    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');

    useEffect(() => {
        fetchActualReturns();
    }, [fromDate, toDate]);

    async function fetchActualReturns() {
        setLoading(true);
        try {
            const today = new Date();
            const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
            const defaultEnd = today.toISOString();

            const start = fromDate || defaultStart;
            const end = toDate || defaultEnd;

            // 1. Fetch Collected Orders
            const { data: orders, error: ordersError } = await supabase
                .from('orders')
                .select('created_at, total_amount, total_cost, shipping_cost, status, customer_info')
                .eq('status', 'Collected')
                .gte('created_at', start)
                .lte('created_at', end);

            if (ordersError) throw ordersError;

            // 2. Fetch Operational Expenses (Excluding Ads if they are separated)
            const { data: transactions, error: transError } = await supabase
                .from('transactions')
                .select('transaction_date, amount, category, type')
                .eq('type', 'expense')
                .gte('transaction_date', start)
                .lte('transaction_date', end);

            if (transError) throw transError;

            // 3. Fetch Ads Expenses
            const { data: ads, error: adsError } = await supabase
                .from('ads_expenses')
                .select('ad_date, amount')
                .gte('ad_date', start)
                .lte('ad_date', end);

            if (adsError) throw adsError;

            // Aggregation
            let rev = 0;
            let cogs = 0;
            let ship = 0;
            let courierTotal = 0;

            const ordersByDate: Record<string, { rev: number, cogs: number, courier: number }> = {};

            (orders || []).forEach(o => {
                const dateKey = new Date(o.created_at).toLocaleDateString('en-GB'); // DD/MM/YYYY
                const r = Number(o.total_amount) || 0;
                const c = Number(o.total_cost) || 0;

                const gov = String(o.customer_info?.governorate || '');
                const isCairoGiza = gov === 'Cairo' || gov === 'Giza' || gov === 'New Cairo' || gov === 'القاهرة' || gov === 'الجيزة';
                const courierRate = isCairoGiza ? 65 : 75;

                rev += r;
                cogs += c;
                courierTotal += courierRate;
                ship += Number(o.shipping_cost) || 0;

                if (!ordersByDate[dateKey]) ordersByDate[dateKey] = { rev: 0, cogs: 0, courier: 0 };
                ordersByDate[dateKey].rev += r;
                ordersByDate[dateKey].cogs += c;
                ordersByDate[dateKey].courier += courierRate;
            });

            let opex = 0;
            const opexByDate: Record<string, number> = {};

            (transactions || []).forEach(t => {
                const cat = t.category?.toLowerCase() || '';
                if (cat === 'ads' || cat === 'purchases') return; // Exclude Ads and Purchases
                const dateKey = new Date(t.transaction_date).toLocaleDateString('en-GB');
                const amt = Math.abs(Number(t.amount)) || 0;
                opex += amt;

                if (!opexByDate[dateKey]) opexByDate[dateKey] = 0;
                opexByDate[dateKey] += amt;
            });

            let adsSpent = 0;
            const adsByDate: Record<string, number> = {};

            (ads || []).forEach(a => {
                const dateKey = new Date(a.ad_date).toLocaleDateString('en-GB');
                const amt = Math.abs(Number(a.amount)) || 0;
                adsSpent += amt;

                if (!adsByDate[dateKey]) adsByDate[dateKey] = 0;
                adsByDate[dateKey] += amt;
            });

            const netProfit = rev - cogs - opex - adsSpent - courierTotal;
            const profitMargin = rev > 0 ? (netProfit / rev) * 100 : 0;

            setMetrics({
                deliveredRevenue: rev,
                deliveredCogs: cogs,
                operationalExpenses: opex,
                adsExpenses: adsSpent,
                courierShippingCost: courierTotal,
                netProfit,
                profitMargin,
                totalShippingCost: ship
            });

            // Build Daily Chart Data
            const chartDataMap: Record<string, any> = {};

            // Collect all unique dates
            const allDates = new Set([
                ...Object.keys(ordersByDate),
                ...Object.keys(opexByDate),
                ...Object.keys(adsByDate)
            ]);

            allDates.forEach(date => {
                const r = ordersByDate[date]?.rev || 0;
                const c = ordersByDate[date]?.cogs || 0;
                const courierRate = ordersByDate[date]?.courier || 0;
                const o = opexByDate[date] || 0;
                const a = adsByDate[date] || 0;

                chartDataMap[date] = {
                    date,
                    Revenue: r,
                    COGS: c,
                    OpEx: o,
                    Ads: a,
                    CourierCost: courierRate,
                    NetProfit: r - c - o - a - courierRate
                };
            });

            // Sort dates
            const sortedData = Object.values(chartDataMap).sort((a, b) => {
                const [d1, m1, y1] = a.date.split('/');
                const [d2, m2, y2] = b.date.split('/');
                return new Date(`${y1}-${m1}-${d1}`).getTime() - new Date(`${y2}-${m2}-${d2}`).getTime();
            });

            setDailyData(sortedData);

        } catch (error) {
            console.error("Error calculating actual returns:", error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    const pieData = [
        { name: 'Net Profit', value: Math.max(0, metrics.netProfit) }, // Hide if negative
        { name: 'COGS', value: metrics.deliveredCogs },
        { name: 'OpEx', value: metrics.operationalExpenses },
        { name: 'Ads', value: metrics.adsExpenses },
        { name: 'Courier', value: metrics.courierShippingCost }
    ];

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Collected Revenue</CardTitle>
                        <DollarSign className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{formatCurrency(metrics.deliveredRevenue)}</div>
                        <p className="text-xs text-muted-foreground mt-1">From Collected orders only</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Collected COGS</CardTitle>
                        <Package className="h-4 w-4 text-destructive" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-destructive">-{formatCurrency(metrics.deliveredCogs)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Product costs</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">OpEx</CardTitle>
                        <Wallet className="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-500">-{formatCurrency(metrics.operationalExpenses)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Salaries, Rent, Fulfilment</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Ads Expenses</CardTitle>
                        <TrendingDown className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-500">-{formatCurrency(metrics.adsExpenses)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Marketing spend</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Courier Cost</CardTitle>
                        <Truck className="h-4 w-4 text-purple-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-purple-500">-{formatCurrency(metrics.courierShippingCost)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Delivery fees on store</p>
                    </CardContent>
                </Card>
                <Card className="bg-primary/5 border-primary/20">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-primary">Actual Net Profit</CardTitle>
                        <DollarSign className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-primary">{formatCurrency(metrics.netProfit)}</div>
                        <p className="text-xs font-medium text-primary/80 mt-1 flex items-center">
                            Margin: {metrics.profitMargin.toFixed(1)}%
                        </p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Daily Actual Returns Flow</CardTitle>
                        <CardDescription>Revenue vs Costs and Net Profit per day</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dailyData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="date" />
                                <YAxis yAxisId="left" tickFormatter={(value) => `EGP${value / 1000}k`} />
                                <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                                <Legend />
                                <Bar yAxisId="left" dataKey="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                                <Bar yAxisId="left" dataKey="COGS" fill="#ef4444" stackId="costs" radius={[0, 0, 0, 0]} />
                                <Bar yAxisId="left" dataKey="OpEx" fill="#f59e0b" stackId="costs" radius={[0, 0, 0, 0]} />
                                <Bar yAxisId="left" dataKey="Ads" fill="#3b82f6" stackId="costs" radius={[0, 0, 0, 0]} />
                                <Bar yAxisId="left" dataKey="CourierCost" fill="#8b5cf6" stackId="costs" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Revenue Breakdown</CardTitle>
                        <CardDescription>Where your money went</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={80}
                                    outerRadius={120}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Calculation Summary</CardTitle>
                    <CardDescription>Detailed breakdown of the actual returns formula</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4 max-w-2xl mx-auto">
                        <div className="flex justify-between items-center py-2 border-b">
                            <span className="font-medium">Total Collected Revenue</span>
                            <span className="text-green-600 font-bold">{formatCurrency(metrics.deliveredRevenue)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b">
                            <span className="font-medium text-muted-foreground">- Collected COGS</span>
                            <span className="text-destructive font-semibold">-{formatCurrency(metrics.deliveredCogs)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b">
                            <span className="font-medium text-muted-foreground">- Operational Expenses (Salaries, Rent, etc)</span>
                            <span className="text-orange-500 font-semibold">-{formatCurrency(metrics.operationalExpenses)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b">
                            <span className="font-medium text-muted-foreground">- Ad Spends</span>
                            <span className="text-blue-500 font-semibold">-{formatCurrency(metrics.adsExpenses)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b">
                            <span className="font-medium text-muted-foreground">- Courier Fees (65/75 EGP per order)</span>
                            <span className="text-purple-500 font-semibold">-{formatCurrency(metrics.courierShippingCost)}</span>
                        </div>
                        <div className="flex justify-between items-center py-4 bg-primary/5 rounded-lg px-4 mt-4">
                            <span className="font-bold text-lg text-primary">Actual Net Profit</span>
                            <span className="font-bold text-xl text-primary">{formatCurrency(metrics.netProfit)}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export default function ActualReturnsPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <div className="space-y-8">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <h1 className="text-3xl font-bold tracking-tight">Actual Returns</h1>
                    <DateRangePicker />
                </div>
                <ActualReturnsContent />
            </div>
        </Suspense>
    );
}
