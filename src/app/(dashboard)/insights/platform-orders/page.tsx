"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase, fetchAll } from "@/lib/supabase";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/date-range-picker";
import { Loader2, ArrowUpDown, Search, PackageSearch, XCircle, CheckCircle2, Clock, Globe } from "lucide-react";
import { format, startOfMonth } from "date-fns";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

interface ProductMetric {
    product_id: string;
    product_name: string;
    total_orders: number;
    confirmed_orders: number;
    cancelled_orders: number;
    confirmed_rate: number;
    cancelled_rate: number;
}

function PlatformOrdersInsightsContent() {
    const { activeBusiness } = useBusiness();
    const { t } = useLanguage();
    const router = useRouter();
    const searchParams = useSearchParams();
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [platformFilter, setPlatformFilter] = useState<string>("all");
    
    // Summary Metrics
    const [totalPlatformOrders, setTotalPlatformOrders] = useState(0);
    const [confirmedOrders, setConfirmedOrders] = useState(0);
    const [cancelledOrders, setCancelledOrders] = useState(0);
    const [waitingOrders, setWaitingOrders] = useState(0);

    const [data, setData] = useState<ProductMetric[]>([]);
    const [filteredData, setFilteredData] = useState<ProductMetric[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [sortConfig, setSortConfig] = useState<{ key: keyof ProductMetric; direction: 'asc' | 'desc' } | null>({ key: 'total_orders', direction: 'desc' });

    useEffect(() => {
        if (!fromDate || !toDate) {
            const start = format(startOfMonth(new Date()), "yyyy-MM-dd");
            const end = format(new Date(), "yyyy-MM-dd");
            router.replace(`?from=${start}&to=${end}`);
            return;
        }
        if (activeBusiness) {
            fetchData();
        }
    }, [fromDate, toDate, activeBusiness, platformFilter]);

    useEffect(() => {
        let result = [...data];
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(item => 
                (item.product_name || "").toLowerCase().includes(q)
            );
        }

        if (sortConfig) {
            result.sort((a, b) => {
                if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
                if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        setFilteredData(result);
    }, [data, searchQuery, sortConfig]);

    async function fetchData() {
        setLoading(true);
        setError(null);
        try {
            const start = fromDate ? `${fromDate}T00:00:00` : new Date().toISOString();
            const end = toDate ? `${toDate}T23:59:59` : new Date().toISOString();

            const allOrdersData = await fetchAll((from, to) =>
                supabase
                    .from('orders')
                    .select(`
                        id, 
                        status,
                        easyorders_id,
                        channel,
                        tags,

                        order_items (
                            variants (
                                products (
                                    id,
                                    name
                                )
                            )
                        )
                    `)
                    .eq('business_id', activeBusiness!.id)
                    .gte('created_at', start)
                    .lte('created_at', end)
                    .range(from, to)
            );

            // Filter platform orders by tags & platform IDs
            const platformOrders = (allOrdersData || []).filter(o => {
                const isEasy = !!o.easyorders_id || (o.tags && Array.isArray(o.tags) && o.tags.includes("easyorders"));
                const isShopify = !!(o as any).shopify_id || (o.tags && Array.isArray(o.tags) && o.tags.includes("shopify"));


                if (platformFilter === "easyorders") return isEasy;
                if (platformFilter === "shopify") return isShopify;
                return isEasy || isShopify;
            });


            setTotalPlatformOrders(platformOrders.length);

            let confirmedCount = 0;
            let cancelledCount = 0;
            let waitingCount = 0;

            const metricsMap = new Map<string, ProductMetric>();

            platformOrders.forEach(order => {
                const isCancelled = order.status === 'Cancelled';
                const isWaiting = order.status === 'Waiting';
                const isConfirmed = !isCancelled && !isWaiting;

                if (isCancelled) cancelledCount++;
                else if (isWaiting) waitingCount++;
                else if (isConfirmed) confirmedCount++;

                // Collect products from order_items
                const seenProductsInOrder = new Set<string>();

                order.order_items?.forEach((item: any) => {
                    const product = item.variants?.products;
                    if (!product) return;

                    const pId = product.id;
                    const pName = product.name;

                    if (!metricsMap.has(pId)) {
                        metricsMap.set(pId, {
                            product_id: pId,
                            product_name: pName,
                            total_orders: 0,
                            confirmed_orders: 0,
                            cancelled_orders: 0,
                            confirmed_rate: 0,
                            cancelled_rate: 0
                        });
                    }

                    // Count each product once per order
                    if (!seenProductsInOrder.has(pId)) {
                        seenProductsInOrder.add(pId);
                        const metric = metricsMap.get(pId)!;
                        metric.total_orders += 1;
                        if (isConfirmed) metric.confirmed_orders += 1;
                        if (isCancelled) metric.cancelled_orders += 1;
                    }
                });
            });

            setConfirmedOrders(confirmedCount);
            setCancelledOrders(cancelledCount);
            setWaitingOrders(waitingCount);

            // Compute rates
            const metricsArray = Array.from(metricsMap.values()).map(m => ({
                ...m,
                confirmed_rate: m.total_orders > 0 ? (m.confirmed_orders / m.total_orders) * 100 : 0,
                cancelled_rate: m.total_orders > 0 ? (m.cancelled_orders / m.total_orders) * 100 : 0,
            }));

            setData(metricsArray);
        } catch (err: any) {
            console.error("Error fetching platform insights:", err);
            setError(err.message || "Failed to load platform insights");
        } finally {
            setLoading(false);
        }
    }

    const requestSort = (key: keyof ProductMetric) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const overallConfirmedRate = totalPlatformOrders > 0 ? (confirmedOrders / totalPlatformOrders) * 100 : 0;
    const overallCancelledRate = totalPlatformOrders > 0 ? (cancelledOrders / totalPlatformOrders) * 100 : 0;

    return (
        <div className="space-y-6 pb-10 font-sans">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border/50 pb-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Globe className="h-6 w-6 text-primary" />
                        Platform Orders Confirmation Insights (نسبة تأكيدات المنصات)
                    </h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        تحليل معدلات التأكيد والإلغاء للطلبات القادمة من منصات EasyOrders و Shopify.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <Select value={platformFilter} onValueChange={setPlatformFilter}>
                        <SelectTrigger className="w-[160px] h-9 text-xs">
                            <SelectValue placeholder="المنصة" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">جميع المنصات (All)</SelectItem>
                            <SelectItem value="easyorders">EasyOrders</SelectItem>
                            <SelectItem value="shopify">Shopify</SelectItem>
                        </SelectContent>
                    </Select>

                    <Suspense fallback={<div>Loading...</div>}>
                        <DateRangePicker />
                    </Suspense>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="shadow-sm border border-border/60">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">إجمالي طلبات المنصات</CardTitle>
                        <Globe className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalPlatformOrders}</div>
                        <p className="text-[11px] text-muted-foreground mt-1">المتزامنة خلال الفترة</p>
                    </CardContent>
                </Card>

                <Card className="shadow-sm border border-border/60">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">نسبة التأكيد الكلية</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-600">{overallConfirmedRate.toFixed(1)}%</div>
                        <p className="text-[11px] text-muted-foreground mt-1">{confirmedOrders} أوردر مؤكد</p>
                    </CardContent>
                </Card>

                <Card className="shadow-sm border border-border/60">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">في انتظار التأكيد</CardTitle>
                        <Clock className="h-4 w-4 text-amber-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-amber-600">{waitingOrders}</div>
                        <p className="text-[11px] text-muted-foreground mt-1">تتطلب المراجعة</p>
                    </CardContent>
                </Card>

                <Card className="shadow-sm border border-border/60">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">نسبة الإلغاء</CardTitle>
                        <XCircle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{overallCancelledRate.toFixed(1)}%</div>
                        <p className="text-[11px] text-muted-foreground mt-1">{cancelledOrders} أوردر ملغى</p>
                    </CardContent>
                </Card>
            </div>

            {/* Table Section */}
            <Card className="shadow-sm border border-border/60">
                <CardHeader className="p-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-base font-bold">تحليل التأكيد حسب المنتج</CardTitle>
                    <div className="relative w-64">
                        <Search className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="البحث باسم المنتج..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pr-8 h-8 text-xs rounded-xl"
                        />
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex items-center justify-center p-12 gap-2 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                            <span className="text-xs">جاري تحليل البيانات...</span>
                        </div>
                    ) : filteredData.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground text-xs">
                            لا توجد بيانات متاحة للمنتجات في هذه الفترة.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="text-right">اسم المنتج</TableHead>
                                    <TableHead className="text-center cursor-pointer" onClick={() => requestSort('total_orders')}>
                                        <span className="flex items-center justify-center gap-1">إجمالي الطلبات <ArrowUpDown className="h-3 w-3" /></span>
                                    </TableHead>
                                    <TableHead className="text-center cursor-pointer" onClick={() => requestSort('confirmed_orders')}>
                                        <span className="flex items-center justify-center gap-1">الطلبات المؤكدة <ArrowUpDown className="h-3 w-3" /></span>
                                    </TableHead>
                                    <TableHead className="text-center cursor-pointer" onClick={() => requestSort('confirmed_rate')}>
                                        <span className="flex items-center justify-center gap-1">نسبة التأكيد <ArrowUpDown className="h-3 w-3" /></span>
                                    </TableHead>
                                    <TableHead className="text-center cursor-pointer" onClick={() => requestSort('cancelled_orders')}>
                                        <span className="flex items-center justify-center gap-1">الطلبات الملغاة <ArrowUpDown className="h-3 w-3" /></span>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredData.map((row) => (
                                    <TableRow key={row.product_id}>
                                        <TableCell className="font-semibold text-xs text-right">{row.product_name}</TableCell>
                                        <TableCell className="text-center font-bold text-xs">{row.total_orders}</TableCell>
                                        <TableCell className="text-center text-xs text-emerald-600 font-bold">{row.confirmed_orders}</TableCell>
                                        <TableCell className="text-center font-bold text-xs text-emerald-600">
                                            {row.confirmed_rate.toFixed(1)}%
                                        </TableCell>
                                        <TableCell className="text-center text-xs text-red-600 font-bold">{row.cancelled_orders}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export default function PlatformOrdersInsightsPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>}>
            <PlatformOrdersInsightsContent />
        </Suspense>
    );
}
