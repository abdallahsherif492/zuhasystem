"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, DollarSign, ArrowDownToLine, PackageCheck, ListOrdered } from "lucide-react";
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

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6'];

function RevenuesContent() {
    const searchParams = useSearchParams();
    const [loading, setLoading] = useState(true);

    const [metrics, setMetrics] = useState({
        totalRevenue: 0,
        depositsValue: 0,
        depositsCount: 0,
        collectionsValue: 0,
        collectionsCount: 0,
        othersValue: 0,
        othersCount: 0,
        totalCount: 0
    });

    const [dailyData, setDailyData] = useState<any[]>([]);

    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');

    useEffect(() => {
        fetchRevenues();
    }, [fromDate, toDate]);

    async function fetchRevenues() {
        setLoading(true);
        try {
            const today = new Date();
            const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
            const defaultEnd = today.toISOString();

            const start = fromDate || defaultStart;
            const end = toDate || defaultEnd;

            // Fetch Revenue Transactions
            const { data: revTrans, error: transError } = await supabase
                .from('transactions')
                .select('transaction_date, amount, category, type')
                .eq('type', 'revenue')
                .gte('transaction_date', start)
                .lte('transaction_date', end);

            if (transError) throw transError;

            let dVal = 0, dCount = 0;
            let cVal = 0, cCount = 0;
            let oVal = 0, oCount = 0;

            const chartDataMap: Record<string, { date: string, Deposits: number, Collections: number, Others: number }> = {};

            (revTrans || []).forEach(t => {
                const dateKey = new Date(t.transaction_date).toLocaleDateString('en-GB');
                const amt = Math.abs(Number(t.amount)) || 0;
                const cat = t.category?.toLowerCase() || 'other';

                if (!chartDataMap[dateKey]) {
                    chartDataMap[dateKey] = { date: dateKey, Deposits: 0, Collections: 0, Others: 0 };
                }

                if (cat === 'deposit' || cat === 'deposits') {
                    dVal += amt;
                    dCount++;
                    chartDataMap[dateKey].Deposits += amt;
                } else if (cat === 'orders_collection' || cat === 'orders collection') {
                    cVal += amt;
                    cCount++;
                    chartDataMap[dateKey].Collections += amt;
                } else {
                    oVal += amt;
                    oCount++;
                    chartDataMap[dateKey].Others += amt;
                }
            });

            const tVal = dVal + cVal + oVal;
            const tCount = dCount + cCount + oCount;

            setMetrics({
                totalRevenue: tVal,
                depositsValue: dVal,
                depositsCount: dCount,
                collectionsValue: cVal,
                collectionsCount: cCount,
                othersValue: oVal,
                othersCount: oCount,
                totalCount: tCount
            });

            // Sort dates
            const sortedData = Object.values(chartDataMap).sort((a, b) => {
                const [d1, m1, y1] = a.date.split('/');
                const [d2, m2, y2] = b.date.split('/');
                return new Date(`${y1}-${m1}-${d1}`).getTime() - new Date(`${y2}-${m2}-${d2}`).getTime();
            });

            setDailyData(sortedData);

        } catch (error) {
            console.error("Error fetching revenues:", error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    const {
        totalRevenue,
        depositsValue,
        depositsCount,
        collectionsValue,
        collectionsCount,
        othersValue,
        othersCount,
        totalCount
    } = metrics;

    const depValPct = totalRevenue > 0 ? (depositsValue / totalRevenue) * 100 : 0;
    const colValPct = totalRevenue > 0 ? (collectionsValue / totalRevenue) * 100 : 0;
    const othValPct = totalRevenue > 0 ? (othersValue / totalRevenue) * 100 : 0;

    const pieDataValue = [
        { name: 'Deposits', value: depositsValue },
        { name: 'Collections', value: collectionsValue },
        { name: 'Others', value: othersValue }
    ].filter(d => d.value > 0);

    const pieDataCount = [
        { name: 'Deposits', value: depositsCount },
        { name: 'Collections', value: collectionsCount },
        { name: 'Others', value: othersCount }
    ].filter(d => d.value > 0);

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="bg-primary/5 border-primary/20">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-primary">Total Revenue Generated</CardTitle>
                        <DollarSign className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-primary">{formatCurrency(totalRevenue)}</div>
                        <p className="text-xs font-medium text-primary/80 mt-1 flex items-center">
                            {totalCount} Total Transactions
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Deposits</CardTitle>
                        <ArrowDownToLine className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{formatCurrency(depositsValue)}</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            {depositsCount} transactions ({depValPct.toFixed(1)}% of total)
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Orders Collection</CardTitle>
                        <PackageCheck className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-500">{formatCurrency(collectionsValue)}</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            {collectionsCount} transactions ({colValPct.toFixed(1)}% of total)
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Other Revenue</CardTitle>
                        <ListOrdered className="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-500">{formatCurrency(othersValue)}</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            {othersCount} transactions ({othValPct.toFixed(1)}% of total)
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Daily Revenue Flow</CardTitle>
                        <CardDescription>Value generated per day categorized by source</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dailyData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="date" />
                                <YAxis yAxisId="left" tickFormatter={(value) => `EGP${value / 1000}k`} />
                                <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                                <Legend />
                                <Bar yAxisId="left" dataKey="Deposits" fill="#10b981" stackId="rev" radius={[0, 0, 0, 0]} />
                                <Bar yAxisId="left" dataKey="Collections" fill="#3b82f6" stackId="rev" radius={[0, 0, 0, 0]} />
                                <Bar yAxisId="left" dataKey="Others" fill="#f59e0b" stackId="rev" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <div className="space-y-6">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">Breakdown by Monetary Value</CardTitle>
                        </CardHeader>
                        <CardContent className="h-[180px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={pieDataValue}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={45}
                                        outerRadius={70}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {pieDataValue.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                                    <Legend verticalAlign="middle" layout="vertical" align="right" wrapperStyle={{ fontSize: '12px' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">Breakdown by Trans. Count</CardTitle>
                        </CardHeader>
                        <CardContent className="h-[180px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={pieDataCount}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={45}
                                        outerRadius={70}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {pieDataCount.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(value: any) => `${value} trans.`} />
                                    <Legend verticalAlign="middle" layout="vertical" align="right" wrapperStyle={{ fontSize: '12px' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Summary List */}
            <Card>
                <CardHeader>
                    <CardTitle>Calculation Summary</CardTitle>
                    <CardDescription>Detailed breakdown of where your revenue came from in this period</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4 max-w-2xl mx-auto">
                        <div className="flex justify-between items-center py-2 border-b">
                            <span className="font-medium text-muted-foreground">+ Deposits Revenue ({depositsCount}x)</span>
                            <span className="text-green-600 font-semibold">{formatCurrency(depositsValue)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b">
                            <span className="font-medium text-muted-foreground">+ Orders Collection Revenue ({collectionsCount}x)</span>
                            <span className="text-blue-500 font-semibold">{formatCurrency(collectionsValue)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b">
                            <span className="font-medium text-muted-foreground">+ Other Revenues ({othersCount}x)</span>
                            <span className="text-orange-500 font-semibold">{formatCurrency(othersValue)}</span>
                        </div>
                        <div className="flex justify-between items-center py-4 bg-primary/5 rounded-lg px-4 mt-4">
                            <span className="font-bold text-lg text-primary">Total Revenue Generated</span>
                            <span className="font-bold text-xl text-primary">{formatCurrency(totalRevenue)}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export default function RevenuesPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <div className="space-y-8">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <h1 className="text-3xl font-bold tracking-tight">Revenues Breakdown</h1>
                    <DateRangePicker />
                </div>
                <RevenuesContent />
            </div>
        </Suspense>
    );
}
