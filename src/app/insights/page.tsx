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
        transactionRevenue: 0, // NEW: From transactions table
        netProfit: 0,
        totalExpenses: 0,
        roas: 0,
        roi: 0,
        totalOrders: 0,
        delivered: 0,
        returned: 0,
        collectable: 0, // NEW: Delivered orders value excluding shipping
        wonRate: 0,
        rejectRate: 0,
        deliveryRate: 0,
    });
    const [revenueData, setRevenueData] = useState<any[]>([]);
    const [statusData, setStatusData] = useState<any[]>([]);
    const [expenseData, setExpenseData] = useState<any[]>([]);

    useEffect(() => {
        fetchData();
    }, [fromDate, toDate]);

    async function fetchData() {
        setLoading(true);
        try {
            // DATE FILTER
            let orderQuery = supabase.from("orders").select("*");
            let transactionQuery = supabase.from("transactions").select("*");

            if (fromDate) {
                orderQuery = orderQuery.gte("created_at", fromDate);
                transactionQuery = transactionQuery.gte("transaction_date", fromDate);
            }
            if (toDate) {
                orderQuery = orderQuery.lte("created_at", `${toDate}T23:59:59`);
                transactionQuery = transactionQuery.lte("transaction_date", toDate);
            }

            const [ordersRes, transRes] = await Promise.all([
                orderQuery,
                transactionQuery
            ]);

            const orders = ordersRes.data || [];
            const transactions = transRes.data || [];

            // --- CALCULATIONS ---

            // 1. Financials from Transactions
            // Expenses
            const expenses = transactions.filter(t => t.type === 'expense');
            const totalExpenses = expenses.reduce((sum, t) => sum + Math.abs(t.amount), 0);

            const adSpend = expenses
                .filter(t => t.category === 'Ads')
                .reduce((sum, t) => sum + Math.abs(t.amount), 0);

            // Revenue (from Transactions)
            const revenueTransactions = transactions.filter(t => t.type === 'revenue' || t.amount > 0); // Assuming positive amount or explicit type
            // Note: Schema might use 'Revenue' or 'income', checking explicit type usually safer if defined.
            // Let's assume type='Revenue' based on schema knowledge or consistent naming.
            // Actually, based on previous `AddTransactionDialog`, types are 'investment' | 'revenue' | 'expense'.
            const transactionRevenue = transactions
                .filter(t => t.type === 'revenue')
                .reduce((sum, t) => sum + Math.abs(t.amount), 0);


            // 2. Financials from Orders
            // const totalRevenueOrders = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0); // Deprecated for KPI per user request
            const ordersProfit = orders.reduce((sum, o) => sum + (o.profit || 0), 0);

            // 3. KPIs
            // Net Profit: User asked for "Total of Revenue from Transactions" and "Total Expenses".
            // Typically Net Profit = Revenue - Expenses.
            // Let's use the explicit transaction revenue for consistent financial reporting.
            const netProfit = transactionRevenue - totalExpenses;

            // ROI: (Transaction Revenue - Total Expenses) / Total Expenses
            const roi = totalExpenses > 0 ? (netProfit / totalExpenses) * 100 : 0;

            // ROAS: Transaction Revenue / Ad Spend (User might mean Order Revenue here? explicitly "ROAS" usually implies direct sales attribution)
            // But if we are shifting to "Transaction Revenue" being the truth, let's use that.
            // However, often Order Revenue is better for ROAS if transactions are cash-collected only.
            // User requested "calculate ROI using Revenue from manual transactions".
            // Left ROAS undefined in request, but implied consistency. Let's use Transaction Revenue for ROAS too for consistency, OR keep Order Revenue if it makes more sense for "Ad Spend -> Sales generated".
            // Usually Sales (Orders) is the direct result of Ads. Transactions are cash flow.
            // I'll stick to Order Revenue for ROAS (Sales generated) but Transaction Revenue for ROI (Cash profitability).
            // Actually, let's stick to the User's strict request "Total Revenue from Transactions".
            // Let's calculate ROAS using Transaction Revenue to be safe with the "Revenue from Transactions" directive.
            const roas = adSpend > 0 ? transactionRevenue / adSpend : 0;


            // 4. Order Metrics
            const totalOrders = orders.length;
            const deliveredOrders = orders.filter(o => o.status === 'Delivered');
            const delivered = deliveredOrders.length;
            const collected = orders.filter(o => o.status === 'Collected').length;
            const returned = orders.filter(o => o.status === 'Returned').length;
            const shipped = orders.filter(o => o.status === 'Shipped').length;

            // Collectable: Value of Delivered orders (without shipping)
            // (Total Amount - Shipping Cost) for Delivered orders.
            const collectable = deliveredOrders.reduce((sum, o) => {
                const val = (o.total_amount || 0) - (o.shipping_cost || 0);
                return sum + val;
            }, 0);

            // Rates
            const wonRate = totalOrders > 0 ? ((delivered + collected) / totalOrders) * 100 : 0;
            const closedOrders = delivered + returned + collected;
            const rejectRate = closedOrders > 0 ? (returned / closedOrders) * 100 : 0;
            const deliveryRate = (shipped + delivered + collected) > 0 ? ((delivered + collected) / (shipped + delivered + collected)) * 100 : 0;

            setMetrics({
                adSpend,
                transactionRevenue,
                netProfit,
                totalExpenses,
                roas,
                roi,
                totalOrders,
                delivered,
                returned,
                collectable,
                wonRate,
                rejectRate,
                deliveryRate
            });

            // --- CHARTS DATA ---

            // A. Revenue vs Ad Spend (Daily)
            // Group by date
            const dailyData = new Map();

            // Seed with order dates
            orders.forEach(o => {
                const date = format(new Date(o.created_at), 'yyyy-MM-dd');
                if (!dailyData.has(date)) dailyData.set(date, { date, revenue: 0, adSpend: 0 });
                dailyData.get(date).revenue += o.total_amount;
            });
            // Seed with transaction dates
            expenses.filter(t => t.category === 'Ads').forEach(t => {
                const date = t.transaction_date; // Already YYYY-MM-DD usually from DB date type
                if (!dailyData.has(date)) dailyData.set(date, { date, revenue: 0, adSpend: 0 });
                dailyData.get(date).adSpend += Math.abs(t.amount);
            });

            const sortedDaily = Array.from(dailyData.values()).sort((a, b) => a.date.localeCompare(b.date));
            setRevenueData(sortedDaily);

            // B. Status Distribution
            const statusCounts = orders.reduce((acc, o) => {
                acc[o.status] = (acc[o.status] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);
            const statusChartData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
            setStatusData(statusChartData);

            // C. Expenses Breakdown
            const expenseCounts = expenses.reduce((acc, t) => {
                const cat = t.category || "Other";
                acc[cat] = (acc[cat] || 0) + Math.abs(t.amount);
                return acc;
            }, {} as Record<string, number>);
            const expenseChartData = Object.entries(expenseCounts).map(([name, value]) => ({ name, value }));
            setExpenseData(expenseChartData);

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
                                <div className="text-lg font-bold text-destructive">{metrics.rejectRate.toFixed(1)}%</div>
                                <p className="text-xs text-muted-foreground">Reject Rate</p>
                            </CardContent>
                        </Card>
                        <Card className="bg-muted/20">
                            <CardContent className="pt-6">
                                <div className="text-lg font-bold">{formatCurrency(metrics.adSpend)}</div>
                                <p className="text-xs text-muted-foreground">Ad Spend</p>
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
