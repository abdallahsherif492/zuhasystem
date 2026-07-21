"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/date-range-picker";
import { Loader2, ArrowUpDown, Search, PackageSearch, XCircle, CheckCircle2, Clock } from "lucide-react";
import { format, startOfMonth } from "date-fns";
import { Input } from "@/components/ui/input";
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

const CONFIRMED_STATUSES = ['Pending', 'Prepared', 'Processing', 'Delivered', 'Shipped', 'Collected'];

function EasyOrdersInsightsContent() {
    const { activeBusiness } = useBusiness();
    const { t } = useLanguage();
    const router = useRouter();
    const searchParams = useSearchParams();
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    // Summary Metrics
    const [totalEasyOrders, setTotalEasyOrders] = useState(0);
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
    }, [fromDate, toDate, activeBusiness]);

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

            // Fetch easyorders
            const { data: ordersData, error: ordersError } = await supabase
                .from('orders')
                .select(`
                    id, 
                    status,
                    easyorders_id,
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
                .lte('created_at', end);

            if (ordersError) throw ordersError;

            // Filter out only easy orders
            const easyOrders = ordersData?.filter(o => {
                const hasTag = o.tags && Array.isArray(o.tags) && o.tags.includes("easyorders");
                const hasId = !!o.easyorders_id;
                return hasTag || hasId;
            }) || [];

            setTotalEasyOrders(easyOrders.length);

            let confirmedCount = 0;
            let cancelledCount = 0;
            let waitingCount = 0;

            const metricsMap = new Map<string, ProductMetric>();

            easyOrders.forEach(order => {
                const isConfirmed = CONFIRMED_STATUSES.includes(order.status);
                const isCancelled = order.status === 'Cancelled';
                const isWaiting = order.status === 'Waiting';

                if (isConfirmed) confirmedCount++;
                if (isCancelled) cancelledCount++;
                if (isWaiting) waitingCount++;

                // Track unique products in this order
                const productsInOrder = new Map<string, string>(); // id -> name

                order.order_items.forEach((item: any) => {
                    const prodId = item.variants?.products?.id;
                    const prodName = item.variants?.products?.name;
                    if (prodId && prodName) {
                        productsInOrder.set(prodId, prodName);
                    }
                });

                productsInOrder.forEach((name, id) => {
                    if (!metricsMap.has(id)) {
                        metricsMap.set(id, {
                            product_id: id,
                            product_name: name,
                            total_orders: 0,
                            confirmed_orders: 0,
                            cancelled_orders: 0,
                            confirmed_rate: 0,
                            cancelled_rate: 0
                        });
                    }

                    const metric = metricsMap.get(id)!;
                    metric.total_orders += 1;
                    if (isConfirmed) metric.confirmed_orders += 1;
                    if (isCancelled) metric.cancelled_orders += 1;
                });
            });

            setConfirmedOrders(confirmedCount);
            setCancelledOrders(cancelledCount);
            setWaitingOrders(waitingCount);

            // Calculate Rates
            const result: ProductMetric[] = Array.from(metricsMap.values()).map(m => ({
                ...m,
                confirmed_rate: m.total_orders > 0 ? (m.confirmed_orders / m.total_orders) * 100 : 0,
                cancelled_rate: m.total_orders > 0 ? (m.cancelled_orders / m.total_orders) * 100 : 0
            }));

            // Sort by default (Total Orders DESC)
            result.sort((a, b) => b.total_orders - a.total_orders);

            setData(result);
        } catch (err: any) {
            console.error("Error fetching easyorders analysis:", err);
            setError(err.message || "Failed to load data");
        } finally {
            setLoading(false);
        }
    }

    const handleSort = (key: keyof ProductMetric) => {
        setSortConfig(current => ({
            key,
            direction: current?.key === key && current.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const confirmedPerc = totalEasyOrders > 0 ? ((confirmedOrders / totalEasyOrders) * 100).toFixed(1) : "0.0";
    const cancelledPerc = totalEasyOrders > 0 ? ((cancelledOrders / totalEasyOrders) * 100).toFixed(1) : "0.0";
    const waitingPerc = totalEasyOrders > 0 ? ((waitingOrders / totalEasyOrders) * 100).toFixed(1) : "0.0";

    return (
        <div className="space-y-8 p-8 pt-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t("EasyOrders Insights")}</h1>
                    <p className="text-muted-foreground">{t("Performance and confirmation rates for EasyOrders")}</p>
                </div>
                <DateRangePicker />
            </div>

            {loading ? (
                <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>
            ) : (
                <>
                    <div className="grid gap-4 md:grid-cols-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">{t("Total EasyOrders")}</CardTitle>
                                <PackageSearch className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{totalEasyOrders}</div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t("Total orders tagged with easyorders")}
                                </p>
                            </CardContent>
                        </Card>
                        
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium text-emerald-600">{t("Confirmed Orders")}</CardTitle>
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-emerald-600">{confirmedOrders}</div>
                                <p className="text-xs font-medium text-emerald-600/80 mt-1">
                                    {confirmedPerc}% {t("of total")}
                                </p>
                            </CardContent>
                        </Card>
                        
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium text-destructive">{t("Cancelled Orders")}</CardTitle>
                                <XCircle className="h-4 w-4 text-destructive" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-destructive">{cancelledOrders}</div>
                                <p className="text-xs font-medium text-destructive/80 mt-1">
                                    {cancelledPerc}% {t("of total")}
                                </p>
                            </CardContent>
                        </Card>
                        
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium text-amber-600">{t("Waiting Orders")}</CardTitle>
                                <Clock className="h-4 w-4 text-amber-600" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-amber-600">{waitingOrders}</div>
                                <p className="text-xs font-medium text-amber-600/80 mt-1">
                                    {waitingPerc}% {t("of total")}
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle>{t("Product Performance in EasyOrders")}</CardTitle>
                                <div className="relative w-64">
                                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder={t("Search products...")}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="pl-8"
                                    />
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="min-w-[200px]">
                                                <Button variant="ghost" onClick={() => handleSort('product_name')}>
                                                    {t("Product Name")} <ArrowUpDown className="ml-2 h-4 w-4" />
                                                </Button>
                                            </TableHead>
                                            <TableHead className="text-right">
                                                <Button variant="ghost" onClick={() => handleSort('total_orders')}>
                                                    {t("Total Orders")} <ArrowUpDown className="ml-2 h-4 w-4" />
                                                </Button>
                                            </TableHead>
                                            <TableHead className="text-right">
                                                <Button variant="ghost" onClick={() => handleSort('confirmed_orders')}>
                                                    {t("Confirmed Orders")} <ArrowUpDown className="ml-2 h-4 w-4" />
                                                </Button>
                                            </TableHead>
                                            <TableHead className="text-right">
                                                <Button variant="ghost" onClick={() => handleSort('confirmed_rate')}>
                                                    {t("Confirmation Rate")} <ArrowUpDown className="ml-2 h-4 w-4" />
                                                </Button>
                                            </TableHead>
                                            <TableHead className="text-right">
                                                <Button variant="ghost" onClick={() => handleSort('cancelled_orders')}>
                                                    {t("Cancelled Orders")} <ArrowUpDown className="ml-2 h-4 w-4" />
                                                </Button>
                                            </TableHead>
                                            <TableHead className="text-right">
                                                <Button variant="ghost" onClick={() => handleSort('cancelled_rate')}>
                                                    {t("Cancellation Rate")} <ArrowUpDown className="ml-2 h-4 w-4" />
                                                </Button>
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredData.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                                                    {t("No products found for this period in EasyOrders.")}
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            filteredData.map((item) => (
                                                <TableRow key={item.product_id}>
                                                    <TableCell className="font-medium">{item.product_name}</TableCell>
                                                    <TableCell className="text-right">{item.total_orders}</TableCell>
                                                    <TableCell className="text-right text-emerald-600 font-medium">{item.confirmed_orders}</TableCell>
                                                    <TableCell className="text-right">
                                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                            item.confirmed_rate >= 80 ? 'bg-emerald-100 text-emerald-800' :
                                                            item.confirmed_rate >= 50 ? 'bg-yellow-100 text-yellow-800' :
                                                            'bg-red-100 text-red-800'
                                                        }`}>
                                                            {item.confirmed_rate.toFixed(1)}%
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right text-destructive font-medium">{item.cancelled_orders}</TableCell>
                                                    <TableCell className="text-right">
                                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                            item.cancelled_rate >= 50 ? 'bg-red-100 text-red-800' :
                                                            item.cancelled_rate >= 20 ? 'bg-yellow-100 text-yellow-800' :
                                                            'bg-emerald-100 text-emerald-800'
                                                        }`}>
                                                            {item.cancelled_rate.toFixed(1)}%
                                                        </span>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}

export default function EasyOrdersInsightsPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <EasyOrdersInsightsContent />
        </Suspense>
    );
}
