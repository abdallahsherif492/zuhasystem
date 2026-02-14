"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/date-range-picker";
import { Loader2, ArrowUpDown, Search } from "lucide-react";
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
    total_sales: number;
    total_units: number;
    delivered_count: number;
    delivery_rate: number;
}

function ProductAnalysisContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<ProductMetric[]>([]);
    const [filteredData, setFilteredData] = useState<ProductMetric[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [sortConfig, setSortConfig] = useState<{ key: keyof ProductMetric; direction: 'asc' | 'desc' } | null>({ key: 'total_sales', direction: 'desc' });

    useEffect(() => {
        if (!fromDate || !toDate) {
            const start = format(startOfMonth(new Date()), "yyyy-MM-dd");
            const end = format(new Date(), "yyyy-MM-dd");
            router.replace(`?from=${start}&to=${end}`);
            return;
        }
        fetchData();
    }, [fromDate, toDate]);

    useEffect(() => {
        let result = [...data];
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(item => item.product_name.toLowerCase().includes(q));
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

            // 1. Fetch all products
            const { data: productsData, error: productsError } = await supabase
                .from('products')
                .select('id, name');

            if (productsError) throw productsError;

            // 2. Fetch orders with items and variants
            const { data: ordersData, error: ordersError } = await supabase
                .from('orders')
                .select(`
                    id, 
                    status, 
                    order_items (
                        quantity,
                        price_at_sale,
                        variants (
                            product_id
                        )
                    )
                `)
                .gte('created_at', start)
                .lte('created_at', end)
                .neq('status', 'Cancelled');

            if (ordersError) throw ordersError;

            // 3. Aggregate Metrics
            const metricsMap = new Map<string, ProductMetric>();

            // Initialize all products with 0
            productsData?.forEach(p => {
                metricsMap.set(p.id, {
                    product_id: p.id,
                    product_name: p.name,
                    total_orders: 0,
                    total_sales: 0,
                    total_units: 0,
                    delivered_count: 0,
                    delivery_rate: 0
                });
            });

            // Process orders
            ordersData?.forEach(order => {
                const isDelivered = order.status === 'Delivered' || order.status === 'Collected';

                // Track unique products in this order to increment total_orders correctly (1 order can have multiple items of same product?)
                // Usually "Total Orders" means count of orders containing this product.
                const productsInOrder = new Set<string>();

                order.order_items.forEach((item: any) => {
                    const productId = item.variants?.product_id;
                    if (productId && metricsMap.has(productId)) {
                        const metric = metricsMap.get(productId)!;

                        // Update Sales & Units
                        metric.total_sales += Number(item.price_at_sale) * item.quantity;
                        metric.total_units += item.quantity;

                        productsInOrder.add(productId);
                    }
                });

                // Update Order Counts
                productsInOrder.forEach(productId => {
                    const metric = metricsMap.get(productId)!;
                    metric.total_orders += 1;
                    if (isDelivered) {
                        metric.delivered_count += 1;
                    }
                });
            });

            // Calculate Rates & Finalize
            const result: ProductMetric[] = Array.from(metricsMap.values()).map(m => ({
                ...m,
                delivery_rate: m.total_orders > 0
                    ? Math.round((m.delivered_count / m.total_orders) * 100 * 100) / 100
                    : 0
            }));

            // Sort by default (Total Sales DESC)
            result.sort((a, b) => b.total_sales - a.total_sales);

            setData(result);
        } catch (err: any) {
            console.error("Error fetching analysis:", err);
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

    return (
        <div className="space-y-8 p-8 pt-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Product Analysis</h1>
                    <p className="text-muted-foreground">Performance metrics by product</p>
                </div>
                <DateRangePicker />
            </div>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>Products Performance</CardTitle>
                        <div className="relative w-64">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search products..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-8"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="min-w-[200px]">
                                            <Button variant="ghost" onClick={() => handleSort('product_name')}>
                                                Product Name <ArrowUpDown className="ml-2 h-4 w-4" />
                                            </Button>
                                        </TableHead>
                                        <TableHead className="text-right">
                                            <Button variant="ghost" onClick={() => handleSort('total_orders')}>
                                                Total Orders <ArrowUpDown className="ml-2 h-4 w-4" />
                                            </Button>
                                        </TableHead>
                                        <TableHead className="text-right">
                                            <Button variant="ghost" onClick={() => handleSort('total_sales')}>
                                                Total Sales <ArrowUpDown className="ml-2 h-4 w-4" />
                                            </Button>
                                        </TableHead>
                                        <TableHead className="text-right">
                                            <Button variant="ghost" onClick={() => handleSort('total_units')}>
                                                Units Sold <ArrowUpDown className="ml-2 h-4 w-4" />
                                            </Button>
                                        </TableHead>
                                        <TableHead className="text-right">
                                            <Button variant="ghost" onClick={() => handleSort('delivery_rate')}>
                                                Delivery Rate <ArrowUpDown className="ml-2 h-4 w-4" />
                                            </Button>
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredData.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center h-24">
                                                No products found for this period.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredData.map((item) => (
                                            <TableRow key={item.product_id}>
                                                <TableCell className="font-medium">{item.product_name}</TableCell>
                                                <TableCell className="text-right">{item.total_orders}</TableCell>
                                                <TableCell className="text-right font-bold">{formatCurrency(item.total_sales)}</TableCell>
                                                <TableCell className="text-right">{item.total_units}</TableCell>
                                                <TableCell className="text-right">
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${item.delivery_rate >= 80 ? 'bg-green-100 text-green-800' :
                                                        item.delivery_rate >= 50 ? 'bg-yellow-100 text-yellow-800' :
                                                            'bg-red-100 text-red-800'
                                                        }`}>
                                                        {item.delivery_rate}%
                                                    </span>
                                                    <span className="text-xs text-muted-foreground ml-2">
                                                        ({item.delivered_count}/{item.total_orders})
                                                    </span>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export default function ProductAnalysisPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <ProductAnalysisContent />
        </Suspense>
    );
}
