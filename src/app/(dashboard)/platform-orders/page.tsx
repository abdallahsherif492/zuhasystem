"use client";

import { useEffect, useState, useMemo, useRef, Suspense } from "react";

import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { ClosedBySelect } from "@/components/orders/closed-by-select";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, normalizeSearchText } from "@/lib/utils";
import { DateRangePicker } from "@/components/date-range-picker";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { ContactActions } from "@/components/orders/contact-actions";
import { RepeatOrdersAlert } from "@/components/orders/repeat-orders";
import { useRepeatOrders } from "@/hooks/use-repeat-orders";
import { Input } from "@/components/ui/input";
import { AutosaveField } from "@/components/ui/autosave-field";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, X, AlertTriangle, Search, PackageSearch, ChevronsUpDown, Repeat, PhoneMissed } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
    AttemptBadge, AttemptHistory, ConfirmTabs, FailedAttemptDialog, LastAttempt, RETRY_AFTER_MIN, minutesSince, stageOf,
    type AttemptSummary, type ConfirmStage,
} from "@/components/orders/confirmation-attempts";

const ORDER_SELECT = `
    *,
    order_items (
        id, variant_id, quantity, price_at_sale, unmapped_name, unmapped_sku,
        variants (
            title, sku, product_id,
            products (name)
        )
    )
`;

/** Waiting, and from a store (EasyOrders or Shopify): what this page lists. */
function isWaitingPlatformOrder(o: { status?: string | null; easyorders_id?: string | null; tags?: unknown }) {
    if (String(o.status || '').trim().toLowerCase() !== 'waiting') return false;
    const tags = o.tags ? JSON.stringify(o.tags).toLowerCase() : "";
    return !!o.easyorders_id || tags.includes("easyorders") || tags.includes("shopify");
}
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface OrderItem {
    id: string;
    variant_id: string | null;
    quantity: number;
    price_at_sale: number;
    unmapped_name?: string;
    unmapped_sku?: string;
    variants?: {
        title: string;
        sku: string;
        product_id: string;
        products: {
            name: string;
        };
    };
}

interface Order {
    id: string;
    customer_info: any;
    status: string;
    subtotal: number;
    total_amount: number;
    shipping_cost: number;
    easyorders_id?: string;
    shopify_id?: string;
    tags?: any;
    payment_status: string;
    paid_amount: number;
    created_at: string;
    closed_by?: string | null;
    notes?: string | null;
    order_items: OrderItem[];
    // Confirmation attempts (20261006_confirmation_attempts.sql)
    confirm_attempts?: number | null;
    last_attempt_at?: string | null;
    last_attempt_reason?: string | null;
    last_attempt_note?: string | null;
    last_attempt_by?: string | null;
}

interface Variant {
    id: string;
    title: string;
    sku: string;
    sale_price: number;
    products: { name: string };
}

const GOVERNORATES = [
    "Cairo", "New Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
];

import { logBusinessAction } from "@/lib/logs/actions-logger";
import { orderLogName } from "@/lib/logs/order-log-name";


function PlatformOrdersContent() {
    const { activeBusiness, currentUser } = useBusiness();
    // Signed on the confirmation message, so it reads as coming from the store
    // the customer ordered from rather than from nobody.
    const storeName = activeBusiness?.name || "متجرنا";

    const { t } = useLanguage();
    
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [variants, setVariants] = useState<Variant[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    
    // Treasury Modal state
    const [depositModalOpen, setDepositModalOpen] = useState(false);
    const [depositOrder, setDepositOrder] = useState<Order | null>(null);
    const [transactionAccount, setTransactionAccount] = useState("");
    const [depositLoading, setDepositLoading] = useState(false);
    const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
    const [platformFilter, setPlatformFilter] = useState<string>("all");
    
    const [addItemOpen, setAddItemOpen] = useState<Record<string, boolean>>({});
    const [selectedProductForAdd, setSelectedProductForAdd] = useState<Record<string, string>>({});
    const [selectedVariantForAdd, setSelectedVariantForAdd] = useState<Record<string, string>>({});
    const [selectedProductOverride, setSelectedProductOverride] = useState<Record<string, string>>({});
    const [selectedItemProduct, setSelectedItemProduct] = useState<Record<string, string>>({});

    
    const searchParams = useSearchParams();
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        if (activeBusiness) {
            fetchOrders();
            fetchVariants();
            fetchProducts();
            fetchAccounts();
        }
    }, [activeBusiness]);

    const fetchAccounts = async () => {
        if (!activeBusiness) return;
        const { data } = await supabase
            .from("financial_accounts")
            .select("id, name")
            .eq("business_id", activeBusiness.id)
            .order("name");
        if (data && data.length > 0) setAccounts(data);
        else setAccounts([{ id: "default", name: "الخزينة الرئيسية" }]);
    };


    const fetchVariants = async () => {
        if (!activeBusiness) return;
        const { data } = await supabase
            .from('variants')
            .select('id, title, sku, sale_price, products!inner(name)')
            .eq('products.business_id', activeBusiness.id);
        if (data) setVariants(data as any[]);
    };

    const fetchProducts = async () => {
        if (!activeBusiness) return;
        const { data, error } = await supabase
            .from('products')
            // sku is needed so the add-product search can match on it
            .select('id, name, variants(id, title, sku, sale_price, cost_price, stock_qty, track_inventory)')
            .eq('business_id', activeBusiness.id)
            .order('name');
        if (error) console.error("Error fetching products:", error);
        if (data) setProducts(data);
    };

    const fetchOrders = async () => {
        setLoading(true);
        if (!activeBusiness) return;
        const { data, error } = await supabase
            .from('orders')
            .select(ORDER_SELECT)
            .eq('business_id', activeBusiness.id)
            .ilike('status', 'waiting')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Error fetching platform orders:", error);
            toast.error(t("Failed to load Platform Orders"));
        } else {
            setOrders((data || []).filter(isWaitingPlatformOrder) as Order[]);
            loadedRef.current = true;
        }

        setLoading(false);
    };

    // -----------------------------------------------------------------
    // Several moderators work this list at once. Each page used to know
    // only what it loaded: an order a colleague had just moved stayed on
    // everyone else's screen until they refreshed, and in the first week of
    // October six orders were moved to Pending twice, by two people,
    // seconds to minutes apart. Three things keep the pages honest now.
    // -----------------------------------------------------------------

    const loadedRef = useRef(false);
    // Orders this page has just taken off the screen and is still saving.
    // The sync must not bring them back while their write is in flight.
    const inFlight = useRef(new Set<string>());

    /**
     * 1. Moving an order out of Waiting only happens while it is still
     * Waiting. If a colleague got there first the update matches no row,
     * which comes back as "gone" instead of a second confirmation. A request
     * that has not answered in 20 seconds is given up on, so a stuck
     * connection shows an error rather than an endless spinner.
     */
    const leaveWaiting = async (orderId: string, updates: Record<string, unknown>): Promise<"done" | "gone"> => {
        const { data, error } = await supabase
            .from('orders')
            .update(updates)
            .eq('business_id', activeBusiness!.id)
            .eq('id', orderId)
            .ilike('status', 'waiting')
            .select('id')
            .abortSignal(AbortSignal.timeout(20_000));
        if (error) throw error;
        return data && data.length ? "done" : "gone";
    };

    /**
     * 2. The card leaves the screen the moment the moderator confirms, not
     * when the database answers; they move straight on to the next order.
     * Returns a function that puts it back where it was if the save fails.
     */
    const takeOut = (orderId: string) => {
        const index = ordersRef.current.findIndex(o => o.id === orderId);
        const removed = ordersRef.current[index];
        inFlight.current.add(orderId);
        setOrders(prev => prev.filter(o => o.id !== orderId));
        return {
            restore: () => {
                inFlight.current.delete(orderId);
                if (!removed) return;
                setOrders(prev => {
                    if (prev.some(o => o.id === orderId)) return prev;
                    const next = [...prev];
                    next.splice(Math.min(index, next.length), 0, removed);
                    return next;
                });
            },
            settle: () => { setTimeout(() => inFlight.current.delete(orderId), 60_000); },
        };
    };

    const saveFailed = (e: unknown, fallback: string) => {
        const name = (e as { name?: string })?.name;
        const message = (e as { message?: string })?.message || "";
        if (name === "AbortError" || name === "TimeoutError" || /abort|timed? ?out/i.test(message)) {
            toast.error("الاتصال بطيء ومش متأكدين إن الحفظ وصل. الأوردر رجع مكانه — لو اختفى بعد شوية يبقى اتحفظ.");
        } else {
            toast.error(fallback);
        }
    };

    /**
     * 3. Every 30 seconds while the page is open and visible, and whenever
     * the moderator comes back to the tab, ask which orders are still
     * Waiting — ids only, a couple of kilobytes. Orders a colleague moved
     * leave the screen; new ones from the store are fetched and added.
     */
    useEffect(() => {
        if (!activeBusiness) return;
        const businessId = activeBusiness.id;
        let running = false;
        const sync = async () => {
            if (!loadedRef.current || running || document.visibilityState === "hidden") return;
            running = true;
            try {
                // With the attempt summary when the column exists; without it
                // until 20261006_confirmation_attempts.sql has been run.
                const query = (cols: string) => supabase.from('orders').select(cols).eq('business_id', businessId).ilike('status', 'waiting');
                let res = await query('id, status, easyorders_id, tags, confirm_attempts, last_attempt_at, last_attempt_reason, last_attempt_note, last_attempt_by');
                if (res.error) res = await query('id, status, easyorders_id, tags');
                const data = res.data as unknown as (AttemptSummary & { id: string; status: string; easyorders_id: string | null; tags: unknown })[] | null;
                if (res.error || !data) return;
                const attemptsById = new Map(data.map(o => [o.id, o]));
                if (data.some(o => o.confirm_attempts !== undefined)) {
                    setOrders(prev => {
                        let changed = false;
                        const next = prev.map(o => {
                            const a = attemptsById.get(o.id);
                            if (!a || (a.confirm_attempts ?? 0) === (o.confirm_attempts ?? 0)) return o;
                            changed = true;
                            return { ...o, confirm_attempts: a.confirm_attempts, last_attempt_at: a.last_attempt_at, last_attempt_reason: a.last_attempt_reason, last_attempt_note: a.last_attempt_note, last_attempt_by: a.last_attempt_by };
                        });
                        return changed ? next : prev;
                    });
                }
                const live = new Set(data.filter(isWaitingPlatformOrder).map(o => o.id as string));
                const current = ordersRef.current;
                const gone = current.filter(o => !live.has(o.id));
                if (gone.length) {
                    setOrders(prev => prev.filter(o => live.has(o.id)));
                    toast.info(gone.length === 1
                        ? "أوردر اتنقل أو اتلغى من زميلك، فاتشال من الصفحة."
                        : `${gone.length} أوردرات اتنقلت أو اتلغت من زملائك، فاتشالت من الصفحة.`);
                }
                const known = new Set(current.map(o => o.id));
                const fresh = [...live].filter(id => !known.has(id) && !inFlight.current.has(id));
                if (fresh.length) {
                    const { data: rows } = await supabase.from('orders').select(ORDER_SELECT).in('id', fresh);
                    const added = ((rows || []) as Order[]).filter(isWaitingPlatformOrder);
                    if (added.length) {
                        setOrders(prev => {
                            const have = new Set(prev.map(o => o.id));
                            return [...added.filter(o => !have.has(o.id)), ...prev]
                                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
                        });
                    }
                }
            } finally {
                running = false;
            }
        };
        const timer = setInterval(sync, 30_000);
        document.addEventListener("visibilitychange", sync);
        window.addEventListener("focus", sync);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", sync);
            window.removeEventListener("focus", sync);
        };
    }, [activeBusiness]);

    // Both of these ask for the changed rows back and insist on getting one.
    //
    // A filtered UPDATE that matches nothing is a success in PostgREST — no
    // error, no rows. That is exactly what happened to line items whose
    // business_id was NULL: mapping a product appeared to work, the UI updated
    // optimistically, and the order moved into fulfilment still carrying
    // "unknown product". Silent no-ops must not be mistaken for saves.
    const handleUpdateOrder = async (orderId: string, updates: any) => {
        const { data, error } = await supabase
            .from('orders')
            .update(updates)
            .eq('business_id', activeBusiness!.id)
            .eq('id', orderId)
            .select('id');
        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("لم يتم حفظ التعديل على الأوردر. حدّث الصفحة وجرّب تاني.");
        }
    };

    const handleUpdateItem = async (itemId: string, updates: any) => {
        const { data, error } = await supabase
            .from('order_items')
            .update(updates)
            .eq('business_id', activeBusiness!.id)
            .eq('id', itemId)
            .select('id');
        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("لم يتم حفظ المنتج على الأوردر. حدّث الصفحة وجرّب تاني.");
        }
    };

    const handleRecordDepositAndMoveToPending = async (order: Order, accountName: string) => {
        setDepositLoading(true);
        setSaving(order.id);
        try {
            // The move first, and only while the order is still Waiting: the
            // deposit used to be recorded first, so a second moderator
            // confirming the same order recorded the same money twice.
            const moved = await leaveWaiting(order.id, {
                status: 'Pending',
                // Confirming the order IS closing it. If the reviewer never
                // touched the dropdown, they are the one who did it — leaving
                // it null would drop the order out of the league entirely.
                ...(order.closed_by ? {} : { closed_by: currentUser?.email ?? null }),
            });
            if (moved === "gone") {
                toast.info("الأوردر ده اتنقل قبل كده من زميلك، والعربون ماتسجلش تاني.");
                setDepositModalOpen(false);
                setDepositOrder(null);
                setOrders(prev => prev.filter(o => o.id !== order.id));
                return;
            }

            if (order.paid_amount && order.paid_amount > 0) {
                const { error: txError } = await supabase.from('transactions').insert({
                    business_id: activeBusiness?.id,
                    transaction_date: new Date().toISOString().split('T')[0],
                    type: 'revenue',
                    category: 'orders_collection',
                    order_id: order.id,
                    amount: order.paid_amount,
                    description: `Payment collection for Platform Order ${order.easyorders_id || order.id.slice(0,8)}`,
                    account_name: accountName
                });
                if (txError) {
                    console.error("Deposit not recorded:", txError);
                    toast.error("الأوردر اتنقل، بس العربون ماتسجلش في الحسابات. سجّله من صفحة الحسابات.");
                }
            }

            if (activeBusiness) {
                logBusinessAction({
                    businessId: activeBusiness.id,
                    userEmail: currentUser?.email || "Staff",
                    actionType: "update_status",
                    entityType: "order",
                    entityId: order.id,
                    entityName: orderLogName(order.id, order.customer_info, "Platform Order"),
                    changes: [
                        { field: "Status", old_value: order.status, new_value: "Pending" },
                        { field: "Deposit Payment", old_value: null, new_value: `${order.paid_amount || 0} EGP (${accountName})` }
                    ]
                });
            }

            toast.success(t("Order moved to Pending successfully"));
            setDepositModalOpen(false);
            setDepositOrder(null);
            setTransactionAccount("");
            setOrders(prev => prev.filter(o => o.id !== order.id));
        } catch (e: any) {
            console.error("Error moving order & recording deposit:", e);
            saveFailed(e, t("Failed to move order"));
        } finally {
            setDepositLoading(false);
            setSaving(null);
        }
    };

    const handleMoveToPending = async (order: Order) => {
        const hasUnmapped = order.order_items.some(item => !item.variant_id);
        if (hasUnmapped) {
            toast.error(t("Please map all products before moving to pending"));
            return;
        }

        const isPaidStatus = order.payment_status === 'Paid' || order.payment_status === 'Partially Paid' || order.payment_status === 'Partial';
        if (isPaidStatus && order.paid_amount && order.paid_amount > 0) {
            setDepositOrder(order);
            setDepositModalOpen(true);
        } else {
            const card = takeOut(order.id);
            try {
                const moved = await leaveWaiting(order.id, {
                    status: 'Pending',
                    // Confirming the order IS closing it. If the reviewer never
                    // touched the dropdown, they are the one who did it — leaving
                    // it null would drop the order out of the league entirely.
                    ...(order.closed_by ? {} : { closed_by: currentUser?.email ?? null }),
                });
                card.settle();
                if (moved === "gone") {
                    toast.info("الأوردر ده اتنقل أو اتلغى قبل كده من زميلك.");
                    return;
                }

                if (activeBusiness) {
                    logBusinessAction({
                        businessId: activeBusiness.id,
                        userEmail: currentUser?.email || "Staff",
                        actionType: "update_status",
                        entityType: "order",
                        entityId: order.id,
                        entityName: orderLogName(order.id, order.customer_info, "Platform Order"),
                        changes: [
                            { field: "Status", old_value: order.status, new_value: "Pending" }
                        ]
                    });
                }

                toast.success(t("Order moved to Pending successfully"));
            } catch (error) {
                console.error("Error moving to pending:", error);
                card.restore();
                saveFailed(error, t("Failed to move order"));
            }
        }
    };

    const handleCancelOrder = async (orderId: string) => {
        const targetOrder = orders.find(o => o.id === orderId);
        const card = takeOut(orderId);
        try {
            const moved = await leaveWaiting(orderId, { status: 'Cancelled' });
            card.settle();
            if (moved === "gone") {
                toast.info("الأوردر ده اتنقل أو اتلغى قبل كده من زميلك.");
                return;
            }

            if (activeBusiness && targetOrder) {
                logBusinessAction({
                    businessId: activeBusiness.id,
                    userEmail: currentUser?.email || "Staff",
                    actionType: "update_status",
                    entityType: "order",
                    entityId: orderId,
                    entityName: orderLogName(orderId, targetOrder.customer_info, "Platform Order"),
                    changes: [
                        { field: "Status", old_value: targetOrder.status, new_value: "Cancelled" }
                    ]
                });
            }

            toast.success(t("Order cancelled"));
        } catch (error) {
            console.error("Error cancelling order:", error);
            card.restore();
            saveFailed(error, t("Failed to cancel order"));
        }
    };

    const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});

    // customer_info is one JSON column, so every field writes the whole object.
    // The fields debounce independently now, which means two of them can commit
    // within milliseconds of each other; building the payload from the render's
    // snapshot would let the later write resurrect the older field's value.
    // This mirror always holds the newest orders, so each save starts from what
    // the previous one actually wrote.
    const ordersRef = useRef<Order[]>([]);
    useEffect(() => { ordersRef.current = orders; }, [orders]);

    // One order's writes go out one at a time, in the order they were made.
    // Fired side by side, a slow request can land after a newer one and put
    // back the older value: typing a price of 100 wrote 1, 10 and 100, and the
    // order kept whichever arrived last — 1, while the screen showed 100.
    const saveQueue = useRef(new Map<string, Promise<unknown>>());
    const enqueueSave = (orderId: string, write: () => Promise<void>) => {
        const next = (saveQueue.current.get(orderId) ?? Promise.resolve()).catch(() => {}).then(write);
        saveQueue.current.set(orderId, next);
        return next;
    };

    const updateCustomerInfo = async (order: Order, field: string, value: string) => {
        const latest = ordersRef.current.find(o => o.id === order.id)?.customer_info
            ?? order.customer_info;
        const newInfo = { ...latest, [field]: value };
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, customer_info: newInfo } : o));
        try {
            await handleUpdateOrder(order.id, { customer_info: newInfo });
            return true;
        } catch (e) {
            toast.error(t("Failed to save"));
            return false;
        }
    };

    const handleAutoSaveNotes = async (order: Order, newNoteText: string) => {
        setSaveStatus(prev => ({ ...prev, [order.id]: "جاري الحفظ..." }));
        const ok = await updateCustomerInfo(order, 'internal_workbench_notes', newNoteText);
        setSaveStatus(prev => ({ ...prev, [order.id]: ok ? "تم الحفظ تلقائياً ✓" : "فشل الحفظ" }));
        if (ok) {
            setTimeout(() => setSaveStatus(prev => ({ ...prev, [order.id]: "" })), 2000);
        }
    };


    
    const updateOrderField = async (order: Order, field: string, value: any) => {
        await updateOrderFields(order, { [field]: value });
    };

    const updateOrderFields = async (order: Order, updates: Partial<Order>) => {
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, ...updates } : o));
        try {
            await enqueueSave(order.id, () => handleUpdateOrder(order.id, updates));
        } catch(e) {
            toast.error(t("Failed to save"));
        }
    };

    /**
     * Rewrite an order's lines and re-derive its money from them.
     *
     * The three callers below each used to do this inside the setOrders updater
     * and fire the database write from in there. React treats updaters as pure
     * and is free to run one more than once — in development StrictMode always
     * does — so every quantity edit sent its PATCH twice. Reading from ordersRef
     * gives the same fresh lines the updater would have seen, with the write
     * kept outside where it belongs.
     */
    const applyItemChange = async (
        orderId: string,
        mutate: (items: OrderItem[]) => OrderItem[],
    ) => {
        const order = ordersRef.current.find(o => o.id === orderId);
        if (!order) return;

        const newItems = mutate(order.order_items);
        const newSubtotal = newItems.reduce((sum, i) => sum + (i.price_at_sale * i.quantity), 0);
        const newTotal = newSubtotal + order.shipping_cost;

        setOrders(prev => prev.map(o => o.id === orderId
            ? { ...o, subtotal: newSubtotal, total_amount: newTotal, order_items: newItems }
            : o));

        try {
            await enqueueSave(orderId, () => handleUpdateOrder(orderId, { subtotal: newSubtotal, total_amount: newTotal }));
        } catch (e) {
            toast.error(t("Failed to save"));
        }
    };

    const updateOrderItem = async (orderId: string, itemId: string, field: string, value: any) => {
        await applyItemChange(orderId, items =>
            items.map(item => item.id === itemId ? { ...item, [field]: value } : item));

        try {
            await enqueueSave(orderId, () => handleUpdateItem(itemId, { [field]: value }));
        } catch(e) {
            toast.error(t("Failed to update item"));
        }
    };

    const mapVariantToItem = async (orderId: string, itemId: string, variantId: string) => {
        const variant = variants.find(v => v.id === variantId);
        if (!variant) return;

        const targetOrder = orders.find(o => o.id === orderId);
        const targetItem = targetOrder?.order_items?.find(i => i.id === itemId);
        const oldVariantTitle = targetItem?.variants?.products?.name 
            ? `${targetItem.variants.products.name} (${targetItem.variants.title})`
            : targetItem?.unmapped_name || "Unmapped Item";

        await applyItemChange(orderId, items => items.map(item => item.id === itemId
            ? {
                ...item,
                variant_id: variantId,
                price_at_sale: item.price_at_sale || variant.sale_price,
                variants: {
                    title: variant.title,
                    sku: variant.sku,
                    product_id: '',
                    products: { name: variant.products?.name || "Mapped Product" }
                }
            }
            : item));

        try {
            await enqueueSave(orderId, () => handleUpdateItem(itemId, { variant_id: variantId }));

            if (activeBusiness && targetOrder) {
                logBusinessAction({
                    businessId: activeBusiness.id,
                    userEmail: currentUser?.email || "Staff",
                    actionType: "edit",
                    entityType: "order",
                    entityId: orderId,
                    entityName: orderLogName(orderId, targetOrder.customer_info, "Platform Order"),
                    changes: [
                        { 
                            field: "Item Variant", 
                            old_value: oldVariantTitle, 
                            new_value: `${variant.products?.name} (${variant.title})` 
                        }
                    ]
                });
            }

            toast.success(t("Product mapped successfully"));
        } catch(e) {
            toast.error(t("Failed to map product"));
        }
    };


    const deleteItemFromOrder = async (orderId: string, itemId: string) => {
        await applyItemChange(orderId, items => items.filter(item => item.id !== itemId));

        try {
            await supabase.from('order_items').delete().eq('business_id', activeBusiness!.id).eq('id', itemId);
            toast.success(t("Item removed"));
        } catch(e) {
            toast.error(t("Failed to delete item"));
        }
    };

    const filteredOrders = useMemo(() => {
        return orders.filter(order => {
            let matchesSearch = true;
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                const name = (order.customer_info?.name || "").toLowerCase();
                const phone = (order.customer_info?.phone || "").toLowerCase();
                const easyId = (order.easyorders_id || "").toLowerCase();
                const id = (order.id || "").toLowerCase();
                
                matchesSearch = name.includes(query) || phone.includes(query) || easyId.includes(query) || id.includes(query);
            }
            
            let matchesDate = true;
            if (fromDate || toDate) {
                const orderDate = new Date(order.created_at);
                orderDate.setHours(0, 0, 0, 0);
                
                if (fromDate) {
                    const from = new Date(fromDate);
                    from.setHours(0, 0, 0, 0);
                    if (orderDate < from) matchesDate = false;
                }
                
                if (toDate) {
                    const to = new Date(toDate);
                    to.setHours(0, 0, 0, 0);
                    if (orderDate > to) matchesDate = false;
                }
            }
            
            let matchesPlatform = true;
            const tagsStr = JSON.stringify(order.tags || []).toLowerCase();
            if (platformFilter === "easyorders") {
                matchesPlatform = !!order.easyorders_id || tagsStr.includes("easyorders");
            } else if (platformFilter === "shopify") {
                matchesPlatform = tagsStr.includes("shopify");
            }

            return matchesSearch && matchesDate && matchesPlatform;
        });
    }, [orders, searchQuery, fromDate, toDate, platformFilter]);

    // Other orders on the same number, looked up for the whole waiting list
    // rather than what the filters show, so a twin hidden by a search still
    // flags the card that is visible.
    const repeatSubjects = useMemo(() => orders.map(o => ({
        id: o.id,
        created_at: o.created_at,
        status: o.status,
        customer_info: o.customer_info,
        productNames: (o.order_items || []).map(i => i.variants?.products?.name || i.unmapped_name || ""),
    })), [orders]);
    const repeats = useRepeatOrders(activeBusiness?.id, repeatSubjects);
    const [repeatOnly, setRepeatOnly] = useState(false);
    const repeatCount = filteredOrders.filter(o => repeats.has(o.id)).length;
    const doubleRiskCount = filteredOrders.filter(o => repeats.get(o.id)?.doubleRisk).length;
    const listed = repeatOnly ? filteredOrders.filter(o => repeats.has(o.id)) : filteredOrders;

    // New orders, orders to try again, or both. The order's status stays
    // Waiting throughout; the tab is how far confirming it has got.
    const [stageTab, setStageTab] = useState<ConfirmStage | "all">("new");
    const [failing, setFailing] = useState<Order | null>(null);
    const stageCounts = {
        new: listed.filter(o => stageOf(o) === "new").length,
        retry: listed.filter(o => stageOf(o) === "retry").length,
        due: listed.filter(o => stageOf(o) === "retry" && (minutesSince(o.last_attempt_at) ?? 0) >= RETRY_AFTER_MIN).length,
        all: listed.length,
    };
    // The retry list starts with whoever has waited longest since their last
    // try; everything else keeps the newest-first order it always had.
    const visibleOrders = stageTab === "all" ? listed
        : stageTab === "new" ? listed.filter(o => stageOf(o) === "new")
        : listed.filter(o => stageOf(o) === "retry")
            .sort((a, b) => String(a.last_attempt_at ?? "").localeCompare(String(b.last_attempt_at ?? "")));

    const onAttemptSaved = (order: Order, summary: AttemptSummary) => {
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, ...summary } : o));
        setFailing(null);
        toast.success(stageTab === "new"
            ? "اتسجلت المحاولة، والأوردر اتنقل لتاب إعادة المحاولة."
            : "اتسجلت المحاولة.");
        if (activeBusiness) {
            logBusinessAction({
                businessId: activeBusiness.id,
                userEmail: currentUser?.email || "Staff",
                actionType: "edit",
                entityType: "order",
                entityId: order.id,
                entityName: orderLogName(order.id, order.customer_info, "Platform Order"),
                changes: [{ field: "Confirmation attempt", old_value: null, new_value: `${summary.last_attempt_reason}${summary.last_attempt_note ? `: ${summary.last_attempt_note}` : ""}` }],
            });
        }
    };
    // A twin that is itself a card on screen is linked by anchor; anything
    // else opens in a new tab.
    const onPageIds = new Set(visibleOrders.map(o => o.id));


    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight flex items-center">
                        {t("Platform Synced Orders")}
                        {!loading && orders.length > 0 && (
                            <Badge variant="secondary" className="ml-3 text-lg px-3 py-1 bg-primary/10 text-primary">
                                {orders.length} {t("Waiting")}
                            </Badge>
                        )}
                    </h2>
                    <p className="text-muted-foreground">{t("Manage incoming orders from EasyOrders and Shopify waiting for review.")}</p>
                </div>
            </div>
            
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 py-4">
                <div className="relative w-full sm:flex-1 sm:max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder={t("Search by name, phone, or order ID...")}
                        className="pl-8"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <Select value={platformFilter} onValueChange={setPlatformFilter}>
                    <SelectTrigger className="w-full sm:w-[180px] h-10">
                        <SelectValue placeholder={t("Filter by Platform")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t("All Platforms")}</SelectItem>
                        <SelectItem value="easyorders">EasyOrders</SelectItem>
                        <SelectItem value="shopify">Shopify</SelectItem>
                    </SelectContent>
                </Select>
                <DateRangePicker />
                {/* Only there when something is flagged, and red when two
                    orders on one number could both still ship. */}
                {(repeatCount > 0 || repeatOnly) && (
                    <Button
                        variant={repeatOnly ? "default" : "outline"}
                        onClick={() => setRepeatOnly(v => !v)}
                        title={t("Show only orders whose number has other orders")}
                        className={cn(
                            "h-10 w-full gap-1.5 sm:w-auto",
                            !repeatOnly && (doubleRiskCount > 0
                                ? "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300"
                                : "border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-300"),
                        )}
                    >
                        <Repeat className="h-4 w-4" />
                        <span>{t("Repeat orders")}</span>
                        <span className="tabular-nums">({repeatCount})</span>
                    </Button>
                )}
            </div>

            {failing && (
                <FailedAttemptDialog
                    orderId={failing.id}
                    customerName={failing.customer_info?.name || ""}
                    attempts={failing.confirm_attempts ?? 0}
                    open={!!failing}
                    onOpenChange={o => { if (!o) setFailing(null); }}
                    onSaved={summary => onAttemptSaved(failing, summary)}
                    onGone={() => {
                        toast.info("الأوردر ده اتنقل أو اتلغى قبل كده من زميلك.");
                        setOrders(prev => prev.filter(o => o.id !== failing.id));
                        setFailing(null);
                    }}
                />
            )}

            {/* Treasury Transaction Modal */}
            <AlertDialog open={depositModalOpen} onOpenChange={setDepositModalOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("Record Deposit & Move to Pending")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("This order has a paid amount of")} {formatCurrency(depositOrder?.paid_amount || 0)}. {t("Select the treasury account to deposit this amount into.")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>{t("Select Account")}</Label>
                            <Select value={transactionAccount} onValueChange={setTransactionAccount}>
                                <SelectTrigger><SelectValue placeholder={t("Choose Treasury Account")} /></SelectTrigger>
                                <SelectContent>
                                    {accounts.map(acc => (
                                        <SelectItem key={acc.id} value={acc.name}>{acc.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => { setDepositOrder(null); setTransactionAccount(""); }}>{t("Cancel")}</AlertDialogCancel>
                        <AlertDialogAction 
                            disabled={!transactionAccount || depositLoading}
                            onClick={() => depositOrder && handleRecordDepositAndMoveToPending(depositOrder, transactionAccount)}
                        >
                            {depositLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {t("Confirm & Deposit")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {orders.length > 0 && (
                <ConfirmTabs value={stageTab} onChange={setStageTab} counts={stageCounts} />
            )}

            <div id="platform-orders-table">
            {visibleOrders.length === 0 && orders.length > 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-14 text-center text-muted-foreground" dir="rtl">
                    <PackageSearch className="mb-3 h-10 w-10 opacity-20" />
                    <p className="font-medium">
                        {stageTab === "new" ? "مفيش أوردرات جديدة 👌" : stageTab === "retry" ? "مفيش أوردرات محتاجة إعادة محاولة 👌" : "مفيش أوردرات بالفلتر ده"}
                    </p>
                    {stageTab === "new" && stageCounts.retry > 0 && (
                        <button className="mt-2 text-sm text-primary underline" onClick={() => setStageTab("retry")}>
                            فيه {stageCounts.retry} في إعادة المحاولة
                        </button>
                    )}
                </div>
            ) : visibleOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-20 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
                    <PackageSearch className="h-12 w-12 mb-4 opacity-20" />
                    <p className="text-lg font-medium">{t("No waiting platform orders")}</p>
                    <p className="text-sm">{t("Orders will appear here automatically when they are placed on your EasyOrders or Shopify store.")}</p>
                </div>
            ) : (

                <div className="grid gap-6">
                    {visibleOrders.map(order => (
                        <Card
                            key={order.id}
                            id={`po-${order.id}`}
                            className={cn(
                                "border-2 shadow-md scroll-mt-24",
                                repeats.get(order.id)?.doubleRisk
                                    ? "border-red-400 dark:border-red-800"
                                    : repeats.has(order.id)
                                        ? "border-amber-300 dark:border-amber-800"
                                        : "border-primary/20",
                            )}
                        >
                            <CardHeader className="bg-muted/30 pb-4 border-b space-y-3">
                                {/* Stacks on a phone. Side by side, the name and
                                    the total each got half a narrow screen and
                                    both wrapped to three lines. */}
                                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
                                    <div className="min-w-0">
                                        <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg sm:text-xl">
                                            <span className="break-words">{order.customer_info?.name || "Unknown"}</span>
                                            <span className="font-mono text-xs font-normal text-muted-foreground">
                                                #{order.id.slice(0, 8)}
                                            </span>
                                        </CardTitle>
                                        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                                            {format(new Date(order.created_at), "PPP p")}
                                        </p>
                                    </div>
                                    <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 shrink-0">
                                        <p className="text-xl font-bold text-primary">{formatCurrency(order.total_amount)}</p>
                                        <AttemptBadge order={order} />
                                    </div>
                                </div>

                                {/* Above the call buttons, not below: the other
                                    orders on this number are what the call has
                                    to settle. */}
                                {repeats.has(order.id) && (
                                    <RepeatOrdersAlert info={repeats.get(order.id)!} onPage={onPageIds} />
                                )}
                                {/* What the last person to call was told, before
                                    the next one picks up the phone. */}
                                <LastAttempt order={order} />
                                <AttemptHistory orderId={order.id} count={order.confirm_attempts ?? 0} />
                                {/* Calling is the first thing that happens to one
                                    of these orders, so it is the first thing on
                                    the card rather than a field to select and
                                    copy out of. */}
                                <ContactActions order={order as any} storeName={storeName} />
                                {/* Set by the webhook when our total from the items
                                    disagrees with the total EasyOrders sent. Almost
                                    always a quantity or a line we failed to read, so
                                    the quantities below are what needs checking. */}
                                {Array.isArray(order.tags) && order.tags.includes('total-mismatch') && (
                                    <div className="mt-3 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/20 p-2.5 text-xs text-red-700 dark:text-red-400">
                                        <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
                                        <span>
                                            {t("This total does not match what the store sent. Check the quantities and prices below before moving the order on.")}
                                        </span>
                                    </div>
                                )}
                            </CardHeader>
                            <CardContent className="pt-5 px-4 sm:px-6">
                                <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
                                    {/* Customer Details */}
                                    <div className="space-y-4">
                                        <h3 className="font-semibold text-lg flex items-center border-b pb-2">{t("Customer Details")}</h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                            <div className="space-y-2">
                                                <Label>{t("Name")}</Label>
                                                <AutosaveField
                                                    value={order.customer_info?.name || ""}
                                                    onCommit={v => updateCustomerInfo(order, 'name', v)}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>{t("Phone 1")}</Label>
                                                <AutosaveField
                                                    value={order.customer_info?.phone || ""}
                                                    onCommit={v => updateCustomerInfo(order, 'phone', v)}
                                                />
                                            </div>
                                        </div>
                                        
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                            <div className="space-y-2">
                                                <Label>{t("Phone 2")}</Label>
                                                <AutosaveField
                                                    value={order.customer_info?.phone2 || ""}
                                                    onCommit={v => updateCustomerInfo(order, 'phone2', v)}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>{t("Governorate")}</Label>
                                                <Select 
                                                    value={order.customer_info?.governorate || ""} 
                                                    onValueChange={val => updateCustomerInfo(order, 'governorate', val)}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select Governorate" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {GOVERNORATES.map(gov => (
                                                            <SelectItem key={gov} value={gov}>{gov}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <Label>{t("Address")}</Label>
                                            <AutosaveField
                                                multiline
                                                value={order.customer_info?.address || ""}
                                                onCommit={v => updateCustomerInfo(order, 'address', v)}
                                                rows={2}
                                            />
                                        </div>

                                        {/* Internal Workbench Notes (Autosave) */}
                                        <div className="space-y-1.5 pt-3 border-t">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs font-semibold text-primary flex items-center gap-1.5">
                                                    📝 {t("Internal Review Notes")}
                                                </Label>
                                                {saveStatus[order.id] && (
                                                    <span className="text-[10px] text-emerald-600 font-medium font-mono transition-all animate-pulse">
                                                        {saveStatus[order.id]}
                                                    </span>
                                                )}
                                            </div>
                                            <AutosaveField
                                                multiline
                                                placeholder={t("Write internal review notes here (Auto-Save)...")}
                                                value={order.customer_info?.internal_workbench_notes || ""}
                                                onCommit={v => handleAutoSaveNotes(order, v)}
                                                rows={2}
                                                className="text-xs bg-amber-50/30 dark:bg-amber-950/10 border-amber-200/80 dark:border-amber-900/40 focus:border-amber-400"
                                            />
                                        </div>

                                        {/* The note that travels with the order.
                                            Distinct from the review notes above:
                                            that one is for whoever is checking
                                            this screen, this one is on the order
                                            everywhere else and goes out with it. */}
                                        <div className="space-y-1.5 pt-3 border-t">
                                            <Label className="text-xs font-semibold flex items-center gap-1.5">
                                                🗒️ {t("Order note")}
                                            </Label>
                                            <AutosaveField
                                                multiline
                                                placeholder={t("A note that stays on the order — delivery instructions, a landmark, anything the courier should know.")}
                                                value={order.notes || ""}
                                                onCommit={v => updateOrderField(order, 'notes', v)}
                                                rows={2}
                                                className="text-xs"
                                            />
                                        </div>

                                        {/* Who confirmed this order with the customer. This is the
                                            busiest of the three entry points — most orders arrive
                                            from EasyOrders and get closed right here — so it is
                                            prefilled with whoever is reviewing and saved on the spot
                                            rather than waiting for the order to move on. */}
                                        <div className="space-y-1.5 pt-3 border-t">
                                            <Label className="text-xs font-semibold text-primary">
                                                {t("Closed by")}
                                            </Label>
                                            <ClosedBySelect
                                                bare
                                                businessId={activeBusiness?.id}
                                                value={order.closed_by ?? null}
                                                onChange={v => updateOrderField(order, 'closed_by', v)}
                                            />
                                        </div>
                                    </div>



                                    {/* Order Items Mapping */}
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center border-b pb-2">
                                            <h3 className="font-semibold text-lg">{t("Products & Mapping")}</h3>
                                            
                                            <Popover open={addItemOpen[order.id]} onOpenChange={(open) => setAddItemOpen(prev => ({...prev, [order.id]: open}))}>
                                                <PopoverTrigger asChild>
                                                    <Button size="sm" variant="outline" className="h-8">
                                                        + {t("Add Product")}
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-96 p-0" align="end">
                                                    {/*
                                                      One searchable list of product+variant rather than two
                                                      dependent dropdowns. Picking a product first only to then
                                                      hunt its variant is slow when you already know what you
                                                      want, and the plain Select had no search at all — with a
                                                      long catalogue that means scrolling blind.
                                                      Searchable by product name, variant title and SKU.
                                                    */}
                                                    <Command
                                                        filter={(value, search) =>
                                                            // Substring over cmdk's fuzzy scoring — SKUs and Arabic
                                                            // names match far more predictably — and folded so
                                                            // "احمر" finds "أحمر" the way staff actually type.
                                                            normalizeSearchText(value).includes(normalizeSearchText(search)) ? 1 : 0
                                                        }
                                                    >
                                                        <CommandInput placeholder={t("Search by product, variant or SKU…")} />
                                                        <CommandList className="max-h-72">
                                                            <CommandEmpty>{t("No product found.")}</CommandEmpty>
                                                            {products.map(p => (
                                                                <CommandGroup key={p.id} heading={p.name}>
                                                                    {(p.variants || []).map((v: any) => {
                                                                        const isPicked = selectedVariantForAdd[order.id] === v.id;
                                                                        const outOfStock = v.track_inventory && (v.stock_qty ?? 0) <= 0;
                                                                        return (
                                                                            <CommandItem
                                                                                key={v.id}
                                                                                value={`${p.name} ${v.title} ${v.sku || ""}`}
                                                                                onSelect={() => {
                                                                                    setSelectedProductForAdd(prev => ({ ...prev, [order.id]: p.id }));
                                                                                    setSelectedVariantForAdd(prev => ({ ...prev, [order.id]: v.id }));
                                                                                }}
                                                                            >
                                                                                <Check className={cn("mr-2 h-4 w-4 shrink-0", isPicked ? "opacity-100" : "opacity-0")} />
                                                                                <div className="flex-1 min-w-0">
                                                                                    <div className="text-xs font-medium truncate">{v.title}</div>
                                                                                    {v.sku && <div className="text-[10px] text-muted-foreground font-mono truncate">{v.sku}</div>}
                                                                                </div>
                                                                                <div className="text-end shrink-0 ms-2">
                                                                                    <div className="text-xs font-semibold">{formatCurrency(v.sale_price)}</div>
                                                                                    {v.track_inventory && (
                                                                                        <div className={cn("text-[10px]", outOfStock ? "text-red-600 font-bold" : "text-muted-foreground")}>
                                                                                            {outOfStock ? t("Out of stock") : `${v.stock_qty} ${t("in stock")}`}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            </CommandItem>
                                                                        );
                                                                    })}
                                                                </CommandGroup>
                                                            ))}
                                                        </CommandList>
                                                    </Command>
                                                    <div className="p-3 border-t">
                                                    <Button 
                                                        size="sm" 
                                                        className="w-full h-8"
                                                        disabled={!selectedVariantForAdd[order.id]}
                                                        onClick={async () => {
                                                            const vId = selectedVariantForAdd[order.id];
                                                            const pId = selectedProductForAdd[order.id];
                                                            const prod = products.find(p => p.id === pId);
                                                            const vari = prod?.variants.find((v:any) => v.id === vId);
                                                            if (!prod || !vari) return;
                                                            
                                                            const { data: newItem, error } = await supabase.from('order_items').insert({
                                                                order_id: order.id,
                                                                variant_id: vari.id,
                                                                quantity: 1,
                                                                price_at_sale: vari.sale_price,
                                                                cost_at_sale: vari.cost_price || 0,
                                                                business_id: activeBusiness?.id
                                                            }).select('id').single();
                                                            
                                                            if (error) {
                                                                toast.error("Failed to add item");
                                                                return;
                                                            }
                                                            
                                                            const newItemObj = {
                                                                id: newItem.id,
                                                                variant_id: vari.id,
                                                                quantity: 1,
                                                                price_at_sale: vari.sale_price,
                                                                cost_at_sale: vari.cost_price || 0,
                                                                variants: {
                                                                    title: vari.title,
                                                                    sku: vari.sku || "",
                                                                    product_id: prod.id,
                                                                    products: { name: prod.name }
                                                                }
                                                            };
                                                            
                                                            const newTotal = order.order_items.reduce((sum, item) => sum + (item.price_at_sale * item.quantity), 0) + vari.sale_price + order.shipping_cost;
                                                            
                                                            setOrders(prev => prev.map(o => {
                                                                if (o.id === order.id) {
                                                                    return {
                                                                        ...o,
                                                                        total_amount: newTotal,
                                                                        subtotal: newTotal - o.shipping_cost,
                                                                        order_items: [...o.order_items, newItemObj as any]
                                                                    };
                                                                }
                                                                return o;
                                                            }));
                                                            
                                                            enqueueSave(order.id, () => handleUpdateOrder(order.id, { subtotal: newTotal - order.shipping_cost, total_amount: newTotal }))
                                                                .catch(() => toast.error(t("Failed to save")));
                                                            
                                                            setAddItemOpen(prev => ({...prev, [order.id]: false}));
                                                            setSelectedProductForAdd(prev => ({...prev, [order.id]: ""}));
                                                            setSelectedVariantForAdd(prev => ({...prev, [order.id]: ""}));
                                                            toast.success("Item added");
                                                        }}
                                                    >
                                                        {t("Add to Order")}
                                                    </Button>
                                                    </div>
                                                </PopoverContent>
                                            </Popover>
                                        </div>

                                        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                                            {order.order_items?.map(item => {
                                                const isUnmapped = !item.variant_id;
                                                const defaultProd = item.variant_id 
                                                    ? products.find(p => p.variants?.some((v: any) => v.id === item.variant_id))
                                                    : null;
                                                const chosenProdId = selectedItemProduct[item.id] || defaultProd?.id;
                                                const activeProd = products.find(p => p.id === chosenProdId);

                                                return (
                                                    <div key={item.id} className={cn("p-3 rounded-lg border space-y-2", isUnmapped ? "bg-red-50/50 border-red-200" : "bg-muted/30")}>
                                                        <div className="flex justify-between items-start gap-2">
                                                            <div className="space-y-1 flex-1">
                                                                <div className="flex items-center gap-2">
                                                                    <p className="font-medium text-sm">
                                                                        {item.variants?.products?.name 
                                                                            ? `${item.variants.products.name} (${item.variants.title})`
                                                                            : item.unmapped_name || "Unknown Item"}
                                                                    </p>
                                                                    {isUnmapped && (
                                                                        <Badge variant="destructive" className="text-[10px]">Unmapped</Badge>
                                                                    )}
                                                                </div>
                                                                {item.unmapped_sku && (
                                                                    <p className="text-xs font-mono text-muted-foreground">SKU: {item.unmapped_sku}</p>
                                                                )}
                                                            </div>
                                                            <Button 
                                                                variant="ghost" 
                                                                size="sm" 
                                                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                                                onClick={() => deleteItemFromOrder(order.id, item.id)}
                                                            >
                                                                <X className="h-4 w-4" />
                                                            </Button>
                                                        </div>

                                                        {/* 2-Step Product & Variant Menus */}
                                                        <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                            {/* Step 1: Product Selection Menu */}
                                                            <div>
                                                                <Label className="text-[10px] font-medium text-muted-foreground block mb-1">{t("Select Product")}:</Label>
                                                                <Popover>
                                                                    <PopoverTrigger asChild>
                                                                        <Button variant="outline" size="sm" className="w-full justify-between text-xs h-8 truncate bg-background/50">
                                                                            <span className="truncate">{activeProd?.name || t("Select Product")}</span>
                                                                            <ChevronsUpDown className="h-3 w-3 opacity-50 shrink-0 ml-1" />
                                                                        </Button>
                                                                    </PopoverTrigger>
                                                                    <PopoverContent className="w-[240px] p-0" align="start">
                                                                        <Command>
                                                                            <CommandInput placeholder={t("Search system products...")} />
                                                                            <CommandEmpty>{t("No product found.")}</CommandEmpty>
                                                                            <CommandGroup>
                                                                                <CommandList className="max-h-60 overflow-y-auto">
                                                                                    {products.map(p => (
                                                                                        <CommandItem
                                                                                            key={p.id}
                                                                                            value={p.name}
                                                                                            onSelect={() => {
                                                                                                setSelectedItemProduct(prev => ({ ...prev, [item.id]: p.id }));
                                                                                            }}
                                                                                        >
                                                                                            <Check className={cn("mr-2 h-4 w-4 shrink-0", activeProd?.id === p.id ? "opacity-100" : "opacity-0")} />
                                                                                            <span className="text-xs font-medium">{p.name}</span>
                                                                                        </CommandItem>
                                                                                    ))}
                                                                                </CommandList>
                                                                            </CommandGroup>
                                                                        </Command>
                                                                    </PopoverContent>
                                                                </Popover>
                                                            </div>

                                                            {/* Step 2: Variant Selection Menu (Filtered to activeProd) */}
                                                            <div>
                                                                <Label className="text-[10px] font-medium text-muted-foreground block mb-1">{t("Select Variant")}:</Label>
                                                                <Popover>
                                                                    <PopoverTrigger asChild>
                                                                        <Button 
                                                                            variant={isUnmapped ? "outline" : "ghost"} 
                                                                            size="sm" 
                                                                            disabled={!activeProd}
                                                                            className="w-full justify-between text-xs h-8 border border-input bg-background/50 hover:bg-accent truncate"
                                                                        >
                                                                            <span className="truncate">
                                                                                {item.variants?.title ? item.variants.title : t("Select Variant")}
                                                                            </span>
                                                                            <ChevronsUpDown className="h-3 w-3 opacity-50 shrink-0 ml-1" />
                                                                        </Button>
                                                                    </PopoverTrigger>
                                                                    <PopoverContent className="w-[260px] p-0" align="start">
                                                                        <Command>
                                                                            <CommandInput placeholder={t("Search variants...")} />
                                                                            <CommandEmpty>{t("No variant found.")}</CommandEmpty>
                                                                            <CommandGroup>
                                                                                <CommandList className="max-h-60 overflow-y-auto">
                                                                                    {activeProd?.variants?.map((v: any) => (
                                                                                        <CommandItem
                                                                                            key={v.id}
                                                                                            value={`${v.title} ${v.sku}`}
                                                                                            onSelect={() => mapVariantToItem(order.id, item.id, v.id)}
                                                                                        >
                                                                                            <Check className={cn("mr-2 h-4 w-4 shrink-0", item.variant_id === v.id ? "opacity-100" : "opacity-0")} />
                                                                                            <div className="flex flex-col text-xs">
                                                                                                <span className="font-medium">{v.title}</span>
                                                                                                <span className="text-muted-foreground font-mono">SKU: {v.sku} ({formatCurrency(v.sale_price)})</span>
                                                                                            </div>
                                                                                        </CommandItem>
                                                                                    ))}
                                                                                </CommandList>
                                                                            </CommandGroup>
                                                                        </Command>
                                                                    </PopoverContent>
                                                                </Popover>
                                                            </div>
                                                        </div>



                                                        <div className="flex items-center gap-3 pt-1 border-t text-xs">
                                                            <div className="flex items-center gap-1">
                                                                <Label className="text-[11px] text-muted-foreground">{t("Qty")}:</Label>
                                                                <AutosaveField
                                                                    type="number"
                                                                    min="1"
                                                                    inputMode="numeric"
                                                                    className="w-14 h-7 text-xs"
                                                                    value={String(item.quantity)}
                                                                    onCommit={v => updateOrderItem(order.id, item.id, 'quantity', parseInt(v) || 1)}
                                                                />
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                <Label className="text-[11px] text-muted-foreground">{t("Price")}:</Label>
                                                                <AutosaveField
                                                                    type="number"
                                                                    inputMode="decimal"
                                                                    className="w-20 h-7 text-xs"
                                                                    value={String(item.price_at_sale)}
                                                                    onCommit={v => updateOrderItem(order.id, item.id, 'price_at_sale', parseFloat(v) || 0)}
                                                                />
                                                            </div>
                                                            <div className="ml-auto font-bold">
                                                                {formatCurrency(item.quantity * item.price_at_sale)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Financial Summary */}
                                        <div className="border-t pt-4 space-y-2 text-sm bg-muted/20 p-3 rounded-lg">
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-muted-foreground">{t("Subtotal")}</span>
                                                <span>{formatCurrency(order.subtotal)}</span>
                                            </div>
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-muted-foreground">{t("Shipping Cost")}</span>
                                                <AutosaveField
                                                    type="number"
                                                    inputMode="decimal"
                                                    className="w-24 h-7 text-xs text-right"
                                                    value={String(order.shipping_cost)}
                                                    onCommit={v => {
                                                        const val = parseFloat(v) || 0;
                                                        const subtotal = ordersRef.current.find(o => o.id === order.id)?.subtotal ?? order.subtotal;
                                                        updateOrderFields(order, { shipping_cost: val, total_amount: subtotal + val });
                                                    }}
                                                />
                                            </div>
                                            <div className="flex justify-between items-center font-bold text-sm border-t pt-2">
                                                <span>{t("Total Amount")}</span>
                                                <span className="text-primary">{formatCurrency(order.total_amount)}</span>
                                            </div>
                                            
                                            <div className="flex justify-between items-center pt-2">
                                                <Label>{t("Payment Status")}</Label>
                                                <Select value={order.payment_status === 'Partial' ? 'Partially Paid' : (order.payment_status || "Not Paid")} onValueChange={(val) => {
                                                    updateOrderField(order, 'payment_status', val);
                                                    if (val === 'Paid') updateOrderField(order, 'paid_amount', order.total_amount);
                                                    if (val === 'Not Paid') updateOrderField(order, 'paid_amount', 0);
                                                }}>
                                                    <SelectTrigger className="w-[150px] h-8">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="Not Paid">Not Paid</SelectItem>
                                                        <SelectItem value="Partially Paid">Partially Paid</SelectItem>
                                                        <SelectItem value="Paid">Paid</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            {(order.payment_status === 'Partially Paid' || order.payment_status === 'Partial') && (
                                                <div className="flex justify-between items-center">
                                                    <Label>{t("Paid Amount")}</Label>
                                                    <AutosaveField
                                                        type="number"
                                                        inputMode="decimal"
                                                        className="w-[150px] h-8"
                                                        value={String(order.paid_amount || 0)}
                                                        onCommit={v => updateOrderField(order, 'paid_amount', parseFloat(v) || 0)}
                                                    />
                                                </div>
                                            )}
                                        </div>

                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="bg-muted/10 border-t p-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="outline" className="w-full sm:w-auto text-destructive border-destructive hover:bg-destructive/10">
                                            <X className="mr-2 h-4 w-4" />
                                            {t("Cancel Order")}
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will move the order to the Cancelled status. You can view it later in the main Orders page.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Go Back</AlertDialogCancel>
                                            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => handleCancelOrder(order.id)}>
                                                Confirm Cancel
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>

                                <Button
                                    variant="outline"
                                    className="w-full sm:w-auto border-orange-300 text-orange-800 hover:bg-orange-50 dark:border-orange-900 dark:text-orange-300"
                                    onClick={() => setFailing(order)}
                                >
                                    <PhoneMissed className="mr-2 h-4 w-4" />
                                    ماتأكدش
                                </Button>

                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button 
                                            className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90"
                                            disabled={!order.order_items?.length || order.order_items.some(item => !item.variant_id)}
                                        >
                                            {saving === order.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                                            {t("Move to Pending")}
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Approve and Move to Pending?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will make the order active in your system and it will appear in the main Orders tab.
                                                Ensure all products are mapped correctly before proceeding.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        {/* Said again at the one moment it can still be
                                            acted on: after this click the order goes to
                                            fulfilment alongside the other one. */}
                                        {repeats.get(order.id)?.doubleRisk && (
                                            <div className="space-y-1 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                                                <p className="font-semibold">{t("This number already has an open order:")}</p>
                                                <p className="font-mono">
                                                    {repeats.get(order.id)!.related
                                                        .filter(r => r.open)
                                                        .map(r => `#${r.id.slice(0, 8)} (${r.status})`)
                                                        .join(" · ")}
                                                </p>
                                                <p>{t("Check with the customer that this is a new order and not the same one twice.")}</p>
                                            </div>
                                        )}
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Review Again</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleMoveToPending(order)}>
                                                Confirm & Approve
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}
            </div>
        </div>
    );
}

export default function PlatformOrdersPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <PlatformOrdersContent />
        </Suspense>
    );
}
