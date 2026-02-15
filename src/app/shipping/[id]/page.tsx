"use client";

import { useEffect, useState, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useSearchParams, useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { format, startOfMonth } from "date-fns";
import Link from "next/link";

const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    return format(new Date(dateStr), "MMM d, yyyy");
};

type Order = {
    id: string;
    status: string;
    total_amount: number;
    shipping_cost: number;
    created_at: string;
    customer_info: any;
    // We might need customer name if available, or parse from customer_info
};

type CompanyDetails = {
    id: string;
    name: string;
    phone: string;
    type: string;
};

function ShippingCompanyDetailsContent() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const companyId = params.id as string;
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    // Local filters
    const [statusFilter, setStatusFilter] = useState<string>("All");

    const [loading, setLoading] = useState(true);
    const [company, setCompany] = useState<CompanyDetails | null>(null);
    const [orders, setOrders] = useState<Order[]>([]);

    // Stats
    const [stats, setStats] = useState({
        total: 0,
        shipped: 0,
        delivered: 0,
        returned: 0,
        value: 0
    });

    useEffect(() => {
        if (!fromDate || !toDate) {
            const start = format(startOfMonth(new Date()), "yyyy-MM-dd");
            const end = format(new Date(), "yyyy-MM-dd");
            router.replace(`?from=${start}&to=${end}`);
            return;
        }
        fetchData();
    }, [companyId, fromDate, toDate]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const start = fromDate ? `${fromDate}T00:00:00` : new Date().toISOString();
            const end = toDate ? `${toDate}T23:59:59` : new Date().toISOString();

            // 1. Fetch Company Info
            if (!company) {
                const { data: companyData, error: companyError } = await supabase
                    .from('shipping_companies')
                    .select('*')
                    .eq('id', companyId)
                    .single();
                if (companyError) throw companyError;
                setCompany(companyData);
            }

            // 2. Fetch Orders
            const { data: ordersData, error: ordersError } = await supabase
                .from('orders')
                .select('id, status, total_amount, shipping_cost, created_at, customer_info')
                .eq('shipping_company_id', companyId)
                .gte('created_at', start)
                .lte('created_at', end)
                .order('created_at', { ascending: false });

            if (ordersError) throw ordersError;

            setOrders(ordersData || []);

            // 3. Calc Stats
            const newStats = {
                total: 0,
                shipped: 0,
                delivered: 0,
                returned: 0,
                value: 0
            };

            ordersData?.forEach(o => {
                newStats.total++;
                if (o.status === 'Shipped') newStats.shipped++;
                if (o.status === 'Delivered' || o.status === 'Collected') newStats.delivered++;
                if (o.status === 'Returned') newStats.returned++;
                newStats.value += (o.total_amount || 0) - (o.shipping_cost || 0);
            });
            setStats(newStats);

        } catch (error) {
            console.error("Error fetching company details:", error);
        } finally {
            setLoading(false);
        }
    };

    const filteredOrders = orders.filter(o => {
        if (statusFilter === 'All') return true;
        if (statusFilter === 'Delivered') return o.status === 'Delivered' || o.status === 'Collected';
        return o.status === statusFilter;
    });

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.push('/shipping?tab=analytics')}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{company?.name || 'Loading...'}</h1>
                    <p className="text-muted-foreground">{company?.type} • {company?.phone}</p>
                </div>
                <div className="ml-auto">
                    <DateRangePicker />
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold">{stats.total}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Delivered / Collected</CardTitle></CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{stats.delivered}</div>
                        <p className="text-xs text-muted-foreground">{stats.total > 0 ? Math.round((stats.delivered / stats.total) * 100) : 0}% Rate</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Returned</CardTitle></CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-500">{stats.returned}</div>
                        <p className="text-xs text-muted-foreground">{stats.total > 0 ? Math.round((stats.returned / stats.total) * 100) : 0}% Rate</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Net Value (Excl. Shipping)</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold">{formatCurrency(stats.value)}</div></CardContent>
                </Card>
            </div>

            {/* Orders Table */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>Orders List</CardTitle>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Filter Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">All Statuses</SelectItem>
                                <SelectItem value="Shipped">Shipped</SelectItem>
                                <SelectItem value="Delivered">Delivered / Collected</SelectItem>
                                <SelectItem value="Returned">Returned</SelectItem>
                                <SelectItem value="Pending">Pending</SelectItem>
                                <SelectItem value="Processing">Processing</SelectItem>
                                <SelectItem value="Cancelled">Cancelled</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Order ID</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Customer</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead className="text-right">Shipping</TableHead>
                                    <TableHead className="text-right">Net Value</TableHead>
                                    <TableHead></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredOrders.map(order => (
                                    <TableRow key={order.id}>
                                        <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}</TableCell>
                                        <TableCell>{formatDate(order.created_at)}</TableCell>
                                        <TableCell>{order.customer_info?.name || 'Guest'}</TableCell>
                                        <TableCell>
                                            <Badge variant={
                                                order.status === 'Delivered' || order.status === 'Collected' ? 'default' :
                                                    order.status === 'Returned' ? 'destructive' :
                                                        order.status === 'Shipped' ? 'secondary' : 'outline'
                                            }>
                                                {order.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">{formatCurrency(order.total_amount)}</TableCell>
                                        <TableCell className="text-right text-muted-foreground">{formatCurrency(order.shipping_cost)}</TableCell>
                                        <TableCell className="text-right font-medium">{formatCurrency((order.total_amount || 0) - (order.shipping_cost || 0))}</TableCell>
                                        <TableCell>
                                            <Link href={`/orders/${order.id}`}>
                                                <Button variant="ghost" size="icon">
                                                    <ExternalLink className="h-4 w-4" />
                                                </Button>
                                            </Link>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {filteredOrders.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={8} className="text-center h-24 text-muted-foreground">
                                            No orders found.
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

export default function ShippingCompanyPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>}>
            <ShippingCompanyDetailsContent />
        </Suspense>
    );
}
