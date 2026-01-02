"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowRight, TrendingUp, TrendingDown, Package, CheckCircle, AlertCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/date-range-picker";
import { startOfDay, endOfDay, subDays, format } from "date-fns";
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
    BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';

const STATUSES = [
    "Pending",
    "Prepared",
    "Shipped",
    "Delivered",
    "Collected",
    "Cancelled",
    "Unavailable",
    "Returned",
];

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#d0ed57'];

import { Suspense } from "react";

export default function LogisticsPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <LogisticsDashboard />
        </Suspense>
    );
}

function LogisticsDashboard() {
    return (
        <LogisticsContent />
    );
}

function LogisticsContent() {
    const searchParams = useSearchParams();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    useEffect(() => {
        fetchOrders();
    }, [fromDate, toDate]);

    async function fetchOrders() {
        try {
            setLoading(true);
            let query = supabase
                .from("orders")
                .select("*")
                .order("created_at", { ascending: false });

            if (fromDate) {
                query = query.gte("created_at", fromDate);
            }
            if (toDate) {
                const end = new Date(toDate);
                end.setHours(23, 59, 59, 999);
                query = query.lte("created_at", end.toISOString());
            }

            const { data, error } = await query;
            if (error) throw error;
            setOrders(data || []);
        } catch (error) {
            console.error("Error fetching orders:", error);
        } finally {
            setLoading(false);
        }
    }

    const updateStatus = async (orderId: string, newStatus: string) => {
        try {
            const { error } = await supabase
                .from("orders")
                .update({ status: newStatus })
                .eq("id", orderId);
            if (error) throw error;
            setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
        } catch (error) {
            console.error("Failed to update status", error);
            alert("Failed to update status");
        }
    };

    const [searchQuery, setSearchQuery] = useState("");

    // --- Calculations ---

    // 1. Filter by Search Query
    const filteredOrders = orders.filter(order => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            order.id.toLowerCase().includes(q) ||
            order.customer_info?.name?.toLowerCase().includes(q) ||
            order.customer_info?.phone?.includes(q)
        );
    });

    // 2. Net Value (Total - Shipping - 10)
    const calculateNetValue = (order: any) => {
        return Math.max(0, (order.total_amount || 0) - (order.shipping_cost || 0) - 10);
    };

    // 3. Metrics Breakdown (use filteredOrders)
    const metrics = STATUSES.map(status => {
        const statusOrders = filteredOrders.filter(o => o.status === status);
        const count = statusOrders.length;
        // Summing the Net Value instead of Gross Total
        const netValue = statusOrders.reduce((acc, o) => acc + calculateNetValue(o), 0);
        return { status, count, netValue };
    });

    // 4. Overall Stats
    const totalOrders = filteredOrders.length;
    const deliveredCount = filteredOrders.filter(o => o.status === 'Delivered').length;
    const collectedCount = filteredOrders.filter(o => o.status === 'Collected').length;
    const returnedCount = filteredOrders.filter(o => o.status === 'Returned').length;

    // Won Rate = (Delivered + Collected) / Total
    const wonCount = deliveredCount + collectedCount;
    const wonRate = totalOrders > 0 ? (wonCount / totalOrders) * 100 : 0;
    const returnRate = totalOrders > 0 ? (returnedCount / totalOrders) * 100 : 0;

    // 4. Chart Data: Status Distribution (Pie)
    const pieData = metrics.filter(m => m.count > 0).map(m => ({
        name: m.status,
        value: m.count
    }));

    // 5. Chart Data: Daily Trends (Bar)
    // Group by Date
    const dailyDataMap = new Map();
    filteredOrders.forEach(order => {
        const date = format(new Date(order.created_at), 'MM/dd');
        if (!dailyDataMap.has(date)) {
            dailyDataMap.set(date, { date, orders: 0, returns: 0, delivered: 0 });
        }
        const data = dailyDataMap.get(date);
        data.orders += 1;
        if (order.status === 'Returned') data.returns += 1;
        if (order.status === 'Delivered') data.delivered += 1;
    });
    // Sort by date (simple approach, assumes close range)
    const barData = Array.from(dailyDataMap.values()).reverse(); // Reverse if DESC order

    // 6. Top Governorates
    const govMap = new Map();
    filteredOrders.forEach(order => {
        const gov = order.customer_info?.governorate || 'Unknown';
        if (!govMap.has(gov)) govMap.set(gov, 0);
        govMap.set(gov, govMap.get(gov) + 1);
    });
    const topGovs = Array.from(govMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);


    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <h1 className="text-3xl font-bold tracking-tight">Logistics</h1>
                </div>
                <div className="flex items-center gap-2 bg-background">
                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search orders..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8 w-[250px]"
                        />
                    </div>
                    <DateRangePicker />
                </div>
            </div>

            {/* Top KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
                        <Package className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalOrders}</div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Won Rate</CardTitle>
                        <CheckCircle className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{wonRate.toFixed(1)}%</div>
                        <p className="text-xs text-muted-foreground">{wonCount} Orders</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Return Rate</CardTitle>
                        <AlertCircle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{returnRate.toFixed(1)}%</div>
                        <p className="text-xs text-muted-foreground">{returnedCount} Orders</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Net Value</CardTitle>
                        <TrendingUp className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">
                            {formatCurrency(metrics.reduce((acc, m) => acc + m.netValue, 0))}
                        </div>
                        <p className="text-xs text-muted-foreground">Excl. Shipping + 10 EGP</p>
                    </CardContent>
                </Card>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Status Distribution */}
                <Card>
                    <CardHeader>
                        <CardTitle>Order Status Distribution</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(val: any) => [val, 'Orders']} />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Performance Trend */}
                <Card>
                    <CardHeader>
                        <CardTitle>Daily Orders vs Returns</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={barData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="orders" name="Total Orders" fill="#8884d8" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="delivered" name="Delivered" fill="#4ade80" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="returns" name="Returned" fill="#f87171" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Top Governorates */}
                <Card>
                    <CardHeader>
                        <CardTitle>Top Regions</CardTitle>
                        <CardDescription>Highest volume governorates</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {topGovs.map((gov, i) => (
                                <div key={gov.name} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-medium">
                                            {i + 1}
                                        </div>
                                        <span className="text-sm font-medium">{gov.name}</span>
                                    </div>
                                    <Badge variant="secondary">{gov.count}</Badge>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Status Breakdown List */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>Status Breakdown</CardTitle>
                        <CardDescription>Net value excludes shipping & fees</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Count</TableHead>
                                    <TableHead className="text-right">Net Value</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {metrics.map((m) => (
                                    <TableRow key={m.status}>
                                        <TableCell>
                                            <Badge variant="outline">{m.status}</Badge>
                                        </TableCell>
                                        <TableCell>{m.count}</TableCell>
                                        <TableCell className="text-right font-medium">
                                            {formatCurrency(m.netValue)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            {/* Complete Orders Table */}
            <Card>
                <CardHeader>
                    <CardTitle>All Orders</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Order ID</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Customer</TableHead>
                                <TableHead>Gov</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Net Value</TableHead>
                                <TableHead>Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredOrders.map((order) => (
                                <TableRow key={order.id}>
                                    <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}</TableCell>
                                    <TableCell>{new Date(order.created_at).toLocaleDateString()}</TableCell>
                                    <TableCell>
                                        <div className="font-medium">{order.customer_info?.name || "N/A"}</div>
                                        <div className="text-xs text-muted-foreground">{order.customer_info?.phone}</div>
                                    </TableCell>
                                    <TableCell>{order.customer_info?.governorate || "-"}</TableCell>
                                    <TableCell>
                                        <select
                                            className="h-8 w-32 rounded-md border border-input bg-transparent px-2 text-xs"
                                            value={order.status}
                                            onChange={(e) => updateStatus(order.id, e.target.value)}
                                        >
                                            {STATUSES.map(s => (
                                                <option key={s} value={s}>{s}</option>
                                            ))}
                                        </select>
                                    </TableCell>
                                    <TableCell>{formatCurrency(calculateNetValue(order))}</TableCell>
                                    <TableCell>
                                        {/* Add Detail View Link later if needed */}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
