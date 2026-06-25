"use client";

import { useEffect, useState, Suspense } from "react";
import { cn } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DateRangePicker } from "@/components/date-range-picker";
import { Loader2, TrendingUp, TrendingDown, DollarSign, Target, Activity, Percent, Megaphone, Package, Briefcase } from "lucide-react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, BarChart, Bar, AreaChart, Area
} from "recharts";
import { format, parseISO, startOfDay, isWithinInterval, endOfDay, startOfMonth } from "date-fns";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

function InsightsContent() {
    const { activeBusiness } = useBusiness();
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
    const [dailyAdsData, setDailyAdsData] = useState<any[]>([]);

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

    // 4. Business Value (Snapshot)
    const [businessValue, setBusinessValue] = useState<{
        totalInvestment: number;
        pendingOrdersValue: number;
        stockValue: number;
        treasuries: Record<string, number>;
        totalDebts: number;
        estimatedBusinessValue: number;
        investmentGrowthRatio: number;
    }>({
        totalInvestment: 0,
        pendingOrdersValue: 0,
        stockValue: 0,
        treasuries: {},
        totalDebts: 0,
        estimatedBusinessValue: 0,
        investmentGrowthRatio: 0
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
        if (!activeBusiness) return;
        setLoading(true);
        try {
            // Safe defaults (though useEffect handles redirect)
            const start = fromDate ? `${fromDate}T00:00:00` : format(startOfMonth(new Date()), "yyyy-MM-dd'T'00:00:00");
            const end = toDate ? `${toDate}T23:59:59` : format(new Date(), "yyyy-MM-dd'T'23:59:59");
            const dateOnlyStart = fromDate || format(startOfMonth(new Date()), "yyyy-MM-dd");
            const dateOnlyEnd = toDate || format(new Date(), "yyyy-MM-dd");

            // --- 1. ADS INSIGHTS ---
            const [
                { data: rawAdsExpenses },
                { data: rawOrders }
            ] = await Promise.all([
                supabase.from('ads_expenses')
                    .select('ad_date, amount')
                    .eq('business_id', activeBusiness.id)
                    .gte('ad_date', dateOnlyStart)
                    .lte('ad_date', dateOnlyEnd),
                supabase.from('orders')
                    .select('created_at, total_amount, status, total_cost, shipping_cost')
                    .eq('business_id', activeBusiness.id)
                    .gte('created_at', start)
                    .lte('created_at', end)
            ]);

            const adsExpensesArr = rawAdsExpenses || [];
            const ordersArr = rawOrders || [];
            const validOrdersArr = ordersArr.filter(o => o.status !== 'Cancelled');

            const adsSpent = adsExpensesArr.reduce((sum, item) => sum + Number(item.amount || 0), 0);
            const adsOrders = validOrdersArr.length;
            const adsRev = validOrdersArr.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);

            setAdsMetrics({
                adsSpent,
                ordersCount: adsOrders,
                revenue: adsRev,
                aov: adsOrders ? adsRev / adsOrders : 0,
                cpo: adsOrders ? adsSpent / adsOrders : 0,
                roas: adsSpent ? adsRev / adsSpent : 0
            });

            // 1.1 Daily Ads Data
            const dailyMap = new Map<string, any>();
            let currDate = parseISO(start);
            const endDateObj = parseISO(end);
            
            while (currDate <= endDateObj) {
                const dayStr = format(currDate, "yyyy-MM-dd");
                dailyMap.set(dayStr, {
                    day_date: dayStr,
                    daily_ads_spent: 0,
                    daily_orders: 0,
                    daily_revenue: 0,
                    daily_cpo: 0,
                    daily_roas: 0
                });
                currDate.setDate(currDate.getDate() + 1);
            }

            adsExpensesArr.forEach(item => {
                const dayStr = format(parseISO(item.ad_date), "yyyy-MM-dd");
                if (dailyMap.has(dayStr)) {
                    dailyMap.get(dayStr).daily_ads_spent += Number(item.amount || 0);
                }
            });

            validOrdersArr.forEach(item => {
                const dayStr = format(parseISO(item.created_at), "yyyy-MM-dd");
                if (dailyMap.has(dayStr)) {
                    dailyMap.get(dayStr).daily_orders += 1;
                    dailyMap.get(dayStr).daily_revenue += Number(item.total_amount || 0);
                }
            });

            const dailyData = Array.from(dailyMap.values()).map(d => {
                d.daily_cpo = d.daily_orders > 0 ? d.daily_ads_spent / d.daily_orders : 0;
                d.daily_roas = d.daily_ads_spent > 0 ? d.daily_revenue / d.daily_ads_spent : 0;
                return d;
            });
            setDailyAdsData(dailyData);

            // --- 2. ORDERS INSIGHTS ---
            const ordCount = ordersArr.length;
            const ordRev = ordersArr.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
            const ordCogs = ordersArr.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
            const ordShip = ordersArr.reduce((sum, item) => sum + Number(item.shipping_cost || 0), 0);
            const wonCount = ordersArr.filter(o => o.status !== 'Cancelled' && o.status !== 'Returned').length;

            const handling = 0;
            const totalDeductions = ordCogs + adsSpent + ordShip; 
            const ordNetProfit = ordRev - totalDeductions;

            const collectable = ordRev - ordShip;

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
            const { data: rawTransactions, error: busError } = await supabase
                .from('transactions')
                .select('type, category, amount, transaction_date')
                .eq('business_id', activeBusiness.id)
                .gte('transaction_date', dateOnlyStart)
                .lte('transaction_date', dateOnlyEnd);

            if (busError) throw busError;

            let busRev = 0;
            let busExp = 0;
            let busAdsExp = 0;
            let busPurExp = 0;
            let busOthExp = 0;

            (rawTransactions || []).forEach(t => {
                const amt = Number(t.amount || 0);
                if (t.type === 'revenue') {
                    busRev += amt;
                } else if (t.type === 'expense') {
                    busExp += amt;
                    const cat = (t.category || '').toLowerCase();
                    if (cat === 'ads') {
                        busAdsExp += amt;
                    } else if (cat === 'purchases') {
                        busPurExp += amt;
                    } else {
                        busOthExp += amt;
                    }
                }
            });

            const busNet = busRev + busExp; // expenses are negative

            setBusinessMetrics({
                revenue: busRev,
                totalExpenses: busExp,
                adsExpenses: busAdsExp,
                purchasesExpenses: busPurExp,
                otherExpenses: busOthExp,
                netProfit: busNet,
                roi: busExp ? (busNet / Math.abs(busExp)) * 100 : 0
            });

            // --- 4. BUSINESS VALUE (SNAPSHOT) ---
            // Fetch these in parallel
            const [
                { data: investData },
                { data: pendingData },
                { data: balancesData },
                { data: accountsData },
                { data: stockData },
                { data: supplierInvoicesData }
            ] = await Promise.all([
                // 1. Total Investment
                supabase.from('transactions').select('amount').eq('business_id', activeBusiness.id).eq('type', 'investment'),
                // 2. Pending Orders (Prepared + Shipped Only)
                supabase.from('orders').select('total_amount').eq('business_id', activeBusiness.id).in('status', ['Prepared', 'Shipped']),
                // 3. Treasury Balances (using same RPC as accounting page)
                supabase.rpc('get_treasury_balances', { p_business_id: activeBusiness.id }),
                supabase.from('financial_accounts').select('name').eq('business_id', activeBusiness.id),
                // 4. Stock Value
                supabase.from('variants').select('cost_price, stock_qty'),
                // 5. Total Debts
                supabase.from('supplier_invoices').select('total_amount, paid_amount').eq('business_id', activeBusiness.id).neq('status', 'Fully Paid')
            ]);

            const investVal = investData?.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) || 0;
            const pendingVal = pendingData?.reduce((sum, row) => sum + (Number(row.total_amount) || 0), 0) || 0;
            
            const treasuries: Record<string, number> = {};
            if (accountsData) {
                accountsData.forEach(acc => {
                    if (acc.name) treasuries[acc.name] = 0;
                });
            }

            let totalTreasuryVal = 0;
            if (balancesData) {
                balancesData.forEach((t: any) => {
                    if (t.account_name) {
                        const amt = Number(t.balance) || 0;
                        treasuries[t.account_name] = amt;
                        totalTreasuryVal += amt;
                    }
                });
            }

            const stockVal = stockData?.reduce((sum, row) => sum + ((Number(row.cost_price) || 0) * (Number(row.stock_qty) || 0)), 0) || 0;
            const totalDebtsVal = supplierInvoicesData?.reduce((sum, row) => sum + ((Number(row.total_amount) || 0) - (Number(row.paid_amount) || 0)), 0) || 0;

            const estimatedVal = totalTreasuryVal + stockVal + pendingVal - totalDebtsVal;
            const growthRatio = investVal ? ((estimatedVal - investVal) / investVal) * 100 : 0;

            setBusinessValue({
                totalInvestment: investVal,
                pendingOrdersValue: pendingVal,
                stockValue: stockVal,
                treasuries,
                totalDebts: totalDebtsVal,
                estimatedBusinessValue: estimatedVal,
                investmentGrowthRatio: growthRatio
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

            <Tabs defaultValue="snapshot" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="snapshot">Business Value</TabsTrigger>
                    <TabsTrigger value="ads">Ads Insights</TabsTrigger>
                    <TabsTrigger value="orders">Orders Insights</TabsTrigger>
                    <TabsTrigger value="business">Business Metrics</TabsTrigger>
                </TabsList>

                <TabsContent value="snapshot" className="space-y-4">
                    {/* SECTION 1: BUSINESS VALUE (SNAPSHOT) - Moved to Top */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-semibold flex items-center gap-2">
                            <DollarSign className="h-5 w-5 text-amber-600" />
                            Business Value (Snapshot)
                        </h2>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            {/* New Metrics */}
                            <MetricCard
                                title="Est. Business Value"
                                value={formatCurrency(businessValue.estimatedBusinessValue)}
                                sub="Stock + Cash + Pending Orders"
                                bold
                                className="bg-primary/5 border-primary/20"
                            />
                            <MetricCard
                                title="Growth Ratio"
                                value={`${businessValue.investmentGrowthRatio.toFixed(1)}%`}
                                sub="(Est. Value - Inv) / Inv"
                                pos={businessValue.investmentGrowthRatio > 0}
                                neg={businessValue.investmentGrowthRatio < 0}
                            />
                            <MetricCard title="Total Investment" value={formatCurrency(businessValue.totalInvestment)} sub="All Time" />
                            <MetricCard title="Stock Value" value={formatCurrency(businessValue.stockValue)} sub="Cost * Qty" />
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <MetricCard title="Pending Orders Value" value={formatCurrency(businessValue.pendingOrdersValue)} sub="Prepared + Shipped only" />
                            {Object.entries(businessValue.treasuries).map(([name, val]) => (
                                <MetricCard key={name} title={`Treasury: ${name}`} value={formatCurrency(val)} sub="Cash Balance" />
                            ))}
                            <MetricCard title="Total Debts" value={formatCurrency(businessValue.totalDebts)} sub="Unpaid Supplier Invoices" neg className="bg-red-50/50" />
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="ads" className="space-y-4">
                    {/* SECTION 2: ADS INSIGHTS */}
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
                    {/* Charts Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Cost Per Order (CPO) Trend</CardTitle>
                                <CardDescription>Daily cost to acquire an order</CardDescription>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={dailyAdsData}>
                                        <defs>
                                            <linearGradient id="colorCpo" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} />
                                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis
                                            dataKey="day_date"
                                            tickFormatter={(value) => format(parseISO(value), "dd MMM")}
                                            tickLine={false}
                                            axisLine={false}
                                        />
                                        <YAxis tickFormatter={(value) => `EGP ${value}`} axisLine={false} tickLine={false} />
                                        <Tooltip
                                            formatter={(value: any) => formatCurrency(Number(value) || 0)}
                                            labelFormatter={(label) => format(parseISO(label), "dd MMM yyyy")}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="daily_cpo"
                                            stroke="#ef4444"
                                            fillOpacity={1}
                                            fill="url(#colorCpo)"
                                            name="CPO"
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>ROAS Trend</CardTitle>
                                <CardDescription>Return on Ad Spend (Revenue / Spend)</CardDescription>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={dailyAdsData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis
                                            dataKey="day_date"
                                            tickFormatter={(value) => format(parseISO(value), "dd MMM")}
                                            tickLine={false}
                                            axisLine={false}
                                        />
                                        <YAxis tickFormatter={(value) => `${value}x`} axisLine={false} tickLine={false} />
                                        <Tooltip
                                            formatter={(value: any) => `${(Number(value) || 0).toFixed(2)}x`}
                                            labelFormatter={(label) => format(parseISO(label), "dd MMM yyyy")}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="daily_roas"
                                            stroke="#10b981"
                                            strokeWidth={2}
                                            dot={false}
                                            name="ROAS"
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="orders" className="space-y-4">
                    {/* SECTION 3: ORDERS INSIGHTS */}
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
                            <MetricCard title="Shipping Costs" value={formatCurrency(ordersMetrics.shipping)} sub="Actual Shipping Cost" neg />

                            <MetricCard title="Net Profit" value={formatCurrency(ordersMetrics.netProfit)} pos={ordersMetrics.netProfit > 0} bold />
                            <MetricCard title="Profit / Order" value={formatCurrency(ordersMetrics.netProfitPerOrder)} pos={ordersMetrics.netProfitPerOrder > 0} />

                            <MetricCard title="Won Rate" value={`${ordersMetrics.wonRate.toFixed(1)}%`} />
                            <MetricCard title="Collectable (Net)" value={formatCurrency(ordersMetrics.collectable)} sub="Rev - Ship - Fees" bold />
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="business" className="space-y-4">
                    {/* SECTION 4: BUSINESS INSIGHTS */}
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
                </TabsContent>
            </Tabs>
        </div>
    );
}

// Helper Card Component
function MetricCard({ title, value, sub, pos, neg, bold, className }: any) {
    return (
        <Card className={className}>
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



export default function InsightsPage() {
    const { activeBusiness } = useBusiness();
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <InsightsContent />
        </Suspense>
    );
}



