"use client";

import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase, fetchAll } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";

import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
    const { activeBusiness } = useBusiness();
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

    // How much of what was sold in this period has actually been collected.
    // The cards above track money that arrived; this tracks what is still owed.
    const [payment, setPayment] = useState<{
        payment_status: string; orders_count: number; total_value: number;
        paid_value: number; outstanding: number;
    }[]>([]);
    const [paymentMissing, setPaymentMissing] = useState(false);

    // Does every deposit written on an order actually exist in the treasury?
    const [recon, setRecon] = useState<any | null>(null);
    const [unbooked, setUnbooked] = useState<any[]>([]);
    const [reconMissing, setReconMissing] = useState(false);
    const [showUnbooked, setShowUnbooked] = useState(false);
    // Every row that makes the two totals differ, each with a reason.
    const [discrepancies, setDiscrepancies] = useState<any[]>([]);

    // What the couriers should hand over for this period.
    const [courier, setCourier] = useState<any[]>([]);
    const [courierMissing, setCourierMissing] = useState(false);

    const [dupes, setDupes] = useState<any[]>([]);
    const [dupesMissing, setDupesMissing] = useState(false);
    const [showDupes, setShowDupes] = useState(false);
    const [openDupe, setOpenDupe] = useState<string | null>(null);

    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');

    useEffect(() => {
        fetchRevenues();
    }, [fromDate, toDate, activeBusiness]);

    async function fetchRevenues() {
        setLoading(true);
        try {
            const today = new Date();
            const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
            const defaultEnd = today.toISOString();

            const start = fromDate || defaultStart;
            const end = toDate || defaultEnd;

            if (activeBusiness) {
                const { data: pay, error: payErr } = await supabase.rpc("get_payment_status_breakdown", {
                    p_business_id: activeBusiness.id,
                    p_from: new Date(start).toISOString(),
                    // The picker's end date is inclusive; the RPC's bound is not.
                    p_to: new Date(new Date(end).getTime() + 86400000).toISOString(),
                });
                if (payErr) { setPaymentMissing(true); setPayment([]); }
                else { setPaymentMissing(false); setPayment((pay as any[]) || []); }

                const args = {
                    p_business_id: activeBusiness.id,
                    p_from: new Date(start).toISOString(),
                    p_to: new Date(new Date(end).getTime() + 86400000).toISOString(),
                };
                const [recRes, unbRes, discRes] = await Promise.all([
                    supabase.rpc("get_deposit_reconciliation", args),
                    supabase.rpc("get_unbooked_deposits", args),
                    supabase.rpc("get_deposit_discrepancies", args),
                ]);
                setDiscrepancies((discRes.data as any[]) || []);

                const dupRes = await supabase.rpc("get_duplicate_deposits", args);
                if (dupRes.error) { setDupesMissing(true); setDupes([]); }
                else { setDupesMissing(false); setDupes((dupRes.data as any[]) || []); }

                const courRes = await supabase.rpc("get_courier_net_due", args);
                if (courRes.error) { setCourierMissing(true); setCourier([]); }
                else { setCourierMissing(false); setCourier((courRes.data as any[]) || []); }
                if (recRes.error) { setReconMissing(true); setRecon(null); setUnbooked([]); }
                else {
                    setReconMissing(false);
                    setRecon((recRes.data as any[])?.[0] || null);
                    setUnbooked((unbRes.data as any[]) || []);
                }
            }

            // Fetch Revenue Transactions with fetchAll
            const revTrans = await fetchAll((from, to) => {
                let q = supabase
                    .from('transactions')
                    .select('transaction_date, amount, category, type')
                    .eq('type', 'revenue')
                    .gte('transaction_date', start)
                    .lte('transaction_date', end);
                if (activeBusiness?.id) {
                    q = q.eq('business_id', activeBusiness.id);
                }
                return q.range(from, to);
            });


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

                // 'orders_collection' is a customer deposit taken on a platform
                // order — the platform-orders screen writes it under that name.
                // It used to land in Collections, which understated deposits by
                // 11,265 EGP and made a third of them invisible on this card.
                //
                // 'orders collection' with a space is a different thing entirely:
                // money collected from couriers in bulk, 66% of it over 1,000 EGP
                // and up to 74,218, against a deposit ceiling of about 2,600.
                if (cat === 'deposit' || cat === 'deposits' || cat === 'orders_collection') {
                    dVal += amt;
                    dCount++;
                    chartDataMap[dateKey].Deposits += amt;
                } else if (cat === 'orders collection') {
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

    const payTotals = payment.reduce((a, r) => ({
        orders: a.orders + Number(r.orders_count || 0),
        value: a.value + Number(r.total_value || 0),
        paid: a.paid + Number(r.paid_value || 0),
        outstanding: a.outstanding + Number(r.outstanding || 0),
    }), { orders: 0, value: 0, paid: 0, outstanding: 0 });

    const PAY_STYLE: Record<string, { label: string; colour: string; bg: string }> = {
        "Paid": { label: "مدفوع بالكامل", colour: "#10b981", bg: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
        "Partially Paid": { label: "مدفوع جزئياً", colour: "#f59e0b", bg: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
        "Not Paid": { label: "غير مدفوع", colour: "#94a3b8", bg: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
    };
    const payOrder = ["Paid", "Partially Paid", "Not Paid"];
    const paySorted = [...payment].sort(
        (a, b) => payOrder.indexOf(a.payment_status) - payOrder.indexOf(b.payment_status));

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
                        <PackageCheck className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-primary">{formatCurrency(collectionsValue)}</div>
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
                            <span className="text-primary font-semibold">{formatCurrency(collectionsValue)}</span>
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

            {/* What the couriers owe for this period. The settlements screen
                records the transfers when they arrive; this is the shorter
                question — how much should arrive at all. Both read the same
                v_courier_payouts definition so they cannot disagree. */}
            <Card>
                <CardHeader>
                    <CardTitle>المستحق من شركات الشحن</CardTitle>
                    <CardDescription>
                        الصافي المفروض يوصلك عن أوردرات الفترة دي: اللي المندوب حصّله من
                        العميل ناقص تكلفة الشحن.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {courierMissing ? (
                        <p className="text-sm text-muted-foreground">
                            شغّل supabase/migrations/20260830_courier_net_due.sql عشان القسم ده يشتغل.
                        </p>
                    ) : courier.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-6 text-center">
                            مفيش أوردرات متسلّمة أو مرتجعة في الفترة دي.
                        </p>
                    ) : (() => {
                        const sum = (k: string) => courier.reduce((a, r) => a + Number(r[k] || 0), 0);
                        const net = sum("net_due"), uns = sum("unsettled_net");
                        return (
                            <div className="space-y-5">
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <div className="rounded-xl border p-4">
                                        <p className="text-xs text-muted-foreground">حصّلوه من العملاء</p>
                                        <p className="text-2xl font-bold tabular-nums mt-1">{formatCurrency(sum("collected_total"))}</p>
                                    </div>
                                    <div className="rounded-xl border p-4">
                                        <p className="text-xs text-muted-foreground">تكلفة الشحن</p>
                                        <p className="text-2xl font-bold tabular-nums mt-1 text-muted-foreground">
                                            − {formatCurrency(sum("shipping_total"))}
                                        </p>
                                    </div>
                                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                                        <p className="text-xs text-muted-foreground">الصافي المستحق</p>
                                        <p className="text-2xl font-black tabular-nums mt-1 text-emerald-600">{formatCurrency(net)}</p>
                                        {uns > 0 && uns !== net && (
                                            <p className="text-xs text-amber-600 mt-1">
                                                لسه متحصّلش منه {formatCurrency(uns)}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="rounded-lg border overflow-x-auto">
                                    <table className="w-full text-sm min-w-[620px]">
                                        <thead className="bg-muted/50">
                                            <tr>
                                                <th className="text-start p-2.5 font-medium text-xs">شركة الشحن</th>
                                                <th className="text-end p-2.5 font-medium text-xs">متسلّم</th>
                                                <th className="text-end p-2.5 font-medium text-xs">مرتجع</th>
                                                <th className="text-end p-2.5 font-medium text-xs">حصّلوه</th>
                                                <th className="text-end p-2.5 font-medium text-xs">شحن</th>
                                                <th className="text-end p-2.5 font-medium text-xs">الصافي</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {courier.map(c => (
                                                <tr key={c.shipping_company_id} className="border-t">
                                                    <td className="p-2.5 font-medium">{c.company_name || "غير محددة"}</td>
                                                    <td className="p-2.5 text-end tabular-nums">{Number(c.delivered_count).toLocaleString()}</td>
                                                    <td className="p-2.5 text-end tabular-nums text-muted-foreground">{Number(c.returned_count).toLocaleString()}</td>
                                                    <td className="p-2.5 text-end tabular-nums">{formatCurrency(Number(c.collected_total))}</td>
                                                    <td className="p-2.5 text-end tabular-nums text-muted-foreground">{formatCurrency(Number(c.shipping_total))}</td>
                                                    <td className="p-2.5 text-end tabular-nums font-semibold text-emerald-600">{formatCurrency(Number(c.net_due))}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {courier.some(c => Number(c.returned_count) > 0) && (
                                    <p className="text-xs text-muted-foreground">
                                        المرتجعات داخلة في الحساب برسوم الإرجاع بتاعتها. رسوم الإرجاع
                                        ونسبة التحصيل لسه صفر لكل الشركات في الإعدادات — لما تدخلهم،
                                        الصافي هينزل بقيمتهم وهيبقى أدق.
                                    </p>
                                )}
                            </div>
                        );
                    })()}
                </CardContent>
            </Card>

            {/* Deposits: what the orders say versus what the treasury holds.
                These two should be the same number. Where they are not, money
                was taken from a customer and never booked. */}
            <Card className={recon && Number(recon.unmatched_value) > 0 ? "border-amber-500/40" : undefined}>
                <CardHeader>
                    <CardTitle>مطابقة العرابين</CardTitle>
                    <CardDescription>
                        العربون المكتوب على الأوردر لازم يكون موجود في الخزينة بنفس القيمة.
                        أي فرق معناه إن فلوس اتاخدت من عميل ومدخلتش الحسابات. المطابقة بتحسب
                        العرابين بتلات تصنيفاتها: Deposits و Deposit و orders_collection
                        (عرابين أوردرات المنصة).
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {reconMissing ? (
                        <p className="text-sm text-muted-foreground">
                            شغّل supabase/migrations/20260827_deposit_reconciliation.sql عشان القسم ده يشتغل.
                        </p>
                    ) : !recon || Number(recon.orders_with_deposit) === 0 ? (
                        <p className="text-sm text-muted-foreground py-6 text-center">
                            مفيش أوردرات فيها عربون في الفترة دي.
                        </p>
                    ) : (
                        <div className="space-y-5">
                            <div className="grid gap-4 sm:grid-cols-3">
                                <div className="rounded-xl border p-4">
                                    <p className="text-xs text-muted-foreground">عرابين مكتوبة على الأوردرات</p>
                                    <p className="text-2xl font-bold tabular-nums mt-1">
                                        {formatCurrency(Number(recon.orders_deposit_value))}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {Number(recon.orders_with_deposit).toLocaleString()} أوردر
                                    </p>
                                </div>
                                <div className="rounded-xl border p-4">
                                    <p className="text-xs text-muted-foreground">مسجّلة في الخزينة</p>
                                    <p className="text-2xl font-bold tabular-nums mt-1 text-emerald-600">
                                        {formatCurrency(Number(recon.txn_value))}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {Number(recon.txn_count).toLocaleString()} ترانزاكشن
                                    </p>
                                </div>
                                <div className={`rounded-xl border p-4 ${Number(recon.unmatched_value) > 0 ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
                                    <p className="text-xs text-muted-foreground">ناقص من الحسابات</p>
                                    <p className={`text-2xl font-bold tabular-nums mt-1 ${Number(recon.unmatched_value) > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                                        {formatCurrency(Number(recon.unmatched_value))}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {Number(recon.unmatched_orders).toLocaleString()} أوردر
                                    </p>
                                </div>
                            </div>

                            {(() => {
                                const diff = Number(recon.txn_value) - Number(recon.orders_deposit_value);
                                const REASONS: Record<string, { label: string; hint: string; tone: string }> = {
                                    short: { label: "ناقصة من الخزينة", tone: "text-amber-600",
                                             hint: "عربون مكتوب على الأوردر ومش موجود في الحسابات — ده اللي محتاج تدقيق" },
                                    over: { label: "مسجّل أكتر من العربون", tone: "text-amber-600",
                                            hint: "الخزينة فيها أكتر من اللي مكتوب على الأوردر — غالباً دفعة تانية اتسجلت والأوردر مااتحدّثش" },
                                    carried_in: { label: "عرابين لأوردرات من فترة قبل دي", tone: "text-muted-foreground",
                                                  hint: "الفلوس دخلت في الفترة دي بس الأوردر اتعمل قبلها — ده طبيعي على حدود الشهر" },
                                    orphan: { label: "مش مربوطة بأي أوردر", tone: "text-muted-foreground",
                                              hint: "ترانزاكشن في الخزينة مش معروف تخص أنهي أوردر" },
                                };
                                const groups = ["short", "over", "carried_in", "orphan"].map(k => {
                                    const rows = discrepancies.filter(d => d.reason === k);
                                    return { k, rows, total: rows.reduce((a, r) => a + Number(r.delta || 0), 0) };
                                }).filter(g => g.rows.length > 0);

                                if (groups.length === 0) {
                                    return (
                                        <p className="text-sm font-medium text-emerald-600">
                                            كل العرابين في الفترة دي مطابقة للخزينة بالظبط.
                                        </p>
                                    );
                                }

                                return (
                                    <div className="space-y-4">
                                        <div className="rounded-lg border bg-muted/20 p-4">
                                            <p className="text-sm font-semibold mb-2">
                                                الفرق {formatCurrency(Math.abs(diff))}{" "}
                                                {diff > 0 ? "لصالح الخزينة" : "لصالح الأوردرات"} — سببه:
                                            </p>
                                            <ul className="space-y-1.5 text-sm">
                                                {groups.map(g => (
                                                    <li key={g.k} className="flex flex-wrap items-baseline gap-x-2">
                                                        <span className={`font-semibold ${REASONS[g.k].tone}`}>
                                                            {formatCurrency(g.total)}
                                                        </span>
                                                        <span>— {REASONS[g.k].label}</span>
                                                        <span className="text-muted-foreground text-xs">
                                                            ({g.rows.length} حالة · {REASONS[g.k].hint})
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>

                                        <Button variant="outline" size="sm" onClick={() => setShowUnbooked(v => !v)}>
                                            {showUnbooked ? "اخفي التفاصيل" : `شوف الـ${discrepancies.length} حالة`}
                                        </Button>

                                        {showUnbooked && (
                                            <div className="rounded-lg border overflow-x-auto max-h-96 overflow-y-auto">
                                                <table className="w-full text-sm min-w-[640px]">
                                                    <thead className="bg-muted/50 sticky top-0">
                                                        <tr>
                                                            <th className="text-start p-2.5 font-medium text-xs">السبب</th>
                                                            <th className="text-start p-2.5 font-medium text-xs">الأوردر</th>
                                                            <th className="text-start p-2.5 font-medium text-xs">العميل</th>
                                                            <th className="text-start p-2.5 font-medium text-xs">تاريخ الأوردر</th>
                                                            <th className="text-end p-2.5 font-medium text-xs">على الأوردر</th>
                                                            <th className="text-end p-2.5 font-medium text-xs">في الخزينة</th>
                                                            <th className="text-end p-2.5 font-medium text-xs">الفرق</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {discrepancies.map((d, i) => (
                                                            <tr key={`${d.order_id || "x"}-${d.reason}-${i}`} className="border-t">
                                                                <td className={`p-2.5 text-xs font-medium ${REASONS[d.reason]?.tone || ""}`}>
                                                                    {REASONS[d.reason]?.label || d.reason}
                                                                </td>
                                                                <td className="p-2.5 font-mono text-xs">
                                                                    {d.order_id ? `#${d.reference}` : d.reference}
                                                                </td>
                                                                <td className="p-2.5">{d.customer_name || "—"}</td>
                                                                <td className="p-2.5 text-xs text-muted-foreground">
                                                                    {d.order_date ? String(d.order_date).slice(0, 10) : "—"}
                                                                </td>
                                                                <td className="p-2.5 text-end tabular-nums">
                                                                    {Number(d.order_amount) > 0 ? formatCurrency(Number(d.order_amount)) : "—"}
                                                                </td>
                                                                <td className="p-2.5 text-end tabular-nums text-muted-foreground">
                                                                    {formatCurrency(Number(d.booked_amount))}
                                                                </td>
                                                                <td className="p-2.5 text-end tabular-nums font-semibold">
                                                                    {formatCurrency(Number(d.delta))}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* The 'over' line above says the treasury holds more than the
                orders claim. This says why: nearly always the same deposit
                booked twice, which is money the treasury shows and never
                actually received. */}
            <Card>
                <CardHeader>
                    <CardTitle>عرابين متكررة أو زيادة</CardTitle>
                    <CardDescription>
                        الأوردرات اللي الخزينة مسجّل عليها أكتر من العربون المكتوب عليها.
                        أكتر حالة بتحصل إن أوردر الموقع بيتسجل عربونه مرتين: مرة من شاشة
                        أوردرات الموقع بالـEasyOrders id، ومرة من الأوردر نفسه بالرقم بتاع
                        السيستم — فالاتنين مش شبه بعض في صفحة الحسابات ومحدش بياخد باله.
                        الأوردر اللي عربونه اتقسّم على دفعتين ومجموعهم مطابق مش هيظهر هنا.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {dupesMissing ? (
                        <p className="text-sm text-muted-foreground">
                            شغّل مايجريشن <code className="text-xs">20260901_duplicate_deposits.sql</code> عشان القسم ده يشتغل.
                        </p>
                    ) : dupes.length === 0 ? (
                        <p className="text-sm font-medium text-emerald-600">
                            مفيش أي عربون مسجّل زيادة في الفترة دي — الخزينة مطابقة للأوردرات.
                        </p>
                    ) : (() => {
                        // Three different mistakes with three different fixes.
                        // Only the first is money that never arrived; netting
                        // them into one figure would bury that.
                        const KINDS: Record<string, { label: string; note: string; tone: string }> = {
                            two_screens: {
                                label: "اتسجل من شاشتين مختلفتين",
                                note: "مرة من أوردرات الموقع بالـEasyOrders id ومرة من الأوردر نفسه — نفس الفلوس",
                                tone: "text-destructive",
                            },
                            repeated: {
                                label: "نفس المبلغ اتسجل أكتر من مرة",
                                note: "نفس الشاشة، الزرار اتضغط تاني — فلوس مدخلتش",
                                tone: "text-destructive",
                            },
                            extra: {
                                label: "دفعة تانية والأوردر مااتحدّثش",
                                note: "الفلوس وصلت بس الأوردر لسه مكتوب عليه القديم",
                                tone: "text-amber-600",
                            },
                            overstated: {
                                label: "ترانزاكشن أعلى من العربون المكتوب",
                                note: "رقم اتكتب غلط، أو الأوردر اتعدّل بعد التسجيل",
                                tone: "text-amber-600",
                            },
                        };
                        const sum = (rows: any[]) => rows.reduce((a, r) => a + Number(r.excess || 0), 0);
                        const groups = ["two_screens", "repeated", "extra", "overstated"]
                            .map(k => ({ k, rows: dupes.filter(d => d.kind === k) }))
                            .filter(g => g.rows.length > 0);

                        return (
                            <div className="space-y-4">
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                    {groups.map(g => (
                                        <div key={g.k} className="rounded-lg border bg-muted/20 p-4">
                                            <p className="text-xs text-muted-foreground mb-1">
                                                {KINDS[g.k].label}
                                            </p>
                                            <p className={`text-2xl font-bold tabular-nums ${KINDS[g.k].tone}`}>
                                                {formatCurrency(sum(g.rows))}
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {g.rows.length} أوردر — {KINDS[g.k].note}
                                            </p>
                                        </div>
                                    ))}
                                </div>

                                <Button variant="outline" size="sm" onClick={() => setShowDupes(v => !v)}>
                                    {showDupes ? "اخفي التفاصيل" : `شوف الـ${dupes.length} أوردر`}
                                </Button>

                                {showDupes && (
                                    <div className="rounded-lg border overflow-x-auto max-h-[28rem] overflow-y-auto">
                                        <table className="w-full text-sm min-w-[720px]">
                                            <thead className="bg-muted/50 sticky top-0">
                                                <tr>
                                                    <th className="w-8 p-2.5"></th>
                                                    <th className="text-start p-2.5 font-medium text-xs">الأوردر</th>
                                                    <th className="text-start p-2.5 font-medium text-xs">العميل</th>
                                                    <th className="text-start p-2.5 font-medium text-xs">السبب</th>
                                                    <th className="text-end p-2.5 font-medium text-xs">مرات التسجيل</th>
                                                    <th className="text-end p-2.5 font-medium text-xs">على الأوردر</th>
                                                    <th className="text-end p-2.5 font-medium text-xs">في الخزينة</th>
                                                    <th className="text-end p-2.5 font-medium text-xs">الزيادة</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {dupes.map(d => {
                                                    const open = openDupe === d.order_id;
                                                    return (
                                                        <Fragment key={d.order_id}>
                                                            <tr
                                                                className="border-t cursor-pointer hover:bg-muted/30"
                                                                onClick={() => setOpenDupe(open ? null : d.order_id)}
                                                            >
                                                                <td className="p-2.5 text-muted-foreground text-xs">
                                                                    {open ? "▾" : "▸"}
                                                                </td>
                                                                <td className="p-2.5 font-mono text-xs font-semibold">
                                                                    #{d.reference}
                                                                    {d.easyorders_id && (
                                                                        <span className="block font-normal text-[10px] text-muted-foreground">
                                                                            EO {String(d.easyorders_id).slice(0, 8)}
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className="p-2.5">
                                                                    {d.customer_name || "—"}
                                                                    {d.order_status && (
                                                                        <span className="block text-xs text-muted-foreground">
                                                                            {d.order_status}
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className={`p-2.5 text-xs font-medium ${KINDS[d.kind]?.tone || ""}`}>
                                                                    {KINDS[d.kind]?.label || d.kind}
                                                                </td>
                                                                <td className="p-2.5 text-end tabular-nums">
                                                                    <span className={d.kind === "repeated" ? "font-semibold text-destructive" : ""}>
                                                                        {d.txn_count}
                                                                    </span>
                                                                </td>
                                                                <td className="p-2.5 text-end tabular-nums">
                                                                    {formatCurrency(Number(d.paid_amount))}
                                                                </td>
                                                                <td className="p-2.5 text-end tabular-nums text-muted-foreground">
                                                                    {formatCurrency(Number(d.booked_total))}
                                                                </td>
                                                                <td className="p-2.5 text-end tabular-nums font-semibold text-destructive">
                                                                    {formatCurrency(Number(d.excess))}
                                                                </td>
                                                            </tr>
                                                            {open && (
                                                                <tr className="border-t bg-muted/20">
                                                                    <td></td>
                                                                    <td colSpan={7} className="p-3">
                                                                        <p className="text-xs text-muted-foreground mb-2">
                                                                            كل الترانزاكشنز المسجّلة على الأوردر ده:
                                                                        </p>
                                                                        <div className="space-y-1.5">
                                                                            {(d.txns || []).map((x: any) => (
                                                                                <div key={x.id} className="flex flex-wrap items-baseline gap-x-3 text-xs">
                                                                                    <span className="tabular-nums text-muted-foreground w-20">
                                                                                        {String(x.date).slice(0, 10)}
                                                                                    </span>
                                                                                    <span className="tabular-nums font-semibold w-24">
                                                                                        {formatCurrency(Number(x.amount))}
                                                                                    </span>
                                                                                    {/* The category is what tells you which screen
                                                                                        wrote it: orders_collection is Platform
                                                                                        Orders, Deposits is the order screen. */}
                                                                                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted">
                                                                                        {x.category || "—"}
                                                                                    </span>
                                                                                    <span className="text-muted-foreground">{x.account || "—"}</span>
                                                                                    <span className="text-muted-foreground">·</span>
                                                                                    <span className="text-muted-foreground tabular-nums">
                                                                                        {String(x.created_at).slice(11, 16)}
                                                                                    </span>
                                                                                    <span className="text-muted-foreground/70 truncate max-w-[22rem]">
                                                                                        {x.description || "—"}
                                                                                    </span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                        <p className="text-xs text-muted-foreground mt-2">
                                                                            في صفحة الحسابات ابحث عن{" "}
                                                                            <code className="font-mono">{d.reference}</code>
                                                                            {d.easyorders_id && (
                                                                                <>
                                                                                    {" "}أو{" "}
                                                                                    <code className="font-mono">{d.easyorders_id}</code>
                                                                                    {" "}— ده الرقم المكتوب في وصف الترانزاكشن الجاية من الموقع
                                                                                </>
                                                                            )}
                                                                            {" "}عشان تمسح المكرر.
                                                                        </p>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </Fragment>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </CardContent>
            </Card>

            {/* Collection status of the orders placed in this period.
                The cards above count money that arrived; this counts what was
                sold and whether it has been paid for. */}
            <Card>
                <CardHeader>
                    <CardTitle>حالة تحصيل الأوردرات</CardTitle>
                    <CardDescription>
                        الأوردرات اللي اتعملت في الفترة دي، ومدفوع منها كام. الأوردرات الملغية
                        مستبعدة — أوردر ماخرجش مش دين.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {paymentMissing ? (
                        <p className="text-sm text-muted-foreground">
                            شغّل supabase/migrations/20260826_payment_status_breakdown.sql عشان القسم ده يشتغل.
                        </p>
                    ) : payment.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-6 text-center">
                            مفيش أوردرات في الفترة دي.
                        </p>
                    ) : (
                        <div className="space-y-5">
                            <div className="grid gap-4 sm:grid-cols-3">
                                {paySorted.map(r => {
                                    const st = PAY_STYLE[r.payment_status] || PAY_STYLE["Not Paid"];
                                    const pct = payTotals.orders
                                        ? (Number(r.orders_count) / payTotals.orders) * 100 : 0;
                                    return (
                                        <div key={r.payment_status} className="rounded-xl border p-4 space-y-1">
                                            <div className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded ${st.bg}`}>
                                                {st.label}
                                            </div>
                                            <div className="text-3xl font-bold tabular-nums">
                                                {Number(r.orders_count).toLocaleString()}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                {pct.toFixed(1)}% من الأوردرات · {formatCurrency(Number(r.total_value))}
                                            </div>
                                            {Number(r.outstanding) > 0 && (
                                                <div className="text-xs font-medium text-amber-700 dark:text-amber-400 pt-1">
                                                    متبقي {formatCurrency(Number(r.outstanding))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* One bar rather than a pie: three shares read faster
                                side by side than as wedges, and the widths are
                                directly comparable. */}
                            <div className="space-y-2">
                                <div className="flex h-4 w-full overflow-hidden rounded-full border">
                                    {paySorted.map(r => {
                                        const st = PAY_STYLE[r.payment_status] || PAY_STYLE["Not Paid"];
                                        const pct = payTotals.orders
                                            ? (Number(r.orders_count) / payTotals.orders) * 100 : 0;
                                        return pct > 0 ? (
                                            <div key={r.payment_status} style={{ width: `${pct}%`, background: st.colour }}
                                                 title={`${st.label}: ${Number(r.orders_count)}`} />
                                        ) : null;
                                    })}
                                </div>
                                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                                    {paySorted.map(r => {
                                        const st = PAY_STYLE[r.payment_status] || PAY_STYLE["Not Paid"];
                                        return (
                                            <span key={r.payment_status} className="inline-flex items-center gap-1.5">
                                                <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.colour }} />
                                                {st.label}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-3 border-t pt-4">
                                <div>
                                    <p className="text-xs text-muted-foreground">قيمة الأوردرات</p>
                                    <p className="text-lg font-bold">{formatCurrency(payTotals.value)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">اتحصّل منها</p>
                                    <p className="text-lg font-bold text-emerald-600">{formatCurrency(payTotals.paid)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">لسه متحصّلش</p>
                                    <p className="text-lg font-bold text-amber-600">{formatCurrency(payTotals.outstanding)}</p>
                                </div>
                            </div>

                            <p className="text-xs text-muted-foreground">
                                أغلب أوردراتك دفع عند الاستلام، فـ«غير مدفوع» هنا طبيعي — الفلوس بتتحصّل
                                مع التسليم. الرقم اللي يستاهل المتابعة هو «مدفوع جزئياً»: دول عملاء دفعوا
                                عربون وباقي عليهم فلوس.
                            </p>
                        </div>
                    )}
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
