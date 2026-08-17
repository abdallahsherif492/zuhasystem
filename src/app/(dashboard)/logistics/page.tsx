"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { syncStatusToEasyOrders } from "@/lib/easyorders";
import { processOrderForVrobo } from "@/lib/vrobo/api";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { STOCK_OUT_STATUSES } from "@/lib/inventory";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
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
import { Loader2, ArrowRight, TrendingUp, TrendingDown, Package, CheckCircle, AlertCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/date-range-picker";
import { startOfDay, endOfDay, subDays, format } from "date-fns";
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
    BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';

import { ChevronsUpDown, FilterX, Truck, Upload, X } from "lucide-react";
import Papa from "papaparse";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelect, Option } from "@/components/ui/multi-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const GOVERNORATES = [
    "Cairo", "New Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
].sort();

const GOV_OPTIONS: Option[] = [
    { label: "All Except Cairo & Giza", value: "ALL_EXCEPT_CAIRO_GIZA" },
    ...GOVERNORATES.map(g => ({ label: g, value: g }))
];

const STATUSES = [
    "Pending",
    "Processing",
    "Prepared",
    "Hold To redeliver",
    "Shipped",
    "Delivered",
    "Collected",
    "Returning",
    "Cancelled",
    "Unavailable",
    "Returned",
];

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#d0ed57'];

import { Suspense } from "react";
import { ShippingSyncModal } from "@/components/shipping-sync-modal";

export default function LogisticsPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <LogisticsDashboard />
        </Suspense>
    );
}

function LogisticsDashboard() {
    return (
        <LogisticsContent />
    );
}

import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActionFeedback } from "@/contexts/ActionFeedbackContext";

function LogisticsContent() {
    const { activeBusiness, currentUser } = useBusiness();

    const { t } = useLanguage();
    const { startAction, completeAction, failAction } = useActionFeedback();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters & Selection
    const [searchQuery, setSearchQuery] = useState("");
    const [govFilter, setGovFilter] = useState<string[]>([]);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [productFilter, setProductFilter] = useState<string[]>([]);
    const [companyFilter, setCompanyFilter] = useState<string[]>([]);
    const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

    // Data for Filters/Actions
    const [productsOptions, setProductsOptions] = useState<Option[]>([]);
    const [shippingCompanies, setShippingCompanies] = useState<any[]>([]);

    // Dialog State
    const [shippingDialogOpen, setShippingDialogOpen] = useState(false);
    const [pendingStatusChange, setPendingStatusChange] = useState<{ orderIds: string[], status: string } | null>(null);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
    const [phoneFilter, setPhoneFilter] = useState<string[] | null>(null);

    // Confirmation Dialog State
    const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
    const [pendingConfirmAction, setPendingConfirmAction] = useState<(() => void) | null>(null);
    const [confirmDialogContent, setConfirmDialogContent] = useState({ title: "", description: "" });

    // Returning stock is a physical question, not a policy one — a parcel can
    // come back intact, damaged, or not at all. Ask per return instead of
    // assuming, which previously forced a manual stock correction afterwards.
    const [returnDialogOpen, setReturnDialogOpen] = useState(false);
    const [pendingReturn, setPendingReturn] = useState<string[]>([]);

    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    useEffect(() => {
        if (!fromDate || !toDate) {
            const end = new Date();
            const start = subDays(end, 30);
            router.replace(`?from=${format(start, "yyyy-MM-dd")}&to=${format(end, "yyyy-MM-dd")}`);
            return;
        }

        fetchOrders();
        fetchProducts();
        fetchShippingCompanies();
    }, [fromDate, toDate, router]);

    async function fetchProducts() {
        if (!activeBusiness) return;
        const { data } = await supabase.from('products').select('id, name').eq('business_id', activeBusiness.id).order('name');
        if (data) {
            setProductsOptions(data.map(p => ({ label: p.name, value: p.id })));
        }
    }

    async function fetchShippingCompanies() {
        if (!activeBusiness) return;
        const { data } = await supabase.from('shipping_companies').select('*').eq('business_id', activeBusiness.id).eq('active', true).order('name');
        setShippingCompanies(data || []);
    }

    async function fetchOrders() {
        if (!activeBusiness) return;
        try {
            setLoading(true);
            let allOrders: any[] = [];
            let from = 0;
            const step = 1000;
            let hasMore = true;

            while (hasMore) {
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
                    .eq('business_id', activeBusiness.id)
                    .order("created_at", { ascending: false })
                    .range(from, from + step - 1);

                if (fromDate) {
                    query = query.gte("created_at", fromDate);
                }
                if (toDate) {
                    const end = new Date(toDate);
                    end.setHours(23, 59, 59, 999);
                    query = query.lte("created_at", end.toISOString());
                }

                const { data, error } = await query;
                if (error) throw error;

                if (data && data.length > 0) {
                    allOrders = [...allOrders, ...data];
                    if (data.length < step) {
                        hasMore = false;
                    } else {
                        from += step;
                    }
                } else {
                    hasMore = false;
                }
            }
            setOrders(allOrders);
        } catch (error) {
            console.error("Error fetching orders:", error);
        } finally {
            setLoading(false);
        }
    }

    // --- Update Logic ---

    const initiateStatusChange = (orderId: string, newStatus: string) => {
        // Returning asks about stock first; nothing else needs to.
        if (newStatus === "Returned") {
            setPendingReturn([orderId]);
            setReturnDialogOpen(true);
            return;
        }

        const action = () => {
            if (newStatus === "Shipped") {
                const order = orders.find(o => o.id === orderId);
                if (order && !order.shipping_company_id) {
                    setPendingStatusChange({ orderIds: [orderId], status: newStatus });
                    setShippingDialogOpen(true);
                    return;
                }
            }
            executeStatusUpdate([orderId], newStatus);
        };

        const order = orders.find(o => o.id === orderId);
        // Uses the same set the database uses to decide stock movement, so the
        // warning can never disagree with what actually happens.
        const isDeductingAction = order
            && !STOCK_OUT_STATUSES.includes((order.status || "").toLowerCase().trim())
            && STOCK_OUT_STATUSES.includes((newStatus || "").toLowerCase().trim());

        if (isDeductingAction) {
            setConfirmDialogContent({
                title: "Deduct Stock?",
                description: `Moving this order to ${newStatus} will permanently deduct stock from the system. Do you want to proceed?`
            });
            setPendingConfirmAction(() => action);
            setConfirmDialogOpen(true);
        } else {
            action();
        }
    };

    const executeStatusUpdate = async (
        orderIds: string[],
        newStatus: string,
        companyId?: string,
        restockOnReturn?: boolean,
    ) => {
        try {
            startAction(`Updating ${orderIds.length} orders...`);
            const payload: any = { status: newStatus };
            if (companyId) payload.shipping_company_id = companyId;

            // Set explicitly on every return, not just when declining: a stale
            // false from an earlier return would otherwise silently suppress a
            // restock the operator asked for this time.
            if (newStatus === "Returned") {
                payload.restock_on_return = restockOnReturn !== false;
            }

            const { error } = await supabase
                .from("orders")
                .update(payload)
                .eq("business_id", activeBusiness!.id)
                .in("id", orderIds);

            if (error) {
                if (/restock_on_return/.test(error.message)) {
                    throw new Error(
                        "لسه متعملش الميجريشن بتاع المخزون. شغّل supabase/migrations/20260730_optional_restock_on_return.sql"
                    );
                }
                throw error;
            }

            // Stock movement is now owned by the database trigger on
            // orders.status — the UPDATE above already applied it, idempotently
            // and for every order regardless of which path changed the status.
            // This loop only fires the side integrations.
            // One log entry for the whole batch rather than one per order.
            // Marking 50 orders shipped used to write 50 rows and push
            // everything else off the actions log; the orders are carried in
            // metadata so the entry can still be opened to see exactly which.
            if (activeBusiness) {
                const affected = orderIds.map(oid => {
                    const o = orders.find(x => x.id === oid);
                    return {
                        id: oid,
                        reference: (o as any)?.easyorders_id || oid.substring(0, 8),
                        customer: (o?.customer_info as any)?.name || "Customer",
                        from: o?.status ?? null,
                    };
                });

                const distinctFrom = Array.from(new Set(affected.map(a => a.from).filter(Boolean)));
                const fromLabel = distinctFrom.length === 1
                    ? distinctFrom[0]
                    : `${distinctFrom.length} different statuses`;

                if (affected.length === 1) {
                    const a = affected[0];
                    logBusinessAction({
                        businessId: activeBusiness.id,
                        userEmail: currentUser?.email || "Staff",
                        actionType: "update_status",
                        entityType: "order",
                        entityId: a.id,
                        entityName: `Order #${a.reference} (${a.customer})`,
                        changes: [{ field: "Status", old_value: a.from, new_value: newStatus }],
                        metadata: companyId ? { shipping_company_id: companyId } : {},
                    });
                } else {
                    logBusinessAction({
                        businessId: activeBusiness.id,
                        userEmail: currentUser?.email || "Staff",
                        actionType: "update_status",
                        entityType: "order",
                        entityId: orderIds[0],
                        entityName: `${affected.length} orders → ${newStatus}`,
                        changes: [{ field: "Status", old_value: fromLabel, new_value: newStatus }],
                        metadata: {
                            bulk: true,
                            count: affected.length,
                            new_status: newStatus,
                            from_statuses: distinctFrom,
                            shipping_company_id: companyId || null,
                            orders: affected,
                        },
                    });
                }
            }

            for (const oid of orderIds) {
                const order = orders.find(o => o.id === oid);
                if (!order) continue;

                // Sync with EasyOrders if applicable
                if (activeBusiness) {
                    syncStatusToEasyOrders(oid, newStatus, activeBusiness.id).catch(err => {

                        console.error("Failed to sync status to EasyOrders:", err);
                    });
                }

                // VROBO Integration for problematic orders
                if (newStatus === "Returning" || newStatus === "Hold To redeliver") {
                    console.log(`[VROBO] Initiating sync for order ${oid}...`);
                    processOrderForVrobo(oid).then(res => {
                        console.log(`[VROBO] Result for ${oid}:`, res);
                    }).catch(err => {
                        console.error("[VROBO] Failed to process VROBO sync for logistics update:", err);
                    });
                }
            }

            completeAction("Orders updated successfully");
            setOrders(prev => prev.map(o => orderIds.includes(o.id) ? { ...o, status: newStatus, shipping_company_id: companyId || o.shipping_company_id } : o));

            // Clear selection and dialogs
            if (orderIds.length > 1) setSelectedOrders(new Set());
            setShippingDialogOpen(false);
            setPendingStatusChange(null);
            setSelectedCompanyId("");

        } catch (error) {
            console.error("Failed to update status", error);
            failAction("Failed to update orders");
        }
    };

    const confirmShippingAssignment = () => {
        if (!selectedCompanyId) {
            toast.error("Please select a shipping company");
            return;
        }
        if (pendingStatusChange) {
            executeStatusUpdate(pendingStatusChange.orderIds, pendingStatusChange.status, selectedCompanyId);
        }
    };

    const handleBulkStatusChange = (status: string) => {
        const ids = Array.from(selectedOrders);
        if (ids.length === 0) return;

        // Same question as the single-order path, asked once for the batch.
        if (status === "Returned") {
            setPendingReturn(ids);
            setReturnDialogOpen(true);
            return;
        }

        const action = () => {
            if (status === "Shipped") {
                setPendingStatusChange({ orderIds: ids, status });
                setShippingDialogOpen(true);
            } else {
                executeStatusUpdate(ids, status);
            }
        };

        const target = (status || "").toLowerCase().trim();
        const hasStockInOrders = ids.some(id => {
            const s = orders.find(o => o.id === id)?.status;
            return s && !STOCK_OUT_STATUSES.includes(s.toLowerCase().trim());
        });
        const isDeductingAction = hasStockInOrders && STOCK_OUT_STATUSES.includes(target);

        if (isDeductingAction) {
            setConfirmDialogContent({
                title: "Deduct Stock?",
                description: `Moving ${ids.length} orders from Pending/Processing/Cancelled to ${status} will permanently deduct stock from the system. Do you want to proceed?`
            });
            setPendingConfirmAction(() => action);
            setConfirmDialogOpen(true);
        } else {
            if (confirm(`Update ${ids.length} orders to ${status}?`)) {
                action();
            }
        }
    };

    const updateShippingCompany = async (orderId: string, companyId: string) => {
        try {
            startAction("Assigning shipping company...");
            const { error } = await supabase
                .from("orders")
                .update({ shipping_company_id: companyId || null }) // null if empty string
                .eq("business_id", activeBusiness!.id)
                .eq("id", orderId);

            if (error) throw error;

            completeAction("Shipping company updated");
            setOrders(prev => prev.map(o => o.id === orderId ? { ...o, shipping_company_id: companyId || null } : o));
        } catch (error) {
            console.error("Failed to update shipping company", error);
            failAction("Failed to update shipping company");
        }
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            skipEmptyLines: true,
            header: false,
            complete: (results: any) => {
                const phones = new Set<string>();
                results.data.forEach((row: any) => {
                    const values = Array.isArray(row) ? row : Object.values(row);
                    values.forEach((val: any) => {
                        if (val && typeof val === 'string') {
                            let clean = val.replace(/\D/g, '');
                            // Normalize Egyptian phones
                            if (clean.startsWith('20')) clean = clean.slice(2);
                            if (clean.length === 10 && clean.startsWith('1')) clean = '0' + clean;

                            if (clean.length >= 10 && clean.length <= 15) {
                                phones.add(clean);
                            }
                        }
                    });
                });

                if (phones.size > 0) {
                    setPhoneFilter(Array.from(phones));
                    toast.success(`Loaded ${phones.size} phone numbers`);
                } else {
                    toast.error("No valid phone numbers found");
                }
            }
        });
    };

    // --- Calculations & Filters ---

    // 1. Filter Logic
    const filteredOrders = orders.filter(order => {
        // Search
        // Search
        if (searchQuery) {
            const terms = searchQuery.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
            const matches = terms.some(q =>
                order.id.toLowerCase().includes(q) ||
                order.customer_info?.name?.toLowerCase().includes(q) ||
                order.customer_info?.phone?.includes(q)
            );
            if (!matches) return false;
        }

        // Gov Filter
        if (govFilter.length > 0) {
            const gov = order.customer_info?.governorate || "";
            const hasAllExcept = govFilter.includes("ALL_EXCEPT_CAIRO_GIZA");

            if (hasAllExcept) {
                if (gov === "Cairo" || gov === "Giza") {
                    if (!govFilter.includes(gov)) return false;
                }
            } else {
                if (!govFilter.includes(gov)) return false;
            }
        }

        // Status Filter
        if (statusFilter.length > 0 && !statusFilter.includes(order.status)) return false;

        // Company Filter
        if (companyFilter.length > 0) {
            if (!order.shipping_company_id || !companyFilter.includes(order.shipping_company_id)) return false;
        }

        // Product Filter
        if (productFilter.length > 0) {
            const orderProductIds = order.items?.map((i: any) => i.variant?.product?.id).filter(Boolean) || [];
            const hasMatch = productFilter.some(pid => orderProductIds.includes(pid));
            if (!hasMatch) return false;
        }

        // Phone List Filter
        if (phoneFilter && phoneFilter.length > 0) {
            let orderPhone = order.customer_info?.phone?.replace(/\D/g, '') || '';
            if (orderPhone.startsWith('20')) orderPhone = orderPhone.slice(2);
            if (orderPhone.length === 10 && orderPhone.startsWith('1')) orderPhone = '0' + orderPhone;

            const match = phoneFilter.includes(orderPhone);
            if (!match) return false;
        }

        return true;
    });

    // Selection Handlers
    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedOrders(new Set(filteredOrders.map(o => o.id)));
        } else {
            setSelectedOrders(new Set());
        }
    };

    const handleSelectRow = (id: string, checked: boolean) => {
        const newSet = new Set(selectedOrders);
        if (checked) newSet.add(id);
        else newSet.delete(id);
        setSelectedOrders(newSet);
    };

    // 2. Net Value (Total - Shipping - 10)
    const calculateNetValue = (order: any) => {
        return Math.max(0, (order.total_amount || 0) - (order.shipping_cost || 0) - 10);
    };

    // 3. Metrics Breakdown (use filteredOrders)
    const metrics = STATUSES.map(status => {
        const statusOrders = filteredOrders.filter(o => o.status === status);
        const count = statusOrders.length;
        // Summing the Net Value instead of Gross Total
        const netValue = statusOrders.reduce((acc, o) => acc + calculateNetValue(o), 0);
        return { status, count, netValue };
    });

    // 4. Grouped Stats
    const wonStatuses = ['Delivered', 'Collected'];
    const lostStatuses = ['Cancelled', 'Unavailable', 'Returned'];
    const remainingStatuses = ['Pending', 'Prepared', 'Shipped'];

    const getGroupStats = (statuses: string[]) => {
        const groupOrders = filteredOrders.filter(o => statuses.includes(o.status));
        return {
            count: groupOrders.length,
            value: groupOrders.reduce((acc, o) => acc + calculateNetValue(o), 0)
        };
    };

    const wonStats = getGroupStats(wonStatuses);
    const lostStats = getGroupStats(lostStatuses);
    const remainingStats = getGroupStats(remainingStatuses);

    // Overall Stats
    const totalOrders = filteredOrders.length;
    // Won Rate (Delivered + Collected) / Total
    const wonRate = totalOrders > 0 ? (wonStats.count / totalOrders) * 100 : 0;
    const returnRate = totalOrders > 0 ? (lostStats.count / totalOrders) * 100 : 0; // Assuming lostStats includes returned

    // 4. Chart Data: Status Distribution (Pie)
    const pieData = metrics.filter(m => m.count > 0).map(m => ({
        name: m.status,
        value: m.count
    }));

    // 5. Chart Data: Daily Trends (Bar)
    const dailyDataMap = new Map();
    filteredOrders.forEach(order => {
        const date = format(new Date(order.created_at), 'MM/dd');
        if (!dailyDataMap.has(date)) {
            dailyDataMap.set(date, { date, orders: 0, delivered: 0, collected: 0, lost: 0 });
        }
        const data = dailyDataMap.get(date);
        data.orders += 1;

        if (order.status === 'Delivered') data.delivered += 1;
        if (order.status === 'Collected') data.collected += 1;
        if (lostStatuses.includes(order.status)) data.lost += 1;
    });
    // Sort by date
    const barData = Array.from(dailyDataMap.values()).reverse();

    // 6. Top Governorates (Keep as is)
    const govMap = new Map();
    filteredOrders.forEach(order => {
        const gov = order.customer_info?.governorate || 'Unknown';
        if (!govMap.has(gov)) govMap.set(gov, 0);
        govMap.set(gov, govMap.get(gov) + 1);
    });
    const topGovs = Array.from(govMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);


    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <h1 className="text-3xl font-bold tracking-tight">{t("Logistics")}</h1>
                </div>
                <div className="flex items-center gap-2 bg-background">
                    {activeBusiness && (
                        <ShippingSyncModal businessId={activeBusiness.id} onSyncComplete={fetchOrders} />
                    )}
                    <DateRangePicker />
                </div>
            </div>

            {/* Filters Bar */}
            <div id="logistics-filters" className="bg-muted/40 p-4 rounded-lg space-y-4">
                {/* Stacks until lg. Squeezing the search box and four filter
                    dropdowns onto one line only works on a wide desktop; below
                    that the row overflowed and took the page with it. */}
                <div className="flex flex-col lg:flex-row gap-4">
                    {/* min-w-0 on both flex-1 children: without it the four filter
                        dropdowns hold the row open at their placeholder width and
                        the search box can never give ground. */}
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder={t("Search orders (comma separated for multiple)...")}
                            className="pl-8 bg-white"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1 min-w-0">
                        <MultiSelect
                            options={STATUSES.map(s => ({ label: s, value: s }))}
                            selected={statusFilter}
                            onChange={setStatusFilter}
                            placeholder={t("Status")}
                            className="bg-white"
                        />
                        <MultiSelect
                            options={GOV_OPTIONS}
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
                        <MultiSelect
                            options={shippingCompanies.map(c => ({ label: c.name, value: c.id }))}
                            selected={companyFilter}
                            onChange={setCompanyFilter}
                            placeholder={t("Shipping Company")}
                            className="bg-white"
                        />
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => { setSearchQuery(""); setGovFilter([]); setProductFilter([]); setStatusFilter([]); setCompanyFilter([]); }}>
                        <FilterX className="h-4 w-4" />
                    </Button>
                </div>

                {selectedOrders.size > 0 && (
                    <div className="flex items-center justify-between bg-primary/10 p-2 rounded px-4">
                        <span className="text-sm font-medium text-primary">{selectedOrders.size} {t("Selected")}</span>
                        <div className="flex items-center gap-2">
                            <Select onValueChange={handleBulkStatusChange}>
                                <SelectTrigger className="w-[180px] h-8 bg-white">
                                    <SelectValue placeholder={t("Bulk Action")} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Pending">Mark Pending</SelectItem>
                                    <SelectItem value="Processing">Mark Processing</SelectItem>
                                    <SelectItem value="Prepared">Mark Prepared</SelectItem>
                                    <SelectItem value="Shipped">Mark Shipped</SelectItem>
                                    <SelectItem value="Delivered">Mark Delivered</SelectItem>
                                    <SelectItem value="Collected">Mark Collected</SelectItem>
                                    <SelectItem value="Returned">Mark Returned</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                )}

                {/* Phone Filter CSV */}
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <input
                            type="file"
                            accept=".csv"
                            id="csv-upload"
                            className="hidden"
                            onChange={handleFileUpload}
                        />
                        <Button variant="outline" size="sm" onClick={() => document.getElementById('csv-upload')?.click()}>
                            <Upload className="h-4 w-4 mr-2" />
                            {phoneFilter ? `${t("Filtered")} (${phoneFilter.length} ${t("phones")})` : t("Upload Phones CSV")}
                        </Button>
                    </div>
                    {phoneFilter && (
                        <Button variant="ghost" size="icon" onClick={() => { setPhoneFilter(null); if (document.getElementById('csv-upload')) (document.getElementById('csv-upload') as HTMLInputElement).value = '' }}>
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Top KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t("Total Orders")}</CardTitle>
                        <Package className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalOrders}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t("Won Value (Rate)")}</CardTitle>
                        <CheckCircle className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{formatCurrency(wonStats.value)}</div>
                        <p className="text-xs text-muted-foreground">
                            {wonStats.count} {t("Orders")} ({wonRate.toFixed(1)}%)
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t("Lost Value")}</CardTitle>
                        <AlertCircle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{formatCurrency(lostStats.value)}</div>
                        <p className="text-xs text-muted-foreground">{lostStats.count} {t("Orders")}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t("Remaining")}</CardTitle>
                        <TrendingUp className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-primary">{formatCurrency(remainingStats.value)}</div>
                        <p className="text-xs text-muted-foreground">{remainingStats.count} {t("Orders")} ({t("Pending/Ship")})</p>
                    </CardContent>
                </Card>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Status Distribution */}
                <Card>
                    <CardHeader>
                        <CardTitle>{t("Order Status Distribution")}</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(val: any) => [val, 'Orders']} />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Performance Trend */}
                <Card>
                    <CardHeader>
                        <CardTitle>{t("Daily Status Breakdown")}</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={barData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="delivered" name="Delivered" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
                                <Bar dataKey="collected" name="Collected" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                                <Bar dataKey="lost" name="Lost" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Top Governorates */}
                <Card>
                    <CardHeader>
                        <CardTitle>{t("Top Regions")}</CardTitle>
                        <CardDescription>{t("Highest volume governorates")}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {topGovs.map((gov, i) => (
                                <div key={gov.name} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-medium">
                                            {i + 1}
                                        </div>
                                        <span className="text-sm font-medium">{gov.name}</span>
                                    </div>
                                    <Badge variant="secondary">{gov.count}</Badge>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Status Breakdown List */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>{t("Status Breakdown")}</CardTitle>
                        <CardDescription>{t("Net value excludes shipping & fees")}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("Status")}</TableHead>
                                    <TableHead>{t("Count")}</TableHead>
                                    <TableHead className="text-right">{t("Net Value")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {metrics.map((m) => (
                                    <TableRow key={m.status}>
                                        <TableCell>
                                            <Badge variant="outline">{m.status}</Badge>
                                        </TableCell>
                                        <TableCell>{m.count}</TableCell>
                                        <TableCell className="text-right font-medium">
                                            {formatCurrency(m.netValue)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            {/* Complete Orders Table */}
            <Card id="logistics-table">
                <CardHeader>
                    <CardTitle>{t("All Orders")}</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[40px]">
                                    <Checkbox
                                        checked={filteredOrders.length > 0 && selectedOrders.size === filteredOrders.length}
                                        onCheckedChange={handleSelectAll}
                                    />
                                </TableHead>
                                {/* Eight columns need ~800px, and below a wide
                                    desktop that pushed Status and Shipping — the
                                    two columns this page exists to change — off
                                    the right edge behind a scrollbar. The ID and
                                    date are reference, not work, so they fold
                                    away first and the ID reappears under the
                                    customer name so nothing is actually lost. */}
                                <TableHead className="hidden xl:table-cell">{t("Order ID")}</TableHead>
                                <TableHead className="hidden xl:table-cell">{t("Date")}</TableHead>
                                <TableHead>{t("Customer")}</TableHead>
                                <TableHead className="hidden lg:table-cell">{t("Gov")}</TableHead>
                                <TableHead>{t("Status")}</TableHead>
                                <TableHead>{t("Net Value")}</TableHead>
                                <TableHead>{t("Shipping")}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredOrders.map((order) => (
                                <TableRow key={order.id} data-state={selectedOrders.has(order.id) ? "selected" : ""}>
                                    <TableCell>
                                        <Checkbox
                                            checked={selectedOrders.has(order.id)}
                                            onCheckedChange={(c) => handleSelectRow(order.id, c as boolean)}
                                        />
                                    </TableCell>
                                    <TableCell className="hidden xl:table-cell font-mono text-xs">{order.id.slice(0, 8)}</TableCell>
                                    <TableCell className="hidden xl:table-cell">{new Date(order.created_at).toLocaleDateString()}</TableCell>
                                    <TableCell>
                                        <div className="font-medium">{order.customer_info?.name || "N/A"}</div>
                                        <div className="text-xs text-muted-foreground">{order.customer_info?.phone}</div>
                                        <div className="xl:hidden text-xs text-muted-foreground font-mono">
                                            {order.id.slice(0, 8)} · {new Date(order.created_at).toLocaleDateString()}
                                        </div>
                                        <div className="lg:hidden text-xs text-muted-foreground">
                                            {order.customer_info?.governorate || "-"}
                                        </div>
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell">{order.customer_info?.governorate || "-"}</TableCell>
                                    <TableCell>
                                        <select
                                            className="h-8 w-32 rounded-md border border-input bg-transparent px-2 text-xs"
                                            value={order.status}
                                            onChange={(e) => initiateStatusChange(order.id, e.target.value)}
                                        >
                                            {STATUSES.map(s => (
                                                <option key={s} value={s}>{s}</option>
                                            ))}
                                        </select>
                                    </TableCell>
                                    <TableCell>{formatCurrency(calculateNetValue(order))}</TableCell>
                                    <TableCell>
                                        <select
                                            className="h-8 w-auto min-w-[120px] rounded-md border border-input bg-transparent px-2 text-xs"
                                            value={order.shipping_company_id || ""}
                                            onChange={(e) => updateShippingCompany(order.id, e.target.value)}
                                        >
                                            <option value="">No Company</option>
                                            {shippingCompanies.map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Shipping Assignment Dialog */}
            <Dialog open={shippingDialogOpen} onOpenChange={setShippingDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Select Shipping Company</DialogTitle>
                        <DialogDescription>
                            You must assign a courier/company to mark this as Shipped.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Shipping Company</Label>
                            <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select Company" />
                                </SelectTrigger>
                                <SelectContent>
                                    {shippingCompanies.map(c => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShippingDialogOpen(false)}>Cancel</Button>
                        <Button onClick={confirmShippingAssignment}>Confirm & Update</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {/* Return: did the goods actually come back to the shelf? */}
            <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {pendingReturn.length > 1
                                ? `ترجيع ${pendingReturn.length} أوردر`
                                : "ترجيع الأوردر"}
                        </DialogTitle>
                        <DialogDescription>
                            البضاعة رجعت المخزن فعلاً؟ اختار الصح عشان الجرد يفضل مظبوط.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3 py-2">
                        <button
                            onClick={() => {
                                setReturnDialogOpen(false);
                                executeStatusUpdate(pendingReturn, "Returned", undefined, true);
                                setPendingReturn([]);
                            }}
                            className="w-full text-start rounded-xl border-2 p-4 hover:border-primary hover:bg-primary/5 transition-colors"
                        >
                            <div className="font-semibold flex items-center gap-2">
                                <Package className="h-4 w-4 text-green-600" />
                                أيوة، رجّع الكميات للمخزون
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                                البضاعة وصلت المخزن سليمة وتقدر تتباع تاني.
                            </p>
                        </button>

                        <button
                            onClick={() => {
                                setReturnDialogOpen(false);
                                executeStatusUpdate(pendingReturn, "Returned", undefined, false);
                                setPendingReturn([]);
                            }}
                            className="w-full text-start rounded-xl border-2 p-4 hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                        >
                            <div className="font-semibold flex items-center gap-2">
                                <AlertCircle className="h-4 w-4 text-amber-600" />
                                لأ، متزودش المخزون
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                                البضاعة تالفة أو ضايعة أو لسه موصلتش — الأوردر هيتقفل مرتجع
                                والكميات تفضل مخصومة.
                            </p>
                        </button>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setReturnDialogOpen(false); setPendingReturn([]); }}>
                            إلغاء
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Confirmation Dialog */}
            <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{confirmDialogContent.title}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmDialogContent.description}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => { setConfirmDialogOpen(false); setPendingConfirmAction(null); }}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => {
                            if (pendingConfirmAction) pendingConfirmAction();
                            setConfirmDialogOpen(false);
                            setPendingConfirmAction(null);
                        }}>Confirm</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
