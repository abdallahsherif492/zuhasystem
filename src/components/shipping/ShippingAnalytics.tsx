"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DateRangePicker } from "@/components/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { Loader2, ArrowRight } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { format, startOfMonth } from "date-fns";
import { Button } from "@/components/ui/button";

type CompanyMetrics = {
    id: string;
    name: string;
    total_orders: number;
    shipped_count: number;
    delivered_count: number;
    returned_count: number;
    total_value: number; // Net value (Total - Shipping)
    shipped_value: number; // Net value of ONLY Shipped orders
};

export function ShippingAnalytics() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    const [loading, setLoading] = useState(true);
    const [metrics, setMetrics] = useState<CompanyMetrics[]>([]);

    useEffect(() => {
        if (!fromDate || !toDate) {
            const start = format(startOfMonth(new Date()), "yyyy-MM-dd");
            const end = format(new Date(), "yyyy-MM-dd");
            // Check if we are already in the browser to avoid hydration mismatch affecting URL
            // Actually simpler to just rely on user picking dates or default
            // passing checks here
        }
        fetchData();
    }, [fromDate, toDate]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const start = fromDate ? `${fromDate}T00:00:00` : new Date().toISOString();
            const end = toDate ? `${toDate}T23:59:59` : new Date().toISOString();

            // 1. Fetch Companies
            const { data: companies, error: companiesError } = await supabase
                .from('shipping_companies')
                .select('id, name');

            if (companiesError) throw companiesError;

            // 2. Fetch Orders
            const { data: orders, error: ordersError } = await supabase
                .from('orders')
                .select('id, status, shipping_company_id, total_amount, shipping_cost')
                .gte('created_at', start)
                .lte('created_at', end)
                .not('shipping_company_id', 'is', null);

            if (ordersError) throw ordersError;

            // 3. Aggregate
            const map = new Map<string, CompanyMetrics>();

            // Initialize
            companies?.forEach(c => {
                map.set(c.id, {
                    id: c.id,
                    name: c.name,
                    total_orders: 0,
                    shipped_count: 0,
                    delivered_count: 0,
                    returned_count: 0,
                    total_value: 0,
                    shipped_value: 0
                });
            });

            // Process Orders
            orders?.forEach(order => {
                const companyId = order.shipping_company_id;
                if (map.has(companyId)) {
                    const m = map.get(companyId)!;
                    m.total_orders++;
                    const net = (order.total_amount || 0) - (order.shipping_cost || 0);

                    if (order.status === 'Shipped') {
                        m.shipped_count++;
                        m.shipped_value += net;
                    }
                    if (order.status === 'Delivered' || order.status === 'Collected') m.delivered_count++;
                    if (order.status === 'Returned') m.returned_count++;

                    // Value (Net)
                    m.total_value += net;
                }
            });

            const result = Array.from(map.values()).sort((a, b) => b.total_orders - a.total_orders);
            setMetrics(result);

        } catch (error) {
            console.error("Error fetching shipping analytics", error);
        } finally {
            setLoading(false);
        }
    };

    const getPercentage = (count: number, total: number) => {
        if (total === 0) return "0%";
        return `${Math.round((count / total) * 100)}%`;
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight">Analytics Report</h2>
                    <p className="text-muted-foreground text-sm">Performance metrics by shipping company.</p>
                </div>
                <DateRangePicker />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Company Performance</CardTitle>
                    <CardDescription>
                        Orders, delivery rates, and values excluding shipping costs.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Company</TableHead>
                                    <TableHead className="text-right">Total Orders</TableHead>
                                    <TableHead className="text-right">Shipped</TableHead>
                                    <TableHead className="text-right">Net Value (Shipped)</TableHead>
                                    <TableHead className="text-right">Delivered / Collected</TableHead>
                                    <TableHead className="text-right">Returned</TableHead>
                                    <TableHead className="text-right">Net Value (Total)</TableHead>
                                    <TableHead></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {metrics.map(m => (
                                    <TableRow key={m.id} className="group cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/shipping/${m.id}?from=${fromDate || ''}&to=${toDate || ''}`)}>
                                        <TableCell className="font-medium">{m.name}</TableCell>
                                        <TableCell className="text-right">{m.total_orders}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex flex-col items-end">
                                                <span>{m.shipped_count}</span>
                                                <span className="text-xs text-muted-foreground">{getPercentage(m.shipped_count, m.total_orders)}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-blue-600">
                                            {formatCurrency(m.shipped_value)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex flex-col items-end">
                                                <span className="text-green-600 font-medium">{m.delivered_count}</span>
                                                <span className="text-xs text-muted-foreground">{getPercentage(m.delivered_count, m.total_orders)}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex flex-col items-end">
                                                <span className="text-red-500">{m.returned_count}</span>
                                                <span className="text-xs text-muted-foreground">{getPercentage(m.returned_count, m.total_orders)}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {formatCurrency(m.total_value)}
                                        </TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100">
                                                <ArrowRight className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {metrics.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                                            No data found for this period.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
