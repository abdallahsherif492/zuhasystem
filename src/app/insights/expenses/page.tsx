"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { DateRangePicker } from "@/components/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, DollarSign } from "lucide-react";
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend,
    BarChart, Bar, XAxis, YAxis, CartesianGrid
} from "recharts";
import { format, startOfMonth } from "date-fns";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#8dd1e1'];

export default function ExpensesAnalyticsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    const [loading, setLoading] = useState(true);
    const [expensesData, setExpensesData] = useState<any[]>([]);
    const [totalOrders, setTotalOrders] = useState(0);

    useEffect(() => {
        if (!fromDate || !toDate) {
            const start = format(startOfMonth(new Date()), "yyyy-MM-dd");
            const end = format(new Date(), "yyyy-MM-dd");
            router.replace(`?from=${start}&to=${end}`);
            return;
        }
        fetchData();
    }, [fromDate, toDate]);

    async function fetchData() {
        setLoading(true);
        try {
            const start = `${fromDate}T00:00:00`;
            const end = `${toDate}T23:59:59`;

            // 1. Get Expenses Breakdown
            const { data: expData, error: expError } = await supabase.rpc('get_expenses_breakdown', {
                from_date: start,
                to_date: end
            });
            if (expError) throw expError;

            // 2. Get Total Orders for "Cost Per Order"
            const { data: ordData, error: ordError } = await supabase.rpc('get_insight_orders_stats', {
                from_date: start,
                to_date: end
            });
            if (ordError) throw ordError;

            setExpensesData(expData || []);
            setTotalOrders(Number(ordData?.[0]?.total_count || 0));

        } catch (error) {
            console.error("Error fetching expenses data:", error);
        } finally {
            setLoading(false);
        }
    }

    // Process data for charts
    const totalExpenses = expensesData.reduce((sum, item) => sum + Number(item.total_amount), 0);
    const costPerOrder = totalOrders > 0 ? totalExpenses / totalOrders : 0;

    // Group by Category for Pie Chart
    const categoryMap = new Map();
    expensesData.forEach(item => {
        const current = categoryMap.get(item.category) || 0;
        categoryMap.set(item.category, current + Number(item.total_amount));
    });
    const categoryData = Array.from(categoryMap.entries()).map(([name, value]) => ({ name, value }));

    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="space-y-8 p-8 pt-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <h1 className="text-3xl font-bold tracking-tight">Expenses Analytics</h1>
                <DateRangePicker />
            </div>

            {/* Top Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(totalExpenses)}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Cost Per Order</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(costPerOrder)}</div>
                        <p className="text-xs text-muted-foreground">Based on {totalOrders} orders</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Pie Chart: Expenses by Category */}
                <Card className="col-span-1">
                    <CardHeader>
                        <CardTitle>Expenses by Category</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={categoryData}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    label={(props: any) => `${props.name} ${((props.percent || 0) * 100).toFixed(0)}%`}
                                    outerRadius={80}
                                    fill="#8884d8"
                                    dataKey="value"
                                >
                                    {categoryData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <RechartsTooltip formatter={(value) => formatCurrency(Number(value))} />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Bar Chart: Detailed Expenses Breakdown */}
                <Card className="col-span-1">
                    <CardHeader>
                        <CardTitle>Top Expenses (Detailed)</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={expensesData.slice(0, 10)} // Top 10 expenses
                                layout="vertical"
                                margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis
                                    dataKey="sub_category"
                                    type="category"
                                    width={100}
                                    tick={{ fontSize: 12 }}
                                    tickFormatter={(val) => val.length > 15 ? val.substring(0, 15) + '...' : val}
                                />
                                <RechartsTooltip formatter={(value) => formatCurrency(Number(value))} />
                                <Bar dataKey="total_amount" fill="#82ca9d" name="Amount" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            {/* Table View */}
            <Card>
                <CardHeader>
                    <CardTitle>Expense Breakdown Table</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {expensesData.map((item, i) => (
                            <div key={i} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                                <div className="space-y-1">
                                    <p className="text-sm font-medium leading-none">{item.sub_category}</p>
                                    <p className="text-xs text-muted-foreground">{item.category}</p>
                                </div>
                                <div className="font-medium">{formatCurrency(item.total_amount)}</div>
                            </div>
                        ))}
                        {expensesData.length === 0 && <p className="text-center text-muted-foreground py-4">No expenses found for this period.</p>}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
