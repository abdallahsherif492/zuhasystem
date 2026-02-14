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
        try {
            const start = fromDate ? `${fromDate}T00:00:00` : new Date().toISOString();
            const end = toDate ? `${toDate}T23:59:59` : new Date().toISOString();

            const { data: rpcData, error } = await supabase.rpc('get_products_analysis_metrics', {
                from_date: start,
                to_date: end
            });

            if (error) throw error;
            setData(rpcData || []);
        } catch (error) {
            console.error("Error fetching product analysis:", error);
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
