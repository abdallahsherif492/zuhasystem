"use client";

import { useEffect, useState, useMemo } from "react";
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
import { Plus, Loader2, MoreHorizontal, Download, Search, Printer, FilterX } from "lucide-react";
import * as XLSX from "xlsx";
import { DateRangePicker } from "@/components/date-range-picker";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelect, Option } from "@/components/ui/multi-select";
import { toast } from "sonner";

// Reuse standard lists
const GOVERNORATES = [
    "Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
];

const CHANNELS = ["Facebook", "Instagram", "Tiktok", "Website"];

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
    // Include items for filtering
    items?: {
        variant?: {
            product?: {
                id: string;
                name: string;
            }
        }
    }[];
    notes?: string; // Added notes for export
}

function OrdersContent() {
    const searchParams = useSearchParams();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [productsOptions, setProductsOptions] = useState<Option[]>([]);

    // Filters State
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [productFilter, setProductFilter] = useState<string[]>([]);
    const [govFilter, setGovFilter] = useState<string[]>([]);
    const [channelFilter, setChannelFilter] = useState<string[]>([]);

    // Selection State
    const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    useEffect(() => {
        fetchOrders();
        fetchProducts();
    }, [fromDate, toDate]);

    async function fetchProducts() {
        const { data } = await supabase.from('products').select('id, name').order('name');
        if (data) {
            setProductsOptions(data.map(p => ({ label: p.name, value: p.id })));
        }
    }

    async function fetchOrders() {
        try {
            setLoading(true);
            let query = supabase
                .from("orders")
                .select(`
                    *,
                    items:order_items (
                        variant:variants (
                            product:products (id, name)
                        )
                    )
                `)
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
            toast.error("Failed to fetch orders");
        } finally {
            setLoading(false);
        }
    }

    // Export Logic
    async function handleExport() {
        try {
            const hasSelection = selectedOrders.size > 0;
            const targetIds = hasSelection ? Array.from(selectedOrders) : filteredOrders.map(o => o.id);

            if (targetIds.length === 0) {
                toast.error("No orders to export");
                return;
            }

            toast.loading("Preparing Export...");

            // Fetch full data for export (need details like variant title, qty, etc)
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
                .in('id', targetIds)
                .order("created_at", { ascending: false });

            const { data, error } = await query;
            if (error) throw error;
            if (!data || data.length === 0) {
                toast.dismiss();
                toast.error("No data found");
                return;
            }

            // Format Data
            const exportData = data.map(order => {
                const content = order.items?.map((item: any) =>
                    `${item.variant?.product?.name} (${item.variant?.title}) x${item.quantity}`
                ).join(" + ") || "No Items";

                const phone1 = order.customer_info?.phone || "";
                const phone2 = order.customer_info?.phone2;
                const combinedPhone = phone2 ? `${phone1} / ${phone2}` : phone1;

                const baseNotes = order.notes || "";
                const requestNotes = "قابل للكسر"; // Fragile
                const combinedNotes = baseNotes ? `${baseNotes} | ${requestNotes}` : requestNotes;

                return {
                    "كـــود الــتــاجــر": "",
                    "اسم الراسل علي البوليصة": "Zuha Home",
                    "الـــــمــــــســـــتــــــــلـــــــــم": order.customer_info?.name || "",
                    "مــوبــايــل الــمــســتــلــم": combinedPhone,
                    "مـــلاحــظــات": combinedNotes,
                    "الـــمــــنـــطــقــــة": order.customer_info?.governorate || "",
                    "الـــــعــــنــــوان": order.customer_info?.address || "",
                    "مــحــتــوى الــشــحــنــة": content,
                    "الــكــمــيــة": 1,
                    "قــيــمــة الــشــحــنــة": order.total_amount,
                    "شــحــن عــلــى": "المستلم",
                    "شـــحــنــة اســتــبدال": "لا",
                    "مسموح بفتح الشحنة": "نعم"
                };
            });


            const worksheet = XLSX.utils.json_to_sheet(exportData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");
            XLSX.writeFile(workbook, `orders_export_${hasSelection ? 'selected' : 'all'}_${new Date().toISOString().split('T')[0]}.xlsx`);
            toast.dismiss();
            toast.success("Export successful");

        } catch (error) {
            console.error("Export failed:", error);
            toast.dismiss();
            toast.error("Export failed");
        }
    }

    const STATUSES = ["Pending", "Processing", "Prepared", "Shipped", "Delivered", "Cancelled", "Returned"];
    const statusOptions = STATUSES.map(s => ({ label: s, value: s }));
    const govOptions = GOVERNORATES.map(g => ({ label: g, value: g }));
    const channelOptions = CHANNELS.map(c => ({ label: c, value: c }));

    // Filter Logic
    const filteredOrders = useMemo(() => {
        return orders.filter(order => {
            // 1. Search
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const matches = (
                    order.id.toLowerCase().includes(q) ||
                    order.customer_info?.name?.toLowerCase().includes(q) ||
                    order.customer_info?.phone?.includes(q) ||
                    order.channel?.toLowerCase().includes(q)
                );
                if (!matches) return false;
            }

            // 2. Status Filter
            if (statusFilter.length > 0 && !statusFilter.includes(order.status)) return false;

            // 3. Gov Filter
            if (govFilter.length > 0 && !govFilter.includes(order.customer_info?.governorate || "")) return false;

            // 4. Channel Filter
            if (channelFilter.length > 0 && !channelFilter.includes(order.channel || "")) return false;

            // 5. Product Filter
            if (productFilter.length > 0) {
                // Check if ANY item in order matches ANY selected product
                const orderProductIds = order.items?.map(i => i.variant?.product?.id).filter(Boolean) || [];
                const hasMatch = productFilter.some(pid => orderProductIds.includes(pid));
                if (!hasMatch) return false;
            }

            return true;
        });
    }, [orders, searchQuery, statusFilter, govFilter, channelFilter, productFilter]);

    // Selection Logic
    const allSelected = filteredOrders.length > 0 && selectedOrders.size === filteredOrders.length;

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            const allIds = filteredOrders.map(o => o.id);
            setSelectedOrders(new Set(allIds));
        } else {
            setSelectedOrders(new Set());
        }
    };

    const handleSelectRow = (id: string, checked: boolean) => {
        const newSet = new Set(selectedOrders);
        if (checked) {
            newSet.add(id);
        } else {
            newSet.delete(id);
        }
        setSelectedOrders(newSet);
    };

    const clearFilters = () => {
        setSearchQuery("");
        setStatusFilter([]);
        setProductFilter([]);
        setGovFilter([]);
        setChannelFilter([]);
    }

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

                {/* Filters Bar */}
                <div className="bg-muted/40 p-4 rounded-lg space-y-4">
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search orders..."
                                className="pl-8 bg-white"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-[2]">
                            <MultiSelect
                                options={statusOptions}
                                selected={statusFilter}
                                onChange={setStatusFilter}
                                placeholder="Status"
                                className="bg-white"
                            />
                            <MultiSelect
                                options={channelOptions}
                                selected={channelFilter}
                                onChange={setChannelFilter}
                                placeholder="Channel"
                                className="bg-white"
                            />
                            <MultiSelect
                                options={govOptions}
                                selected={govFilter}
                                onChange={setGovFilter}
                                placeholder="Governorate"
                                className="bg-white"
                            />
                            <MultiSelect
                                options={productsOptions}
                                selected={productFilter}
                                onChange={setProductFilter}
                                placeholder="Product"
                                className="bg-white"
                            />
                        </div>
                        <Button variant="ghost" size="icon" onClick={clearFilters} title="Clear Filters">
                            <FilterX className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="flex justify-between items-center">
                        <div className="text-sm text-muted-foreground">
                            {filteredOrders.length} orders found. {selectedOrders.size > 0 && <span className="text-primary font-bold">({selectedOrders.size} selected)</span>}
                        </div>
                        <Button variant="outline" onClick={handleExport} className="bg-white">
                            <Download className="mr-2 h-4 w-4" />
                            {selectedOrders.size > 0 ? `Export Selected (${selectedOrders.size})` : "Export All"}
                        </Button>
                    </div>
                </div>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[40px]">
                                <Checkbox
                                    checked={allSelected}
                                    onCheckedChange={handleSelectAll}
                                />
                            </TableHead>
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
                                <TableCell colSpan={10} className="h-24 text-center">
                                    <div className="flex justify-center items-center">
                                        <Loader2 className="h-6 w-6 animate-spin mr-2" />
                                        Loading...
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : filteredOrders.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={10} className="h-24 text-center">
                                    No orders found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredOrders.map((order) => (
                                <TableRow key={order.id} data-state={selectedOrders.has(order.id) && "selected"}>
                                    <TableCell>
                                        <Checkbox
                                            checked={selectedOrders.has(order.id)}
                                            onCheckedChange={(checked) => handleSelectRow(order.id, checked as boolean)}
                                        />
                                    </TableCell>
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
