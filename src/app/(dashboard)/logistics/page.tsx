"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency, cn } from "@/lib/utils";
import { syncStatusToEasyOrders } from "@/lib/easyorders";
import { processOrderForVrobo } from "@/lib/vrobo/api";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { useBarcodeScanner, useScanFeedback } from "@/hooks/use-barcode-scanner";
import { STOCK_OUT_STATUSES } from "@/lib/inventory";

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
import { Loader2, Package, AlertCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/date-range-picker";
import { subDays, format } from "date-fns";

import { FilterX, Upload, X, ScanLine, Check, Send } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusOverview } from "@/components/logistics/status-overview";
import { TurboSendDialog } from "@/components/logistics/turbo-send-dialog";
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


import { Suspense } from "react";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { ShippingSyncModal } from "@/components/shipping-sync-modal";
import { CourierPerformance, DailyOutcomes, GovernoratePerformance, LogisticsScoreboard, TransitAging } from "@/components/logistics/logistics-analytics";

// The same typeface as the dashboard: Arabic and Latin drawn to match.
const plex = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], display: "swap" });

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

    const { t, language } = useLanguage();
    const ar = language !== "en";
    const c = (a: string, e: string) => (ar ? a : e);
    const [tab, setTab] = useState<"orders" | "analytics">("orders");
    // Turbo: send the selected orders as shipments (only where it is set up).
    const turboEnabled = !!activeBusiness?.theme_config?.integrations?.shipping?.turbo?.enabled;
    const [turboOpen, setTurboOpen] = useState(false);
    const [turboIds, setTurboIds] = useState<string[]>([]);
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

    // --- scanner mode -----------------------------------------------------
    const [scannerOn, setScannerOn] = useState(false);
    const [scanLog, setScanLog] = useState<{ code: string; ok: boolean; label: string }[]>([]);
    const beep = useScanFeedback();

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
                    // Only the columns this page reads — was "*", about a
                    // third more data on every load and every refresh.
                    .select(`
                        id, created_at, status, status_changed_at, customer_info, easyorders_id, shipping_company_id,
                        restock_on_return, shipping_cost, total_amount, paid_amount, payment_status,
                        tags, notes, channel, order_type,
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
                        // The system's reference, as printed on the waybill —
                        // never the EasyOrders id, a UUID nobody can match.
                        reference: oid.substring(0, 8),
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
    // Every filter, or every filter but the status one: the status tiles count
    // from the latter, so picking a status does not zero the others.
    const passesFilters = (order: any, withStatus: boolean) => {
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
        if (withStatus && statusFilter.length > 0 && !statusFilter.includes(order.status)) return false;

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
    };
    const filteredOrders = orders.filter(o => passesFilters(o, true));
    const ordersAnyStatus = orders.filter(o => passesFilters(o, false));

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

    /**
     * A barcode came in. Find the order and tick it.
     *
     * Matched against every loaded order rather than the filtered view: an
     * order that exists but is hidden by the current filters must not report
     * itself as "not found" — that reads as missing data and sends someone
     * hunting for a parcel that is sitting right there. It gets selected and
     * the mismatch is called out instead.
     *
     * The waybill this system prints carries `order.id.slice(0, 8)` (see
     * orders/print), so that prefix is the primary match. The others cover
     * labels that came from somewhere else.
     */
    const handleScan = useCallback((raw: string) => {
        const code = raw.trim().toLowerCase();
        if (!code) return;

        const digits = code.replace(/\D/g, "");
        const match = orders.find(o => {
            const id = String(o.id || "").toLowerCase();
            if (id === code || id.startsWith(code)) return true;
            if (o.easyorders_id && String(o.easyorders_id).toLowerCase() === code) return true;
            // Some couriers print the recipient's phone as the only barcode.
            const phone = String(o.customer_info?.phone || "").replace(/\D/g, "");
            if (digits.length >= 8 && phone && phone === digits) return true;
            return false;
        });

        if (!match) {
            beep(false);
            setScanLog(prev => [{ code: raw, ok: false, label: t("No order matches this code") }, ...prev].slice(0, 40));
            toast.error(`${t("No order found for")} ${raw}`);
            return;
        }

        const name = match.customer_info?.name || t("Customer");

        if (selectedOrders.has(match.id)) {
            // Scanning the same parcel twice is a real thing at a packing
            // bench. Say so rather than silently doing nothing.
            beep(true);
            setScanLog(prev => [{ code: raw, ok: true, label: `${name} — ${t("already selected")}` }, ...prev].slice(0, 40));
            toast.info(`${name} — ${t("already selected")}`);
            return;
        }

        setSelectedOrders(prev => new Set(prev).add(match.id));
        beep(true);
        setScanLog(prev => [{ code: raw, ok: true, label: `${name} · ${match.status}` }, ...prev].slice(0, 40));

        const hidden = !filteredOrders.some(o => o.id === match.id);
        if (hidden) {
            toast.warning(`${name} — ${t("selected, but hidden by the current filters")}`);
        } else {
            toast.success(`${name} · ${match.status}`);
            // Bring it into view so the tick is visible on a long list.
            requestAnimationFrame(() => {
                document.querySelector(`[data-order-row="${match.id}"]`)
                    ?.scrollIntoView({ block: "center", behavior: "smooth" });
            });
        }
    }, [orders, filteredOrders, selectedOrders, beep, t]);

    useBarcodeScanner({ enabled: scannerOn, onScan: handleScan });

    // 2. Net Value (Total - Shipping - 10)
    const calculateNetValue = (order: any) => {
        return Math.max(0, (order.total_amount || 0) - (order.shipping_cost || 0) - 10);
    };

    const filtersOn = !!searchQuery || govFilter.length > 0 || statusFilter.length > 0 || productFilter.length > 0
        || companyFilter.length > 0 || !!phoneFilter?.length;


    // How the period reads above the numbers.
    const fmtDay = (d: string) => new Intl.DateTimeFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "long" }).format(new Date(`${d}T12:00:00`));
    const periodTitle = fromDate && toDate ? (fromDate === toDate ? fmtDay(fromDate) : c(`من ${fmtDay(fromDate)} لـ ${fmtDay(toDate)}`, `${fmtDay(fromDate)} to ${fmtDay(toDate)}`)) : "";

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
                    <Button
                        variant={scannerOn ? "default" : "outline"}
                        onClick={() => {
                            const next = !scannerOn;
                            setScannerOn(next);
                            if (next) {
                                // Scanning ticks rows in the orders table.
                                setTab("orders");
                                // The scanner types wherever the caret is, so a
                                // focused search box would swallow the barcode.
                                (document.activeElement as HTMLElement)?.blur?.();
                                setScanLog([]);
                                toast.success(t("Scanner mode on — scan a waybill"));
                            }
                        }}
                        className="gap-2"
                    >
                        <ScanLine className="h-4 w-4" />
                        {scannerOn ? t("Scanner on") : t("Scanner mode")}
                    </Button>
                    {activeBusiness && (
                        <ShippingSyncModal businessId={activeBusiness.id} onSyncComplete={fetchOrders} />
                    )}
                    <DateRangePicker />
                </div>
            </div>

            {scannerOn && (
                <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <span className="relative flex h-3 w-3">
                                <span className="animate-ping absolute h-full w-full rounded-full bg-primary/60" />
                                <span className="relative rounded-full h-3 w-3 bg-primary" />
                            </span>
                            <div>
                                <p className="font-bold text-sm">{t("Scanner mode is on")}</p>
                                <p className="text-xs text-muted-foreground">
                                    {t("Scan a waybill and its order is ticked automatically. Keep the cursor out of text boxes — click here first if you have been typing.")}
                                </p>
                            </div>
                        </div>
                        <div className="text-right shrink-0">
                            <p className="text-2xl font-black text-primary tabular-nums">{selectedOrders.size}</p>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{t("Selected")}</p>
                        </div>
                    </div>

                    {scanLog.length > 0 && (
                        <div className="max-h-40 overflow-y-auto rounded-lg border bg-background divide-y">
                            {scanLog.map((sc, i) => (
                                <div key={`${sc.code}-${i}`} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                                    {sc.ok
                                        ? <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                        : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                                    <span className="font-mono text-[11px] text-muted-foreground shrink-0">{sc.code}</span>
                                    <span className={cn("truncate", !sc.ok && "text-red-500")}>{sc.label}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setScanLog([])}
                                disabled={scanLog.length === 0}>
                            {t("Clear list")}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setSelectedOrders(new Set())}
                                disabled={selectedOrders.size === 0}>
                            {t("Deselect all")}
                        </Button>
                        <span className="text-xs text-muted-foreground ms-auto">
                            {t("Set the status for everything selected from the bar below.")}
                        </span>
                    </div>
                </div>
            )}

            {/* Two tabs: the orders the warehouse works through, as the page
                always was, and the analytics, Arabic and right to left like the
                dashboard. Both read the same filtered orders. */}
            <Tabs value={tab} onValueChange={v => setTab(v as "orders" | "analytics")} className="space-y-6">
                <TabsList className="h-11">
                    <TabsTrigger value="orders" className="px-5 text-sm">{c("الأوردرات", "Orders")}</TabsTrigger>
                    <TabsTrigger value="analytics" className="px-5 text-sm">{c("التحليلات", "Analytics")}</TabsTrigger>
                </TabsList>

                <TabsContent value="orders" className="mt-0 space-y-6">
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
                            {turboEnabled && (
                                <Button size="sm" className="h-8 gap-1.5 bg-orange-500 hover:bg-orange-600" onClick={() => { setTurboIds(Array.from(selectedOrders)); setTurboOpen(true); }}>
                                    <Send className="h-3.5 w-3.5" />{c("ابعت لتربو", "Send to Turbo")}
                                </Button>
                            )}
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

            {/* Totals and how many orders are in each status */}
            <StatusOverview orders={filteredOrders} statusOrders={ordersAnyStatus} statuses={STATUSES} netValue={calculateNetValue} t={t}
                            selected={statusFilter}
                            onToggle={st => setStatusFilter(prev => (prev.length === 1 && prev[0] === st ? [] : [st]))} />

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
                                <TableRow key={order.id} data-order-row={order.id} data-state={selectedOrders.has(order.id) ? "selected" : ""}>
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
                </TabsContent>

                <TabsContent value="analytics" className="mt-0">
                <div className={cn(plex.className, "space-y-4")} dir={ar ? "rtl" : "ltr"}>
                    <p className="text-sm text-muted-foreground">
                        {periodTitle}
                        {filtersOn && <span className="ms-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{c("الأرقام حسب الفلتر", "Figures follow the filters")}</span>}
                    </p>
                    <LogisticsScoreboard orders={filteredOrders} ar={ar} />
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                        <div className="min-w-0 lg:col-span-3"><CourierPerformance orders={filteredOrders} companies={shippingCompanies} ar={ar} /></div>
                        <div className="min-w-0 lg:col-span-2"><TransitAging orders={filteredOrders} ar={ar} /></div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                        <div className="min-w-0 lg:col-span-3"><DailyOutcomes orders={filteredOrders} ar={ar} /></div>
                        <div className="min-w-0 lg:col-span-2"><GovernoratePerformance orders={filteredOrders} ar={ar} /></div>
                    </div>
                </div>
                </TabsContent>
            </Tabs>

            {turboEnabled && activeBusiness && (
                <TurboSendDialog open={turboOpen} onOpenChange={setTurboOpen} businessId={activeBusiness.id}
                                 orderIds={turboIds} onSent={fetchOrders} />
            )}

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
