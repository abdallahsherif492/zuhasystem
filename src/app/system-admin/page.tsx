"use client";

import { useEffect, useState } from "react";
import { supabase, fetchAll } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
    Store, Users, Ticket, Banknote, Loader2, TrendingUp, ShoppingBag, MessageSquare,
    Sparkles, RefreshCw, ArrowUpRight, ArrowDownRight, PackageCheck, AlertCircle, ShieldCheck
} from "lucide-react";
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, BarChart, Bar
} from "recharts";
import { format, parseISO, subDays, startOfMonth, isAfter } from "date-fns";
import Link from "next/link";

const STATUS_COLORS: Record<string, string> = {
    'Collected': '#10b981',
    'Delivered': '#059669',
    'Shipped': '#3b82f6',
    'Prepared': '#8b5cf6',
    'Processing': '#f59e0b',
    'Pending': '#eab308',
    'Cancelled': '#ef4444',
    'Returned': '#dc2626'
};

const SUB_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

type RecentBusiness = {
    id: string;
    name: string;
    subscription_status?: string;
    created_at: string;
};

export default function SystemAdminOverview() {
    const [loading, setLoading] = useState(true);
    const [dateFilter, setDateFilter] = useState<string>("all");

    // KPI Metrics
    const [kpi, setKpi] = useState({
        totalRevenue: 0,
        totalOrders: 0,
        deliveredOrders: 0,
        wonRate: 0,
        totalBusinesses: 0,
        activeBusinesses: 0,
        trialBusinesses: 0,
        totalUsers: 0,
        unreadSupportChats: 0,
        openTickets: 0,
    });

    // Chart Data
    const [timelineData, setTimelineData] = useState<any[]>([]);
    const [subDistData, setSubDistData] = useState<any[]>([]);
    const [topStoresData, setTopStoresData] = useState<any[]>([]);
    const [statusDistData, setStatusDistData] = useState<any[]>([]);
    const [recentBusinesses, setRecentBusinesses] = useState<RecentBusiness[]>([]);

    useEffect(() => {
        fetchOverviewData();
    }, [dateFilter]);

    async function fetchOverviewData() {
        setLoading(true);
        try {
            // 1. Fetch All Businesses
            const { data: businesses, error: busError } = await supabase
                .from('businesses')
                .select('id, name, subscription_status, created_at')
                .order('created_at', { ascending: false });

            if (busError) throw busError;
            const allBiz = businesses || [];

            // Recent 5 businesses
            setRecentBusinesses(allBiz.slice(0, 5));

            const totalBizCount = allBiz.length;
            const activeBizCount = allBiz.filter(b => b.subscription_status === 'active').length;
            const trialBizCount = allBiz.filter(b => b.subscription_status === 'trial' || !b.subscription_status).length;
            const expiredBizCount = allBiz.filter(b => b.subscription_status === 'expired' || b.subscription_status === 'suspended').length;

            // Subscription distribution chart
            setSubDistData([
                { name: 'Active', value: activeBizCount },
                { name: 'Trial', value: trialBizCount },
                { name: 'Expired/Other', value: Math.max(0, expiredBizCount) }
            ]);

            // 2. Fetch Users Count & Support Tickets/Chats
            const [
                { count: totalUsersCount },
                { data: convsData },
                { count: openTicketsCount }
            ] = await Promise.all([
                supabase.from('business_users').select('*', { count: 'exact', head: true }),
                supabase.from('support_conversations').select('unread_admin_count'),
                supabase.from('support_tickets').select('*', { count: 'exact', head: true }).neq('status', 'resolved')
            ]);

            const unreadChatsCount = (convsData || []).reduce((sum, c) => sum + (c.unread_admin_count || 0), 0);

            // 3. Fetch All Platform Orders (using fetchAll helper)
            let startDateThreshold: Date | null = null;
            if (dateFilter === "month") {
                startDateThreshold = startOfMonth(new Date());
            } else if (dateFilter === "30days") {
                startDateThreshold = subDays(new Date(), 30);
            } else if (dateFilter === "7days") {
                startDateThreshold = subDays(new Date(), 7);
            }

            const rawOrders = await fetchAll((from, to) => {
                let q = supabase
                    .from('orders')
                    .select('id, business_id, total_amount, status, created_at');
                if (startDateThreshold) {
                    q = q.gte('created_at', startDateThreshold.toISOString());
                }
                return q.range(from, to);
            });

            const ordersArr = rawOrders || [];
            const totalOrdersCount = ordersArr.length;

            let totalRev = 0;
            let deliveredCount = 0;
            let wonCount = 0;

            const statusCountMap: Record<string, number> = {};
            const storeRevenueMap: Record<string, { name: string; revenue: number; orders: number }> = {};

            // Map business names
            const bizNameMap = new Map<string, string>();
            allBiz.forEach(b => bizNameMap.set(b.id, b.name));

            const timelineMap = new Map<string, { date: string; revenue: number; orders: number }>();

            ordersArr.forEach(o => {
                const amt = Number(o.total_amount || 0);
                totalRev += amt;

                // Status counts
                const st = o.status || 'Pending';
                statusCountMap[st] = (statusCountMap[st] || 0) + 1;

                if (st === 'Delivered' || st === 'Collected') {
                    deliveredCount++;
                }
                if (st !== 'Cancelled' && st !== 'Returned') {
                    wonCount++;
                }

                // Store breakdown
                const bId = o.business_id;
                if (bId) {
                    if (!storeRevenueMap[bId]) {
                        storeRevenueMap[bId] = {
                            name: bizNameMap.get(bId) || `Store ${bId.substring(0, 6)}`,
                            revenue: 0,
                            orders: 0
                        };
                    }
                    storeRevenueMap[bId].revenue += amt;
                    storeRevenueMap[bId].orders += 1;
                }

                // Timeline breakdown
                if (o.created_at) {
                    const dayKey = format(parseISO(o.created_at), "yyyy-MM-dd");
                    if (!timelineMap.has(dayKey)) {
                        timelineMap.set(dayKey, { date: dayKey, revenue: 0, orders: 0 });
                    }
                    const item = timelineMap.get(dayKey)!;
                    item.revenue += amt;
                    item.orders += 1;
                }
            });

            // Sort Timeline ASC
            const timelineSorted = Array.from(timelineMap.values()).sort(
                (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
            );
            setTimelineData(timelineSorted);

            // Status Distribution Chart Data
            const statusChartData = Object.keys(statusCountMap).map(st => ({
                name: st,
                value: statusCountMap[st],
                color: STATUS_COLORS[st] || '#8884d8'
            }));
            setStatusDistData(statusChartData);

            // Top 5 Stores by Revenue
            const topStores = Object.values(storeRevenueMap)
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 5);
            setTopStoresData(topStores);

            // Set KPI Metrics
            setKpi({
                totalRevenue: totalRev,
                totalOrders: totalOrdersCount,
                deliveredOrders: deliveredCount,
                wonRate: totalOrdersCount ? (wonCount / totalOrdersCount) * 100 : 0,
                totalBusinesses: totalBizCount,
                activeBusinesses: activeBizCount,
                trialBusinesses: trialBizCount,
                totalUsers: totalUsersCount || 0,
                unreadSupportChats: unreadChatsCount,
                openTickets: openTicketsCount || 0,
            });

        } catch (err) {
            console.error("Error fetching system admin overview data:", err);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="flex min-h-[500px] flex-col items-center justify-center gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground animate-pulse">
                    Loading Executive Platform Analytics...
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-8 pb-10">
            {/* Top Page Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border/50 pb-5">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        eCommerx Platform Overview
                        <Sparkles className="h-5 w-5 text-amber-500" />
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Real-time executive metrics, revenue insights, store performance, and system health.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <Select value={dateFilter} onValueChange={setDateFilter}>
                        <SelectTrigger className="w-[160px] h-9 text-xs bg-background">
                            <SelectValue placeholder="Time Filter" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Time</SelectItem>
                            <SelectItem value="month">This Month</SelectItem>
                            <SelectItem value="30days">Last 30 Days</SelectItem>
                            <SelectItem value="7days">Last 7 Days</SelectItem>
                        </SelectContent>
                    </Select>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={fetchOverviewData}
                        className="h-9 gap-1.5 text-xs"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Section 1: Executive KPI Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* 1. Platform Sales */}
                <Card className="shadow-sm border border-border/60 hover:border-primary/40 transition-all">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Total Platform Sales
                        </CardTitle>
                        <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                            <Banknote className="h-4 w-4" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-foreground">
                            {formatCurrency(kpi.totalRevenue)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <span className="text-emerald-600 font-medium">Gross Merchandise Value</span>
                            across all stores
                        </p>
                    </CardContent>
                </Card>

                {/* 2. Platform Orders */}
                <Card className="shadow-sm border border-border/60 hover:border-primary/40 transition-all">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Total Orders
                        </CardTitle>
                        <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-600 flex items-center justify-center">
                            <ShoppingBag className="h-4 w-4" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-foreground">
                            {kpi.totalOrders.toLocaleString()}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 text-[10px]">
                                {kpi.wonRate.toFixed(1)}% Success Rate
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">
                                ({kpi.deliveredOrders} Delivered)
                            </span>
                        </div>
                    </CardContent>
                </Card>

                {/* 3. Stores & Subscriptions */}
                <Card className="shadow-sm border border-border/60 hover:border-primary/40 transition-all">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Registered Stores
                        </CardTitle>
                        <div className="h-8 w-8 rounded-lg bg-purple-500/10 text-purple-600 flex items-center justify-center">
                            <Store className="h-4 w-4" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-foreground">
                            {kpi.totalBusinesses} Stores
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                            <span className="text-emerald-600 font-medium">{kpi.activeBusinesses} Active</span> |
                            <span className="text-blue-600 font-medium">{kpi.trialBusinesses} Trial</span>
                        </p>
                    </CardContent>
                </Card>

                {/* 4. Live Support Queue */}
                <Card className="shadow-sm border border-border/60 hover:border-primary/40 transition-all">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Support Queue
                        </CardTitle>
                        <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center relative">
                            <MessageSquare className="h-4 w-4" />
                            {kpi.unreadSupportChats > 0 && (
                                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-500 animate-ping" />
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-foreground flex items-center gap-2">
                            {kpi.unreadSupportChats} Unread
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                                {kpi.openTickets} Open Tickets
                            </span>
                            <Link href="/system-admin/chat">
                                <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-primary hover:text-primary">
                                    Open Desk &rarr;
                                </Button>
                            </Link>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Section 2: Main Timeline & Subscription Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 1. Revenue & Orders Growth Timeline (2 Cols) */}
                <Card className="lg:col-span-2 shadow-sm border border-border/60">
                    <CardHeader>
                        <CardTitle className="text-base font-bold flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-primary" />
                            Platform Revenue & Orders Growth Timeline
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Daily sales volume (EGP) and order counts across all tenant stores.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="h-[320px]">
                        {timelineData.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs">
                                No timeline order data found for selected period.
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={timelineData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#88888820" />
                                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                    <YAxis tick={{ fontSize: 11 }} />
                                    <Tooltip
                                        formatter={(val: any, name: any) => [
                                            name === 'revenue' ? formatCurrency(Number(val)) : val,
                                            name === 'revenue' ? 'Sales Revenue' : 'Orders'
                                        ]}
                                    />
                                    <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorRev)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                {/* 2. Subscription Status Ratio (1 Col) */}
                <Card className="lg:col-span-1 shadow-sm border border-border/60">
                    <CardHeader>
                        <CardTitle className="text-base font-bold flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-purple-600" />
                            Stores Subscription Ratios
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Breakdown of registered stores by plan status.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="h-[320px] flex flex-col justify-center items-center">
                        <ResponsiveContainer width="100%" height="80%">
                            <PieChart>
                                <Pie
                                    data={subDistData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={55}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {subDistData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={SUB_COLORS[index % SUB_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            {/* Section 3: Top Stores & Order Status Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top 5 Performing Tenant Stores */}
                <Card className="shadow-sm border border-border/60">
                    <CardHeader>
                        <CardTitle className="text-base font-bold flex items-center gap-2">
                            <Store className="h-4 w-4 text-blue-600" />
                            Top Performing Tenant Stores
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Stores generating highest merchandise sales volume.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        {topStoresData.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                                No store sales data available.
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={topStoresData} layout="vertical" margin={{ top: 10, right: 30, left: 40, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#88888820" />
                                    <XAxis type="number" tick={{ fontSize: 11 }} />
                                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                                    <Tooltip formatter={(val: any) => [formatCurrency(Number(val)), "Sales Volume"]} />
                                    <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 6, 6, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                {/* Order Status Breakdown */}
                <Card className="shadow-sm border border-border/60">
                    <CardHeader>
                        <CardTitle className="text-base font-bold flex items-center gap-2">
                            <PackageCheck className="h-4 w-4 text-emerald-600" />
                            Platform Order Status Distribution
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Volume breakdown across order lifecycle stages.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        {statusDistData.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                                No order status data found.
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={statusDistData}
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={85}
                                        dataKey="value"
                                        label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                                    >
                                        {statusDistData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Section 4: Recent Stores Onboarded & Quick Admin Links */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Recent Stores Table */}
                <Card className="lg:col-span-2 shadow-sm border border-border/60">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="text-base font-bold">Recently Onboarded Stores</CardTitle>
                            <CardDescription className="text-xs">Latest tenant businesses registered on eCommerx.</CardDescription>
                        </div>
                        <Link href="/system-admin/businesses">
                            <Button variant="outline" size="sm" className="h-8 text-xs">
                                View All Stores
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {recentBusinesses.length === 0 ? (
                                <p className="text-xs text-muted-foreground text-center py-4">No recent store registrations.</p>
                            ) : (
                                recentBusinesses.map((b) => (
                                    <div key={b.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/40 hover:bg-muted/60 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary font-bold flex items-center justify-center text-xs">
                                                {b.name ? b.name.charAt(0).toUpperCase() : 'S'}
                                            </div>
                                            <div>
                                                <h4 className="font-semibold text-xs text-foreground">{b.name}</h4>
                                                <span className="text-[10px] text-muted-foreground font-mono">ID: {b.id.substring(0, 8)}...</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4">
                                            <Badge variant="outline" className={`text-[10px] capitalize ${
                                                b.subscription_status === 'active' ? 'border-emerald-500/40 text-emerald-600 bg-emerald-500/10' : 'border-blue-500/40 text-blue-600 bg-blue-500/10'
                                            }`}>
                                                {b.subscription_status || 'Trial'}
                                            </Badge>
                                            <span className="text-[11px] text-muted-foreground">
                                                {b.created_at ? format(new Date(b.created_at), "yyyy-MM-dd") : "N/A"}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Quick Management Shortcuts */}
                <Card className="lg:col-span-1 shadow-sm border border-border/60 flex flex-col justify-between">
                    <CardHeader>
                        <CardTitle className="text-base font-bold">Quick Control Center</CardTitle>
                        <CardDescription className="text-xs">Direct access to core System Admin modules.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2.5">
                        <Link href="/system-admin/chat" className="block">
                            <Button variant="outline" className="w-full justify-between h-11 rounded-xl bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary">
                                <span className="flex items-center gap-2 text-xs font-semibold">
                                    <MessageSquare className="h-4 w-4" /> Live Chat Support Desk
                                </span>
                                <Badge className="bg-primary text-primary-foreground text-[10px]">Live</Badge>
                            </Button>
                        </Link>

                        <Link href="/system-admin/businesses" className="block">
                            <Button variant="outline" className="w-full justify-start h-10 rounded-xl text-xs gap-2">
                                <Store className="h-4 w-4 text-purple-600" /> Manage Stores & Subscriptions
                            </Button>
                        </Link>

                        <Link href="/system-admin/pricing" className="block">
                            <Button variant="outline" className="w-full justify-start h-10 rounded-xl text-xs gap-2">
                                <Banknote className="h-4 w-4 text-emerald-600" /> Pricing & Subscription Plans
                            </Button>
                        </Link>

                        <Link href="/system-admin/audit-logs" className="block">
                            <Button variant="outline" className="w-full justify-start h-10 rounded-xl text-xs gap-2">
                                <ShieldCheck className="h-4 w-4 text-blue-600" /> Security & Audit Logs
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
