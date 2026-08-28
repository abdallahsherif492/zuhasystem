"use client";

import { useEffect, useState, useMemo, Suspense, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, cn } from "@/lib/utils";

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
import { Plus, Loader2, MoreHorizontal, Download, Search, Printer, FilterX, ChevronLeft, ChevronRight, Upload } from "lucide-react";
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
    actual_shipping_cost?: number;
    /** True when the courier fee behind `profit` came from the rate card, not an invoice. */
    shipping_cost_estimated?: boolean;
    order_type?: string;
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
    // The three buckets the RPC normalises to; a null or blank payment_status
    // on an older row counts as Not Paid there, so it is reachable here.
    const [paymentFilter, setPaymentFilter] = useState<string[]>([]);
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
    }, [debouncedSearch, statusFilter, productFilter, govFilter, channelFilter, paymentFilter, shippingCompanyFilter, uploadedOrderFilters, fromDate, toDate, pageSize]);

    useEffect(() => {
        fetchOrders();
    }, [page, pageSize, debouncedSearch, statusFilter, productFilter, govFilter, channelFilter, paymentFilter, shippingCompanyFilter, uploadedOrderFilters, fromDate, toDate, activeBusiness]);

    async function fetchProducts() {
        if (!activeBusiness) return;
        const { data } = await supabase.from('products').select('id, name').eq('business_id', activeBusiness.id).order('name');
        if (data) {
            setProductsOptions(data.map(p => ({ label: p.name, value: p.id })));
        }

        const { data: companies } = await supabase
            .from('shipping_companies')
            .select('id, name')
            .eq('business_id', activeBusiness.id);
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
                p_payment_status: paymentFilter.length > 0 ? paymentFilter : null,
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
                    p_payment_status: paymentFilter.length > 0 ? paymentFilter : null,
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
                "اسم الراسل علي البوليصة": activeBusiness?.name || "eCommerx Home",
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
                "شـــحــنــة اســتــبدال": order.order_type === "replacement" ? "نعم" : order.order_type === "return" ? "استرجاع" : "لا",
                "نوع الأوردر": order.order_type === "replacement" ? "استبدال" : order.order_type === "return" ? "استرجاع" : "عادي",
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
        if (!status || typeof status !== 'string') return 'bg-muted text-foreground hover:bg-muted dark:bg-muted dark:text-muted-foreground';
        switch (status.toLowerCase()) {
            case 'pending': return 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80 dark:bg-yellow-900/50 dark:text-yellow-400';
            case 'processing': return 'bg-primary/20 text-primary hover:bg-primary/20 dark:bg-primary dark:text-primary';
            case 'prepared': return 'bg-primary/20 text-primary hover:bg-primary/20 dark:bg-primary dark:text-primary';
            case 'shipped': return 'bg-primary/20 text-primary hover:bg-primary/20 dark:bg-primary dark:text-primary';
            case 'delivered': return 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100/80 dark:bg-emerald-900/50 dark:text-emerald-400';
            case 'cancelled': return 'bg-red-100 text-red-800 hover:bg-red-100/80 dark:bg-red-900/50 dark:text-red-400';
            case 'returned': return 'bg-orange-100 text-orange-800 hover:bg-orange-100/80 dark:bg-orange-900/50 dark:text-orange-400';
            case 'unavailable': return 'bg-muted text-foreground hover:bg-muted dark:bg-muted dark:text-muted-foreground';
            default: return 'bg-muted text-foreground hover:bg-muted dark:bg-muted dark:text-muted-foreground';
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
        setPaymentFilter([]);
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
                            <Button id="create-order-btn">
                                <Plus className="mr-2 h-4 w-4" /> {t("New Order")}
                            </Button>
                        </Link>
                    </div>
                </div>

                {/* Filters Bar */}
                <div id="orders-filters" className="bg-white p-5 rounded-xl border border-border/50 shadow-sm space-y-5">
                    {/* Top Row: Main Search */}
                    <div className="relative group">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center text-muted-foreground group-focus-within:text-primary transition-colors">
                            <Search className="h-6 w-6" />
                        </div>
                        <Input
                            placeholder={t("Search by name, phone, order id...")}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-muted/10 hover:bg-muted/20 transition-colors pl-14 h-16 text-lg rounded-xl border-muted-foreground/20 focus-visible:ring-2 focus-visible:ring-primary shadow-inner"
                        />
                    </div>

                    {/* Middle Row: Filters and Clear */}
                    <div className="flex flex-col xl:flex-row gap-4 justify-between items-start xl:items-center">
                        <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                            <Select value={shippingCompanyFilter} onValueChange={setShippingCompanyFilter}>
                                <SelectTrigger className="w-full bg-white h-10 rounded-lg">
                                    <SelectValue placeholder={t("Shipping Company")} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{t("All Companies")}</SelectItem>
                                    {shippingCompanies.map(c => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <MultiSelect
                                options={statusOptions}
                                selected={statusFilter}
                                onChange={setStatusFilter}
                                placeholder={t("Status")}
                                className="bg-white h-10 rounded-lg"
                            />
                            <MultiSelect
                                options={channelOptions}
                                selected={channelFilter}
                                onChange={setChannelFilter}
                                placeholder={t("Channel")}
                                className="bg-white h-10 rounded-lg"
                            />
                            <MultiSelect
                                options={govOptions}
                                selected={govFilter}
                                onChange={setGovFilter}
                                placeholder={t("Governorate")}
                                className="bg-white h-10 rounded-lg"
                                showSelectAll={true}
                            />
                            <MultiSelect
                                options={productsOptions}
                                selected={productFilter}
                                onChange={setProductFilter}
                                placeholder={t("Product")}
                                className="bg-white h-10 rounded-lg"
                            />
                            <MultiSelect
                                options={[
                                    { label: t("Paid"), value: "Paid" },
                                    { label: t("Partially Paid"), value: "Partially Paid" },
                                    { label: t("Not Paid"), value: "Not Paid" },
                                ]}
                                selected={paymentFilter}
                                onChange={setPaymentFilter}
                                placeholder={t("Payment")}
                                className="bg-white h-10 rounded-lg"
                            />
                        </div>
                        <Button variant="secondary" size="icon" onClick={clearFilters} title={t("Clear Filters")} className="shrink-0 h-10 w-10 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground">
                            <FilterX className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* Bottom Row: Actions and Stats */}
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-border/50">
                        <div className="text-sm font-medium text-muted-foreground flex items-center bg-muted/30 py-1.5 px-3 rounded-md">
                            <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-sm font-bold mr-2">{totalCount}</span> {t("orders found")}
                            {selectedOrders.size > 0 && <span className="text-primary font-bold ml-2">({selectedOrders.size} {t("selected")})</span>}
                        </div>
                        
                        <div className="flex flex-wrap gap-2 items-center">
                            <input 
                                type="file" 
                                accept=".xlsx, .csv" 
                                className="hidden" 
                                ref={fileInputRef} 
                                onChange={handleFileUpload} 
                            />
                            <Button variant="outline" size="sm" className="bg-white rounded-lg h-9" onClick={() => fileInputRef.current?.click()}>
                                <Upload className="mr-2 h-4 w-4" />
                                {t("Upload Sheet")}
                            </Button>
                            {uploadedOrderFilters.length > 0 && (
                                <Button variant="ghost" size="sm" className="text-destructive rounded-lg bg-destructive/10 hover:bg-destructive/20 h-9" onClick={() => {
                                    setUploadedOrderFilters([]);
                                    if (fileInputRef.current) fileInputRef.current.value = "";
                                }}>
                                    {t("Clear Sheet Filter")}
                                </Button>
                            )}
                            <Button
                                variant={selectedOrders.size > 0 ? "default" : "outline"}
                                size="sm"
                                onClick={handlePrintSelected}
                                disabled={selectedOrders.size === 0}
                                className={cn(
                                    "rounded-lg shadow-sm h-9 gap-1.5 transition-all",
                                    selectedOrders.size > 0 
                                        ? "bg-primary text-primary-foreground hover:bg-primary/90 font-semibold" 
                                        : "border-border text-muted-foreground bg-muted/40 opacity-60"
                                )}
                            >
                                <Printer className="h-4 w-4 shrink-0" />
                                {t("Print Selected")} {selectedOrders.size > 0 ? `(${selectedOrders.size})` : ''}
                            </Button>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={handleExport} 
                                className="rounded-lg shadow-sm border-primary/20 text-primary hover:bg-primary/5 h-9 font-medium"
                            >
                                <Download className="mr-2 h-4 w-4 shrink-0" />
                                {selectedOrders.size > 0 ? t("Export Selected") : t("Export All")}
                            </Button>

                        </div>
                    </div>
                </div>
            </div>

            <div id="orders-table" className="rounded-md border">
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
                                    <TableCell className="font-mono text-xs">
                                        <div className="flex flex-col gap-1">
                                            <span>{order.id.slice(0, 8)}</span>
                                            {order.order_type === 'replacement' && <Badge variant="secondary" className="w-fit text-[10px] bg-green-100 text-green-800 hover:bg-green-100">استبدال</Badge>}
                                            {order.order_type === 'return' && <Badge variant="destructive" className="w-fit text-[10px]">استرجاع</Badge>}
                                        </div>
                                    </TableCell>
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
                                    {/* The sign was hardcoded: a loss rendered as
                                        "+-910 EGP" in green, and 108 orders are
                                        currently negative. Colour and sign now
                                        follow the number.

                                        The asterisk marks a profit resting on an
                                        estimated courier fee rather than a real
                                        invoice — true for most orders, since the
                                        fee was never recorded for anything coming
                                        from EasyOrders and had to be backfilled
                                        from the rate card. */}
                                    <TableCell
                                        className={cn(
                                            "font-medium",
                                            Number(order.profit) < 0 ? "text-red-600" : "text-green-600"
                                        )}
                                        title={
                                            order.shipping_cost_estimated
                                                ? `Includes an estimated courier fee of ${formatCurrency(Number(order.actual_shipping_cost) || 0)} taken from the rate card, not a recorded invoice.`
                                                : undefined
                                        }
                                    >
                                        {Number(order.profit) < 0 ? "" : "+"}{formatCurrency(Number(order.profit) || 0)}
                                        {order.shipping_cost_estimated && (
                                            <span className="text-muted-foreground font-normal ms-0.5" aria-label="estimated shipping">*</span>
                                        )}
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
