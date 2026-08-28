"use client";

import { useEffect, useState } from "react";
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
                const [recRes, unbRes] = await Promise.all([
                    supabase.rpc("get_deposit_reconciliation", args),
                    supabase.rpc("get_unbooked_deposits", args),
                ]);
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

                            {Number(recon.orphan_txn_count) > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    وكمان {Number(recon.orphan_txn_count)} ترانزاكشن بقيمة{" "}
                                    {formatCurrency(Number(recon.orphan_txn_value))} مش مربوطة بأي أوردر —
                                    دي غالباً عرابين قديمة اتسجلت قبل ما الربط يبقى موجود.
                                </p>
                            )}

                            {Number(recon.unmatched_orders) > 0 ? (
                                <>
                                    <Button variant="outline" size="sm"
                                            onClick={() => setShowUnbooked(v => !v)}>
                                        {showUnbooked ? "اخفي الأوردرات الناقصة" : `شوف الـ${Number(recon.unmatched_orders)} أوردر`}
                                    </Button>

                                    {showUnbooked && (
                                        <div className="rounded-lg border overflow-x-auto max-h-96 overflow-y-auto">
                                            <table className="w-full text-sm min-w-[560px]">
                                                <thead className="bg-muted/50 sticky top-0">
                                                    <tr>
                                                        <th className="text-start p-2.5 font-medium text-xs">الأوردر</th>
                                                        <th className="text-start p-2.5 font-medium text-xs">العميل</th>
                                                        <th className="text-start p-2.5 font-medium text-xs">التاريخ</th>
                                                        <th className="text-end p-2.5 font-medium text-xs">العربون</th>
                                                        <th className="text-end p-2.5 font-medium text-xs">مسجّل</th>
                                                        <th className="text-end p-2.5 font-medium text-xs">ناقص</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {unbooked.map(u => (
                                                        <tr key={u.order_id} className="border-t">
                                                            <td className="p-2.5 font-mono text-xs">#{u.reference}</td>
                                                            <td className="p-2.5">{u.customer_name || "—"}</td>
                                                            <td className="p-2.5 text-xs text-muted-foreground">
                                                                {String(u.created_at).slice(0, 10)}
                                                            </td>
                                                            <td className="p-2.5 text-end tabular-nums">{formatCurrency(Number(u.paid_amount))}</td>
                                                            <td className="p-2.5 text-end tabular-nums text-muted-foreground">{formatCurrency(Number(u.booked_amount))}</td>
                                                            <td className="p-2.5 text-end tabular-nums font-semibold text-amber-600">
                                                                {formatCurrency(Number(u.missing_amount))}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <p className="text-sm font-medium text-emerald-600">
                                    كل العرابين في الفترة دي مسجّلة في الخزينة.
                                </p>
                            )}
                        </div>
                    )}
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
