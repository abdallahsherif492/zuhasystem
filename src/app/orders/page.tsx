"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Loader2, MoreHorizontal, Download, Search, Printer } from "lucide-react";
import * as XLSX from "xlsx";
import { DateRangePicker } from "@/components/date-range-picker";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface Order {
    id: string;
    created_at: string;
    status: string;
    total_amount: number;
    total_cost: number;
    profit: number;
    customer_info: any;
    channel?: string;
    shipping_cost?: number;
    tags?: string[];
}

function OrdersContent() {
    const searchParams = useSearchParams();
    const [orders, setOrders] = useState<Order[]>([]);
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

            if (fromDate) query = query.gte("created_at", fromDate);
            if (toDate) {
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

    async function handleExport() {
        try {
            // 1. Fetch full data with items
            let query = supabase
                .from("orders")
                .select(`
                    *,
                    items:order_items (
                        quantity,
                        variant:variants (
                            title,
                            product:products (name)
                        )
                    )
                `)
                .eq("status", "Pending")
                .order("created_at", { ascending: false });

            if (fromDate) query = query.gte("created_at", fromDate);
            if (toDate) {
                const end = new Date(toDate);
                end.setHours(23, 59, 59, 999);
                query = query.lte("created_at", end.toISOString());
            }

            const { data, error } = await query;
            if (error) throw error;
            if (!data || data.length === 0) {
                alert("No orders to export");
                return;
            }

            // 2. Format Data
            const exportData = data.map(order => {
                // Format Items: "Product (Variant) xQty"
                const content = order.items?.map((item: any) =>
                    `${item.variant?.product?.name} (${item.variant?.title}) x${item.quantity}`
                ).join(" + ") || "No Items";

                return {
                    "كـــود الــتــاجــر": "",
                    "اسم الراسل علي البوليصة": "Zuha Home",
                    "الـــــمــــــســـــتــــــــلـــــــــم": order.customer_info?.name || "",
                    "مــوبــايــل الــمــســتــلــم": order.customer_info?.phone || "",
                    "مـــلاحــظــات": "قابل للكسر",
                    "الـــمــــنـــطــقــــة": order.customer_info?.governorate || "",
                    "الـــــعــــنــــوان": order.customer_info?.address || "",
                    "مــحــتــوى الــشــحــنــة": content,
                    "الــكــمــيــة": 1, // Default 1 package
                    "قــيــمــة الــشــحــنــة": order.total_amount,
                    "شــحــن عــلــى": "المستلم",
                    "شـــحــنــة اســتــبدال": "لا",
                    "مسموح بفتح الشحنة": "نعم"
                };
            });

            // 3. Generate Excel
            const worksheet = XLSX.utils.json_to_sheet(exportData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");

            // 4. Download
            XLSX.writeFile(workbook, `orders_export_${new Date().toISOString().split('T')[0]}.xlsx`);

        } catch (error) {
            console.error("Export failed:", error);
            alert("Export failed");
        }
    }

    // Search & Filter State
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("All");

    const STATUSES = ["All", "Pending", "Processing", "Prepared", "Shipped", "Delivered", "Cancelled", "Returned"];

    // Filter Logic
    const filteredOrders = orders.filter(order => {
        // 1. Status Filter
        if (statusFilter !== "All" && order.status !== statusFilter) return false;

        // 2. Search Query
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();

        return (
            order.id.toLowerCase().includes(q) ||
            order.customer_info?.name?.toLowerCase().includes(q) ||
            order.customer_info?.phone?.includes(q) ||
            order.channel?.toLowerCase().includes(q)
        );
    });

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
                    <div className="flex items-center gap-2">
                        <DateRangePicker />
                        <Link href="/orders/new">
                            <Button>
                                <Plus className="mr-2 h-4 w-4" /> New Order
                            </Button>
                        </Link>
                    </div>
                </div>

                {/* Search & Actions Bar */}
                <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-muted/40 p-4 rounded-lg">
                    <div className="flex flex-1 items-center gap-2 w-full sm:w-auto">
                        <div className="relative flex-1 sm:max-w-sm">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search orders..."
                                className="pl-8 bg-white"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-[180px] bg-white">
                                <SelectValue placeholder="Filter by Status" />
                            </SelectTrigger>
                            <SelectContent>
                                {STATUSES.map(status => (
                                    <SelectItem key={status} value={status}>
                                        {status === "All" ? "All Statuses" : status}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <Button variant="outline" onClick={handleExport} className="bg-white">
                        <Download className="mr-2 h-4 w-4" /> Export Excel
                    </Button>
                </div>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Order ID</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Channel</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Tags</TableHead>
                            <TableHead>Total</TableHead>
                            <TableHead>Profit</TableHead>
                            <TableHead>Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={9} className="h-24 text-center">
                                    <div className="flex justify-center items-center">
                                        <Loader2 className="h-6 w-6 animate-spin mr-2" />
                                        Loading...
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : filteredOrders.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={9} className="h-24 text-center">
                                    No orders found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredOrders.map((order) => (
                                <TableRow key={order.id}>
                                    <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}</TableCell>
                                    <TableCell>
                                        {new Date(order.created_at).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell>
                                        <div className="font-medium">{order.customer_info?.name || "N/A"}</div>
                                        <div className="text-xs text-muted-foreground">{order.customer_info?.phone}</div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline">{order.channel || "N/A"}</Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={order.status === 'Delivered' ? 'default' : 'secondary'}>
                                            {order.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                            {order.tags?.map(tag => (
                                                <span key={tag} className="text-[10px] bg-muted px-1 rounded border">
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    </TableCell>
                                    <TableCell>{formatCurrency(order.total_amount)}</TableCell>
                                    <TableCell className="text-green-600 font-medium">
                                        +{formatCurrency(order.profit - (order.shipping_cost || 0) - 10)}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => window.open(`/orders/${order.id}/invoice`, '_blank')}
                                                className="h-8 px-2"
                                            >
                                                <Printer className="h-3 w-3" />
                                            </Button>
                                            <Link href={`/orders/${order.id}`}>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8 w-8 p-0"
                                                    title="View Details"
                                                >
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </Link>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

import { Suspense } from "react";

export default function OrdersPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <OrdersContent />
        </Suspense>
    );
}
