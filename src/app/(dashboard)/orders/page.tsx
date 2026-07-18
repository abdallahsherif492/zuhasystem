"use client";

import { useEffect, useState, useMemo, Suspense, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
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
    const { t } = useLanguage();
    const searchParams = useSearchParams();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [totalCount, setTotalCount] = useState(0);
    const [productsOptions, setProductsOptions] = useState<Option[]>([]);

    // Pagination State
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(100);

    // Filters State
    const [searchQuery, setSearchQuery] = useState("");
    const debouncedSearch = useDebounce(searchQuery, 500);

    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [productFilter, setProductFilter] = useState<string[]>([]);
    const [govFilter, setGovFilter] = useState<string[]>([]);
    const [channelFilter, setChannelFilter] = useState<string[]>([]);
    const [shippingCompanyFilter, setShippingCompanyFilter] = useState<string>("all");
    const [uploadedOrderFilters, setUploadedOrderFilters] = useState<string[]>([]);
    const [shippingCompanies, setShippingCompanies] = useState<any[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
    }, [debouncedSearch, statusFilter, productFilter, govFilter, channelFilter, shippingCompanyFilter, uploadedOrderFilters, fromDate, toDate, pageSize]);

    useEffect(() => {
        fetchOrders();
    }, [page, pageSize, debouncedSearch, statusFilter, productFilter, govFilter, channelFilter, shippingCompanyFilter, uploadedOrderFilters, fromDate, toDate, activeBusiness]);

    async function fetchProducts() {
        if (!activeBusiness) return;
        const { data } = await supabase.from('products').select('id, name').eq('business_id', activeBusiness.id).order('name');
        if (data) {
            setProductsOptions(data.map(p => ({ label: p.name, value: p.id })));
        }

        const { data: companies } = await supabase.from('shipping_companies').select('id, name');
        if (companies) {
            setShippingCompanies(companies);
        }
    }

    async function fetchOrders() {
        if (!activeBusiness) return;
        try {
            setLoading(true);
            setErrorMsg(null);

            const hasNewFilters = shippingCompanyFilter !== "all" || uploadedOrderFilters.length > 0;

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
                p_export_all: hasNewFilters // Fetch all if we need to apply local filters
            });

            if (error) { setErrorMsg(error.message + " | Details: " + JSON.stringify(error)); throw error; }

            let resultData = data || [];

            if (hasNewFilters && resultData.length > 0) {
                // Fetch mapping data since RPC might not return shipping_company_id or easyorders_id
                const { data: mappingData } = await supabase.from('orders')
                    .select('id, shipping_company_id, easyorders_id, customer_info')
                    .in('id', resultData.map((r: any) => r.id));

                if (mappingData) {
                    const map = new Map(mappingData.map(m => [m.id, m]));
                    
                    if (shippingCompanyFilter !== "all") {
                        resultData = resultData.filter((r: any) => map.get(r.id)?.shipping_company_id === shippingCompanyFilter);
                    }
                    
                    if (uploadedOrderFilters.length > 0) {
                        resultData = resultData.filter((r: any) => {
                            const m = map.get(r.id);
                            if (!m) return false;
                            const phone1 = String(m.customer_info?.phone || '').trim();
                            const phone2 = String(m.customer_info?.phone2 || '').trim();
                            const shortId = m.id.slice(0,8);
                            const easyId = String(m.easyorders_id || '');
                            return uploadedOrderFilters.some(f => {
                                const clean = String(f).trim();
                                return clean === phone1 || clean === phone2 || clean === shortId || clean === easyId || shortId.includes(clean);
                            });
                        });
                    }
                }
                
                // Now manually paginate resultData
                setTotalCount(resultData.length);
                const start = (page - 1) * pageSize;
                setOrders(resultData.slice(start, start + pageSize));
            } else {
                if (resultData.length > 0) {
                    setOrders(resultData);
                    setTotalCount(Number(resultData[0].total_count));
                } else {
                    setOrders([]);
                    setTotalCount(0);
                }
            }
            
            // Do NOT clear selection when page changes or filters change
            
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
                // Fetch full data for selected orders
                toast.loading("Fetching selected orders for export...");
                const { data, error } = await supabase
                    .from('orders')
                    .select('*, items:order_items(quantity, variant:variants(title, product:products(id, name)))')
                    .in('id', Array.from(selectedOrders));
                
                if (error) throw error;
                if (!data || data.length === 0) {
                    toast.dismiss();
                    toast.error("No data found to export");
                    return;
                }
                processExportData(data, 'selected');
            } else {
                // Export ALL matching current filters using RPC
                toast.loading("Fetching all filtered orders for export...");
                const hasNewFilters = shippingCompanyFilter !== "all" || uploadedOrderFilters.length > 0;
                
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
                
                let resultData = data || [];
                
                if (hasNewFilters && resultData.length > 0) {
                    const { data: mappingData } = await supabase.from('orders')
                        .select('id, shipping_company_id, easyorders_id, customer_info')
                        .in('id', resultData.map((r: any) => r.id));

                    if (mappingData) {
                        const map = new Map(mappingData.map(m => [m.id, m]));
                        if (shippingCompanyFilter !== "all") {
                            resultData = resultData.filter((r: any) => map.get(r.id)?.shipping_company_id === shippingCompanyFilter);
                        }
                        if (uploadedOrderFilters.length > 0) {
                            resultData = resultData.filter((r: any) => {
                                const m = map.get(r.id);
                                if (!m) return false;
                                const phone1 = String(m.customer_info?.phone || '').trim();
                                const phone2 = String(m.customer_info?.phone2 || '').trim();
                                const shortId = m.id.slice(0,8);
                                const easyId = String(m.easyorders_id || '');
                                return uploadedOrderFilters.some(f => {
                                    const clean = String(f).trim();
                                    return clean === phone1 || clean === phone2 || clean === shortId || clean === easyId || shortId.includes(clean);
                                });
                            });
                        }
                    }
                }

                if (!resultData || resultData.length === 0) {
                    toast.dismiss();
                    toast.error("No data found to export");
                    return;
                }
                processExportData(resultData, 'all');
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

            const content = itemsArray?.map((item: any) => {
                const productName = item.variant?.product?.name || item.product?.name || item.product_name || "Product";
                const variantTitle = item.variant?.title || item.variant_title || "N/A";
                return `${productName} (${variantTitle}) x${item.quantity}`;
            }).join(" + ") || "No Items";

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
        XLSX.writeFile(workbook, `orders_export_${suffix}.xlsx`);
        toast.dismiss();
        toast.success("Export successful");
    }

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: "binary" });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
                
                // Extract the first column items, skipping empty rows
                let filters: string[] = [];
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    if (row && row[0] !== undefined && row[0] !== null && String(row[0]).trim() !== '') {
                        filters.push(String(row[0]).trim());
                    }
                }

                if (filters.length > 0) {
                    setUploadedOrderFilters(filters);
                    toast.success(`Filter applied: ${filters.length} items extracted from sheet`);
                } else {
                    toast.error("No valid data found in the first column");
                }
            } catch (err) {
                console.error("Error reading file:", err);
                toast.error("Failed to parse file");
            }
        };
        reader.readAsBinaryString(file);
    };

    function handlePrintSelected() {
        if (selectedOrders.size === 0) {
            toast.error("Select orders to print");
            return;
        }
        const ids = Array.from(selectedOrders).join(",");
        window.open(`/orders/print?ids=${ids}`, '_blank');
    }

    const STATUSES = ["Pending", "Processing", "Prepared", "Hold To redeliver", "Shipped", "Delivered", "Returning", "Cancelled", "Returned", "Unavailable"];
    
    const getStatusColor = (status: any) => {
        if (!status || typeof status !== 'string') return 'bg-gray-100 text-gray-800 hover:bg-gray-100/80 dark:bg-gray-800 dark:text-gray-400';
        switch (status.toLowerCase()) {
            case 'pending': return 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80 dark:bg-yellow-900/50 dark:text-yellow-400';
            case 'processing': return 'bg-blue-100 text-blue-800 hover:bg-blue-100/80 dark:bg-blue-900/50 dark:text-blue-400';
            case 'prepared': return 'bg-purple-100 text-purple-800 hover:bg-purple-100/80 dark:bg-purple-900/50 dark:text-purple-400';
            case 'shipped': return 'bg-indigo-100 text-indigo-800 hover:bg-indigo-100/80 dark:bg-indigo-900/50 dark:text-indigo-400';
            case 'delivered': return 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100/80 dark:bg-emerald-900/50 dark:text-emerald-400';
            case 'cancelled': return 'bg-red-100 text-red-800 hover:bg-red-100/80 dark:bg-red-900/50 dark:text-red-400';
            case 'returned': return 'bg-orange-100 text-orange-800 hover:bg-orange-100/80 dark:bg-orange-900/50 dark:text-orange-400';
            case 'unavailable': return 'bg-slate-100 text-slate-800 hover:bg-slate-100/80 dark:bg-slate-800 dark:text-slate-400';
            default: return 'bg-gray-100 text-gray-800 hover:bg-gray-100/80 dark:bg-gray-800 dark:text-gray-400';
        }
    };
    
    const statusOptions = STATUSES.map(s => ({ label: s, value: s }));
    const govOptions: Option[] = [
        { label: "All Except Cairo & Giza", value: "ALL_EXCEPT_CAIRO_GIZA" },
        ...GOVERNORATES.map(g => ({ label: g, value: g }))
    ];
    const channelOptions = CHANNELS.map(c => ({ label: c, value: c }));

    const allSelected = orders.length > 0 && orders.every(o => selectedOrders.has(o.id));

    const handleSelectAll = (checked: boolean) => {
        const newSet = new Set(selectedOrders);
        if (checked) {
            orders.forEach(o => newSet.add(o.id));
        } else {
            orders.forEach(o => newSet.delete(o.id));
        }
        setSelectedOrders(newSet);
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
                    <h1 className="text-3xl font-bold tracking-tight">{t("Orders")}</h1>
                    <div className="flex items-center gap-2">
                        <DateRangePicker />
                        <Link href="/orders/new">
                            <Button>
                                <Plus className="mr-2 h-4 w-4" /> {t("New Order")}
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
                                placeholder={t("Search orders...")}
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
                                placeholder={t("Status")}
                                className="bg-white"
                            />
                            <MultiSelect
                                options={channelOptions}
                                selected={channelFilter}
                                onChange={setChannelFilter}
                                placeholder={t("Channel")}
                                className="bg-white"
                            />
                            <MultiSelect
                                options={govOptions}
                                selected={govFilter}
                                onChange={setGovFilter}
                                placeholder={t("Governorate")}
                                className="bg-white"
                                showSelectAll={true}
                            />
                            <MultiSelect
                                options={productsOptions}
                                selected={productFilter}
                                onChange={setProductFilter}
                                placeholder={t("Product")}
                                className="bg-white"
                            />
                        </div>
                        <Button variant="ghost" size="icon" onClick={clearFilters} title="Clear Filters">
                            <FilterX className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="flex justify-between items-center">
                        <div className="text-sm text-muted-foreground">
                            {totalCount} {t("orders found")}. {selectedOrders.size > 0 && <span className="text-primary font-bold ml-2">({selectedOrders.size} {t("selected")})</span>}
                        </div>
                        <div className="flex gap-2">
                            <Input
                                placeholder={t("Search by name, phone, order id...")}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full sm:w-[250px]"
                            />
                            
                            <Select value={shippingCompanyFilter} onValueChange={setShippingCompanyFilter}>
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="Shipping Company" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Companies</SelectItem>
                                    {shippingCompanies.map(c => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <input 
                                type="file" 
                                accept=".xlsx, .csv" 
                                className="hidden" 
                                ref={fileInputRef} 
                                onChange={handleFileUpload} 
                            />
                            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                                <FilterX className="mr-2 h-4 w-4" />
                                Upload Sheet
                            </Button>
                            {uploadedOrderFilters.length > 0 && (
                                <Button variant="ghost" className="text-destructive" onClick={() => {
                                    setUploadedOrderFilters([]);
                                    if (fileInputRef.current) fileInputRef.current.value = "";
                                }}>
                                    Clear Sheet Filter
                                </Button>
                            )}
                            <Button
                                variant="secondary"
                                onClick={handlePrintSelected}
                                disabled={selectedOrders.size === 0}
                                className="bg-white"
                            >
                                <Printer className="mr-2 h-4 w-4" />
                                {t("Print Selected")}
                            </Button>
                            <Button variant="outline" onClick={handleExport} className="bg-white">
                                <Download className="mr-2 h-4 w-4" />
                                {selectedOrders.size > 0 ? t("Export Selected") : t("Export All")}
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
                            <TableHead>{t("Date")}</TableHead>
                            <TableHead>{t("Customer")}</TableHead>
                            <TableHead>{t("Channel")}</TableHead>
                            <TableHead>{t("Status")}</TableHead>
                            <TableHead>{t("Tags")}</TableHead>
                            <TableHead>{t("Total")}</TableHead>
                            <TableHead>{t("Profit")}</TableHead>
                            <TableHead>{t("Actions")}</TableHead>
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
                                        {t("Loading...")}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : orders.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={10} className="h-24 text-center">
                                    {t("No orders found.")}
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
                                        <Badge className={`${getStatusColor(order.status)} border-0 font-semibold shadow-none`}>
                                            {order.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                            {Array.isArray(order.tags) ? order.tags.map(tag => (
                                                <span key={tag} className="text-[10px] bg-muted px-1 rounded border">
                                                    {String(tag)}
                                                </span>
                                            )) : (typeof (order.tags as any) === 'string' && (order.tags as any).length > 0 ? (
                                                <span className="text-[10px] bg-muted px-1 rounded border">
                                                    {String(order.tags)}
                                                </span>
                                            ) : null)}
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
