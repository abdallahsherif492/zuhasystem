"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowRight } from "lucide-react";
import { DateRangePicker } from "@/components/date-range-picker";
import { startOfDay, endOfDay, subDays } from "date-fns";

const STATUSES = [
    "Pending",
    "Prepared",
    "Shipped",
    "Delivered",
    "Collected",
    "Cancelled",
    "Unavailable",
    "Returned",
];

export default function LogisticsPage() {
    const searchParams = useSearchParams();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    useEffect(() => {
        fetchOrders();
    }, [fromDate, toDate]);

    async function fetchOrders() {
        try {
            setLoading(true);
            let query = supabase
                .from("orders")
                .select("*")
                .order("created_at", { ascending: false });

            if (fromDate) {
                query = query.gte("created_at", fromDate);
            }
            if (toDate) {
                // Adjust to end of day if it's a date only string
                const end = new Date(toDate);
                end.setHours(23, 59, 59, 999);
                query = query.lte("created_at", end.toISOString());
            }

            const { data, error } = await query;
            if (error) throw error;
            setOrders(data || []);
        } catch (error) {
            console.error("Error fetching orders:", error);
        } finally {
            setLoading(false);
        }
    }

    const updateStatus = async (orderId: string, newStatus: string) => {
        try {
            const { error } = await supabase
                .from("orders")
                .update({ status: newStatus })
                .eq("id", orderId);
            if (error) throw error;
            // Optimistic update or refetch
            setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
        } catch (error) {
            console.error("Failed to update status", error);
            alert("Failed to update status");
        }
    };

    // Calculate Metrics
    const metrics = STATUSES.map(status => {
        const filtered = orders.filter(o => o.status === status);
        const count = filtered.length;
        const totalValue = filtered.reduce((acc, o) => acc + (o.total_amount || 0), 0);
        return { status, count, totalValue };
    });

    // Group orders by status for the board view (optional, but requested "Manage status")
    // User asked: "track how many orders on each stage and their total value"
    // And "Update status"
    // I'll show the metrics cards at top, and a table below where you can change status.

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <h1 className="text-3xl font-bold tracking-tight">Logistics</h1>
                <DateRangePicker />
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {metrics.map((m) => (
                    <Card key={m.status}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                {m.status}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{m.count}</div>
                            <p className="text-xs text-muted-foreground">
                                {formatCurrency(m.totalValue)}
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Orders Table with Status Actions */}
            <div className="rounded-md border bg-card text-card-foreground">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Order ID</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Gov</TableHead>
                            <TableHead>Channel</TableHead>
                            <TableHead>Current Status</TableHead>
                            <TableHead>Move To</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-24 text-center">
                                    <div className="flex justify-center items-center">
                                        <Loader2 className="h-6 w-6 animate-spin mr-2" />
                                        Loading...
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : orders.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-24 text-center">
                                    No orders found for this period.
                                </TableCell>
                            </TableRow>
                        ) : (
                            orders.map((order) => {
                                const currentIndex = STATUSES.indexOf(order.status);
                                const nextStatus = currentIndex < STATUSES.length - 1 ? STATUSES[currentIndex + 1] : null;

                                return (
                                    <TableRow key={order.id}>
                                        <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}</TableCell>
                                        <TableCell>{new Date(order.created_at).toLocaleDateString()}</TableCell>
                                        <TableCell>{order.customer_info?.name || "N/A"}</TableCell>
                                        <TableCell>{order.customer_info?.governorate || "-"}</TableCell>
                                        <TableCell>{order.channel}</TableCell>
                                        <TableCell>
                                            <Badge variant={order.status === 'Cancelled' ? 'destructive' : 'outline'} className="capitalize">
                                                {order.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="flex gap-2">
                                            <select
                                                className="h-8 w-32 rounded-md border border-input bg-transparent px-2 text-xs"
                                                value={order.status}
                                                onChange={(e) => updateStatus(order.id, e.target.value)}
                                            >
                                                {STATUSES.map(s => (
                                                    <option key={s} value={s}>{s}</option>
                                                ))}
                                            </select>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
