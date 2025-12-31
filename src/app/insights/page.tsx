"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DateRangePicker } from "@/components/date-range-picker";
import { Loader2, TrendingUp, TrendingDown, DollarSign, Target, Activity, Percent, Megaphone, Package, Briefcase } from "lucide-react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, BarChart, Bar
} from "recharts";
import { format, parseISO, startOfDay, isWithinInterval, endOfDay, startOfMonth } from "date-fns";
import { useRouter } from "next/navigation";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

function InsightsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    const [loading, setLoading] = useState(true);

    // 1. Ads Metrics
    const [adsMetrics, setAdsMetrics] = useState({
        adsSpent: 0,
        ordersCount: 0,
        revenue: 0,
        aov: 0,
        cpo: 0,
        roas: 0
    });

    // 2. Orders Metrics
    const [ordersMetrics, setOrdersMetrics] = useState({
        count: 0,
        revenue: 0,
        aov: 0,
        cogs: 0,
        adsSpent: 0, // Same as section 1
        shipping: 0,
        handlingFees: 0, // 10 EGP * count
        netProfit: 0,
        netProfitPerOrder: 0,
        wonRate: 0,
        collectable: 0
    });

    // 3. Business Metrics
    const [businessMetrics, setBusinessMetrics] = useState({
        revenue: 0,
        totalExpenses: 0,
        adsExpenses: 0,
        purchasesExpenses: 0,
        otherExpenses: 0,
        netProfit: 0,
        roi: 0
    });

    useEffect(() => {
        // Default to "This Month" if no params
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
            // Safe defaults (though useEffect handles redirect)
            const start = fromDate ? `${fromDate}T00:00:00` : format(startOfMonth(new Date()), "yyyy-MM-dd'T'00:00:00");
            const end = toDate ? `${toDate}T23:59:59` : format(new Date(), "yyyy-MM-dd'T'23:59:59");
            const dateOnlyStart = fromDate || format(startOfMonth(new Date()), "yyyy-MM-dd");
            const dateOnlyEnd = toDate || format(new Date(), "yyyy-MM-dd");

            // --- 1. ADS INSIGHTS ---
            const { data: adsData, error: adsError } = await supabase.rpc('get_insight_ads_stats', {
                from_date: start, // Assuming RPC updated to take timestamp or date string
                to_date: end
            });
            if (adsError) throw adsError;

            // Ads RPC returns table with single row
            const adsRow = adsData[0] || { total_ads_spent: 0, total_orders: 0, total_revenue: 0 };
            const adsSpent = Number(adsRow.total_ads_spent);
            const adsOrders = Number(adsRow.total_orders);
            const adsRev = Number(adsRow.total_revenue);

            setAdsMetrics({
                adsSpent,
                ordersCount: adsOrders,
                revenue: adsRev,
                aov: adsOrders ? adsRev / adsOrders : 0,
                cpo: adsOrders ? adsSpent / adsOrders : 0,
                roas: adsSpent ? adsRev / adsSpent : 0
            });

            // --- 2. ORDERS INSIGHTS ---
            const { data: ordData, error: ordError } = await supabase.rpc('get_insight_orders_stats', {
                from_date: start,
                to_date: end
            });
            if (ordError) throw ordError;

            const ordRow = ordData[0] || { total_count: 0, total_revenue: 0, total_cogs: 0, total_shipping: 0, won_count: 0 };
            const ordCount = Number(ordRow.total_count);
            const ordRev = Number(ordRow.total_revenue);
            const ordCogs = Number(ordRow.total_cogs);
            const ordShip = Number(ordRow.total_shipping);
            const wonCount = Number(ordRow.won_count);

            const handling = ordCount * 10; // 10 EGP per order
            const totalDeductions = ordCogs + adsSpent + ordShip + handling; // Ads Spent is reused here
            const ordNetProfit = ordRev - totalDeductions;

            // "Collectable Orders total minus shipping minus 10 pounds" -> Implies Net Revenue from courier
            // Assuming 'Collectable' means (Revenue - ShippingCost - Handling)
            const collectable = ordRev - ordShip - handling;

            setOrdersMetrics({
                count: ordCount,
                revenue: ordRev,
                aov: ordCount ? ordRev / ordCount : 0,
                cogs: ordCogs,
                adsSpent: adsSpent,
                shipping: ordShip,
                handlingFees: handling,
                netProfit: ordNetProfit,
                netProfitPerOrder: ordCount ? ordNetProfit / ordCount : 0,
                wonRate: ordCount ? (wonCount / ordCount) * 100 : 0,
                collectable: collectable
            });


            // --- 3. BUSINESS INSIGHTS ---
            const { data: busData, error: busError } = await supabase.rpc('get_insight_business_stats', {
                from_date: dateOnlyStart,
                to_date: dateOnlyEnd
            });
            if (busError) throw busError;

            const busRow = busData[0] || { total_revenue: 0, total_expenses: 0, ads_expenses: 0, purchases_expenses: 0, other_expenses: 0 };
            const busRev = Number(busRow.total_revenue);
            const busExp = Number(busRow.total_expenses);
            const busNet = busRev - busExp;

            setBusinessMetrics({
                revenue: busRev,
                totalExpenses: busExp,
                adsExpenses: Number(busRow.ads_expenses),
                purchasesExpenses: Number(busRow.purchases_expenses),
                otherExpenses: Number(busRow.other_expenses),
                netProfit: busNet,
                roi: busExp ? (busNet / busExp) * 100 : 0
            });

        } catch (error) {
            console.error("Error fetching insights:", error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <h1 className="text-3xl font-bold tracking-tight">Advanced Insights</h1>
                <DateRangePicker />
            </div>

            {/* SECTION 1: ADS INSIGHTS */}
            <div className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Megaphone className="h-5 w-5 text-blue-600" />
                    Ads Insights
                </h2>
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                    <MetricCard title="Ads Spent" value={formatCurrency(adsMetrics.adsSpent)} sub="From CSV Uploads" />
                    <MetricCard title="Orders Count" value={adsMetrics.ordersCount} />
                    <MetricCard title="Order Revenue" value={formatCurrency(adsMetrics.revenue)} />
                    <MetricCard title="AOV" value={formatCurrency(adsMetrics.aov)} />
                    <MetricCard title="Cost Per Order" value={formatCurrency(adsMetrics.cpo)} neg={true} />
                    <MetricCard title="ROAS" value={`${adsMetrics.roas.toFixed(2)}x`} pos={adsMetrics.roas > 2} />
                </div>
            </div>

            <div className="border-t" />

            {/* SECTION 2: ORDERS INSIGHTS */}
            <div className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Package className="h-5 w-5 text-purple-600" />
                    Orders Insights
                </h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <MetricCard title="Orders Count" value={ordersMetrics.count} />
                    <MetricCard title="Revenue" value={formatCurrency(ordersMetrics.revenue)} />
                    <MetricCard title="AOV" value={formatCurrency(ordersMetrics.aov)} />
                    <MetricCard title="COGS" value={formatCurrency(ordersMetrics.cogs)} neg />

                    <MetricCard title="Ads Spent" value={formatCurrency(ordersMetrics.adsSpent)} neg />
                    <MetricCard title="Shipping + Fees" value={formatCurrency(ordersMetrics.shipping + ordersMetrics.handlingFees)} sub={`Shipping + ${formatCurrency(ordersMetrics.handlingFees)} Fees`} neg />

                    <MetricCard title="Net Profit" value={formatCurrency(ordersMetrics.netProfit)} pos={ordersMetrics.netProfit > 0} bold />
                    <MetricCard title="Profit / Order" value={formatCurrency(ordersMetrics.netProfitPerOrder)} pos={ordersMetrics.netProfitPerOrder > 0} />

                    <MetricCard title="Won Rate" value={`${ordersMetrics.wonRate.toFixed(1)}%`} />
                    <MetricCard title="Collectable (Net)" value={formatCurrency(ordersMetrics.collectable)} sub="Rev - Ship - Fees" bold />
                </div>
            </div>

            <div className="border-t" />

            {/* SECTION 3: BUSINESS INSIGHTS */}
            <div className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Briefcase className="h-5 w-5 text-green-600" />
                    Business Insights
                </h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <MetricCard title="Transaction Revenue" value={formatCurrency(businessMetrics.revenue)} pos />
                    <MetricCard title="Total Expenses" value={formatCurrency(businessMetrics.totalExpenses)} neg />
                    <MetricCard title="Net Profit" value={formatCurrency(businessMetrics.netProfit)} pos={businessMetrics.netProfit > 0} bold />
                    <MetricCard title="ROI" value={`${businessMetrics.roi.toFixed(1)}%`} pos={businessMetrics.roi > 0} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <MetricCard title="Ads Expenses" value={formatCurrency(businessMetrics.adsExpenses)} sub="From Transactions" />
                    <MetricCard title="Purchase Expenses" value={formatCurrency(businessMetrics.purchasesExpenses)} sub="From Transactions" />
                    <MetricCard title="Other Expenses" value={formatCurrency(businessMetrics.otherExpenses)} sub="From Transactions" />
                </div>
            </div>
        </div>
    );
}

// Helper Card Component
function MetricCard({ title, value, sub, pos, neg, bold }: any) {
    return (
        <Card>
            <CardHeader className="p-4 pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">{title}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
                <div className={cn(
                    "text-2xl font-bold",
                    pos && "text-green-600",
                    neg && "text-red-600",
                    bold && "text-primary"
                )}>
                    {value}
                </div>
                {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
            </CardContent>
        </Card>
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
