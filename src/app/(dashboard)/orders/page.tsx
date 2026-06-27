"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
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
import { Plus, Loader2, MoreHorizontal, Download, Search, Printer, FilterX, ChevronLeft, ChevronRight } from "lucide-react";
import * as XLSX from "xlsx";
import { DateRangePicker } from "@/components/date-range-picker";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelect, Option } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/use-debounce";

// Reuse standard lists
const GOVERNORATES = [
    "Cairo", "New Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
];

const CHANNELS = ["Facebook", "Instagram", "Tiktok", "Tiktok Website", "Website", "Whatsapp"];

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
    items?: {
        quantity: number;
        variant?: {
            title: string;
            product?: {
                id: string;
                name: string;
            }
        }
    }[];
    notes?: string;
    payment_status?: string;
    paid_amount?: number;
}

function OrdersContent() {
    const { activeBusiness } = useBusiness();
    const searchParams = useSearchParams();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [totalCount, setTotalCount] = useState(0);
    const [productsOptions, setProductsOptions] = useState<Option[]>([]);

    // Pagination State
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);

    // Filters State
    const [searchQuery, setSearchQuery] = useState("");
    const debouncedSearch = useDebounce(searchQuery, 500);

    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [productFilter, setProductFilter] = useState<string[]>([]);
    const [govFilter, setGovFilter] = useState<string[]>([]);
    const [channelFilter, setChannelFilter] = useState<string[]>([]);

    // Selection State
    const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    useEffect(() => {
        fetchProducts();
    }, [activeBusiness]);

    useEffect(() => {
        // Reset to page 1 when filters change
        setPage(1);
    }, [debouncedSearch, statusFilter, productFilter, govFilter, channelFilter, fromDate, toDate, pageSize]);

    useEffect(() => {
        fetchOrders();
    }, [page, pageSize, debouncedSearch, statusFilter, productFilter, govFilter, channelFilter, fromDate, toDate, activeBusiness]);

    async function fetchProducts() {
        if (!activeBusiness) return;
        const { data } = await supabase.from('products').select('id, name').eq('business_id', activeBusiness.id).order('name');
        if (data) {
            setProductsOptions(data.map(p => ({ label: p.name, value: p.id })));
        }
    }

    async function fetchOrders() {
        if (!activeBusiness) return;
        try {
            setLoading(true);
            setErrorMsg(null);

            // Fetch via RPC for paginated and filtered data
            const { data, error } = await supabase.rpc('get_orders_paginated', {
                p_business_id: activeBusiness.id,
                p_page_number: page,
                p_page_size: pageSize,
                p_search: debouncedSearch || null,
                p_status: statusFilter.length > 0 ? statusFilter : null,
                p_channel: channelFilter.length > 0 ? channelFilter : null,
                p_gov: govFilter.length > 0 ? govFilter : null,
                p_products: productFilter.length > 0 ? productFilter : null,
                p_from_date: fromDate || null,
                p_to_date: toDate ? new Date(new Date(toDate).setHours(23, 59, 59, 999)).toISOString() : null,
                p_export_all: false
            });

            if (error) { setErrorMsg(error.message + " | Details: " + JSON.stringify(error)); throw error; }

            if (data && data.length > 0) {
                setOrders(data);
                setTotalCount(Number(data[0].total_count));
            } else {
                setOrders([]);
                setTotalCount(0);
            }
            
            // Clear selection when page changes or filters change
            setSelectedOrders(new Set());
            
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
            if (!activeBusiness) return;
            const hasSelection = selectedOrders.size > 0;
            
            if (hasSelection) {
                // Export only selected from current page
                const targetOrders = orders.filter(o => selectedOrders.has(o.id));
                processExportData(targetOrders, 'selected');
            } else {
                // Export ALL matching current filters using RPC
                toast.loading("Fetching all filtered orders for export...");
                const { data, error } = await supabase.rpc('get_orders_paginated', {
                    p_business_id: activeBusiness.id,
                    p_page_number: 1,
                    p_page_size: 10, // ignored when p_export_all is true
                    p_search: debouncedSearch || null,
                    p_status: statusFilter.length > 0 ? statusFilter : null,
                    p_channel: channelFilter.length > 0 ? channelFilter : null,
                    p_gov: govFilter.length > 0 ? govFilter : null,
                    p_products: productFilter.length > 0 ? productFilter : null,
                    p_from_date: fromDate || null,
                    p_to_date: toDate ? new Date(new Date(toDate).setHours(23, 59, 59, 999)).toISOString() : null,
                    p_export_all: true
                });
                
                if (error) throw error;
                if (!data || data.length === 0) {
                    toast.dismiss();
                    toast.error("No data found to export");
                    return;
                }
                processExportData(data, 'all');
            }
        } catch (error) {
            console.error("Export failed:", error);
            toast.dismiss();
            toast.error("Export failed");
        }
    }

    function processExportData(data: any[], suffix: string) {
        const exportData = data.map(order => {
            let itemsArray = [];
            if (typeof order.items === 'string') {
                try { itemsArray = JSON.parse(order.items); } catch(e){}
            } else if (Array.isArray(order.items)) {
                itemsArray = order.items;
            }

            const content = itemsArray?.map((item: any) =>
                `${item.variant?.product?.name} (${item.variant?.title}) x${item.quantity}`
            ).join(" + ") || "No Items";

            const phone1 = order.customer_info?.phone || "";
            const phone2 = order.customer_info?.phone2;
            const combinedPhone = phone2 ? `${phone1} / ${phone2}` : phone1;

            const baseNotes = order.notes || "";
            const requestNotes = "قابل للكسر"; // Fragile
            const combinedNotes = baseNotes ? `${baseNotes} | ${requestNotes}` : requestNotes;

            const paymentStatus = order.payment_status || "Not Paid";
            const paidAmount = order.paid_amount || 0;
            let collectAmount = order.total_amount;

            if (paymentStatus === "Paid") {
                collectAmount = 0;
            } else if (paymentStatus === "Partially Paid") {
                collectAmount = Math.max(0, order.total_amount - paidAmount);
            }

            return {
                "كـــود الــتــاجــر": "",
                "رقم الأوردر": order.id.slice(0, 8),
                "اسم الراسل علي البوليصة": "Zuha Home",
                "الـــــمــــــســـــتــــــــلـــــــــم": order.customer_info?.name || "",
                "مــوبــايــل 1": phone1,
                "مــوبــايــل 2": phone2 || "",
                "مـــلاحــظــات": combinedNotes,
                "الـــمــــنـــطــقــــة": order.customer_info?.governorate || "",
                "الـــــعــــنــــوان": order.customer_info?.address || "",
                "مــحــتــوى الــشــحــنــة": content,
                "الــكــمــيــة": 1,
                "قــيــمــة الــشــحــنــة": collectAmount,
                "شــحــن عــلــى": "المستلم",
                "شـــحــنــة اســتــبدال": "لا",
                "مسموح بفتح الشحنة": "نعم",
                "حالة الدفع": paymentStatus,
                "المبلغ المدفوع": paidAmount
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");
        XLSX.writeFile(workbook, `orders_export_${suffix}_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast.dismiss();
        toast.success("Export successful");
    }

    function handlePrintSelected() {
        if (selectedOrders.size === 0) {
            toast.error("Select orders to print");
            return;
        }
        const ids = Array.from(selectedOrders).join(",");
        window.open(`/orders/print?ids=${ids}`, '_blank');
    }

    const STATUSES = ["Pending", "Processing", "Prepared", "Shipped", "Delivered", "Cancelled", "Returned"];
    const statusOptions = STATUSES.map(s => ({ label: s, value: s }));
    const govOptions: Option[] = [
        { label: "All Except Cairo & Giza", value: "ALL_EXCEPT_CAIRO_GIZA" },
        ...GOVERNORATES.map(g => ({ label: g, value: g }))
    ];
    const channelOptions = CHANNELS.map(c => ({ label: c, value: c }));

    const allSelected = orders.length > 0 && selectedOrders.size === orders.length;

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            const allIds = orders.map(o => o.id);
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
    };

    const totalPages = Math.ceil(totalCount / pageSize);

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
                                showSelectAll={true}
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
                            {totalCount} orders found. {selectedOrders.size > 0 && <span className="text-primary font-bold">({selectedOrders.size} selected on this page)</span>}
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                onClick={handlePrintSelected}
                                disabled={selectedOrders.size === 0}
                                className="bg-white"
                            >
                                <Printer className="mr-2 h-4 w-4" />
                                Print Selected
                            </Button>
                            <Button variant="outline" onClick={handleExport} className="bg-white">
                                <Download className="mr-2 h-4 w-4" />
                                {selectedOrders.size > 0 ? `Export Selected` : "Export All"}
                            </Button>
                        </div>
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
                        {errorMsg ? (
                            <TableRow>
                                <TableCell colSpan={10} className="h-24 text-center text-red-500 font-bold">
                                    Error: {errorMsg}
                                </TableCell>
                            </TableRow>
                        ) : loading ? (
                            <TableRow>
                                <TableCell colSpan={10} className="h-24 text-center">
                                    <div className="flex justify-center items-center">
                                        <Loader2 className="h-6 w-6 animate-spin mr-2" />
                                        Loading...
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : orders.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={10} className="h-24 text-center">
                                    No orders found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            orders.map((order) => (
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
                                        +{formatCurrency(order.profit)}
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
            
            {/* Pagination Controls */}
            {totalCount > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="text-sm text-muted-foreground">
                            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalCount)} of {totalCount} orders
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground hidden sm:inline-block">Per page:</span>
                            <Select value={pageSize.toString()} onValueChange={(v) => setPageSize(Number(v))}>
                                <SelectTrigger className="h-8 w-[70px]">
                                    <SelectValue placeholder={pageSize} />
                                </SelectTrigger>
                                <SelectContent>
                                    {[50, 100, 250, 500].map(size => (
                                        <SelectItem key={size} value={size.toString()}>{size}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    {totalPages > 1 && (
                        <div className="flex items-center space-x-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1 || loading}
                            >
                                <ChevronLeft className="h-4 w-4" />
                                Previous
                            </Button>
                            <div className="text-sm font-medium">
                                Page {page} of {totalPages}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages || loading}
                            >
                                Next
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div >
    );
}

export default function OrdersPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <OrdersContent />
        </Suspense>
    );
}
