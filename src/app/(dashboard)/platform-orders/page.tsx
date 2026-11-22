"use client";

import { activeCatalog } from "@/lib/products";
import { useEffect, useState, useMemo, useRef, Suspense } from "react";

import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { StoreOrderEditor, itemsCost, type OrderEditActions } from "@/components/orders/store-order-editor";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency } from "@/lib/utils";
import { DateRangePicker } from "@/components/date-range-picker";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ContactActions } from "@/components/orders/contact-actions";
import { RepeatOrdersAlert } from "@/components/orders/repeat-orders";
import { useRepeatOrders } from "@/hooks/use-repeat-orders";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Loader2, Check, AlertTriangle, Search, PackageSearch, Repeat, PhoneCall, HandCoins, ShoppingBasket,
    Undo2, Link2Off, MessageSquareText, X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
    AttemptHistory, FailedAttemptDialog, LastAttempt, ago, claimOrder, recordAttempt, type AttemptReason, type AttemptSummary,
} from "@/components/orders/confirmation-attempts";
import { ClaimBadge, FlowActions, FlowInstruction, HeadsUp, QueueTabs, type HeadsUpItem, type QueueTab } from "@/components/orders/confirm-queue";
import { DUE_STATES, byDue, claimedByOther, isMine, nextTryToast, queueStateOf, shortName, stepOf, whatsappFromOther, type QueueState } from "@/lib/orders/confirm-queue";

import { deliveryRateOf } from "@/lib/easyorders-delivery-rate";
import { fetchDeliveryRatesAction } from "./delivery-rate-actions";
import { MISSED_ORDERS_IN_QUEUE, MissedOrderNote } from "@/components/orders/missed-order";
import { OrderSummary, egp } from "@/components/orders/order-summary";
import { SendConfirmationButton } from "@/components/whatsapp/send-confirmation";
import { OrderChatStatus, chatStateOf, useChatStates, type ChatState } from "@/components/whatsapp/order-chat-status";
import { governorateArabic } from "@/lib/governorates";
import { CancelOrderDialog } from "@/components/orders/cancel-order-dialog";
import {
    CANCEL_REASON_FALLBACK, FLOW_CANCEL_REASONS, LAST_STEP_CANCEL_REASONS, cancelReasonLabel, type CancelReason,
} from "@/lib/orders/cancel-reasons";
import { bundleLabel, expandBundle, loadBundles, type Bundle, type BundleVariant } from "@/lib/bundles";

const ORDER_SELECT = `
    *,
    order_items (
        *,
        variants (
            title, sku, product_id,
            products (name, description)
        )
    )
`;


/**
 * Waiting, and from a store (EasyOrders or Shopify) or a missed order from it
 * (someone who filled the store's form and left; 20261101_missed_orders_in_queue.sql):
 * what this page lists.
 */
function isWaitingPlatformOrder(o: { status?: string | null; easyorders_id?: string | null; tags?: unknown }) {
    if (String(o.status || '').trim().toLowerCase() !== 'waiting') return false;
    if (!MISSED_ORDERS_IN_QUEUE && isMissed(o)) return false;
    const tags = o.tags ? JSON.stringify(o.tags).toLowerCase() : "";
    return !!o.easyorders_id || tags.includes("easyorders") || tags.includes("shopify") || tags.includes(MISSED_TAG);
}

const MISSED_TAG = "missed-order";
const CARDS_PER_PAGE = 15;

/** Where the order's customer is on WhatsApp, for the filter. */
type WaFilter = "all" | "no_whatsapp" | "not_sent" | "waiting_us" | "replied" | "no_reply";
const WA_FILTERS: { key: WaFilter; label: string }[] = [
    { key: "all", label: "الواتساب: الكل" },
    { key: "not_sent", label: "ماتبعتلوش تأكيد" },
    { key: "no_reply", label: "اتبعتله ومردش" },
    { key: "waiting_us", label: "رد ومستني ردنا" },
    { key: "replied", label: "رد علينا" },
    { key: "no_whatsapp", label: "مش عليه واتساب" },
];
function waStateOf(s: ChatState | null | undefined): Exclude<WaFilter, "all"> {
    if (s?.noWhatsApp) return "no_whatsapp";
    if (!s?.confirmSentAt) return "not_sent";
    if (s.waiting > 0) return "waiting_us";
    return s.lastInAt && s.lastInAt >= s.confirmSentAt ? "replied" : "no_reply";
}
const isMissed = (o: { tags?: unknown }) => Array.isArray(o.tags) && o.tags.includes(MISSED_TAG);

/** Missed orders become Waiting orders here; harmless before the migration is run. */
async function promoteMissedOrders(businessId: string) {
    if (!MISSED_ORDERS_IN_QUEUE) return;
    await supabase.rpc("missed_leads_promote", { p_business_id: businessId });
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
} from "@/components/ui/alert-dialog";

interface OrderItem {
    id: string;
    variant_id: string | null;
    quantity: number;
    price_at_sale: number;
    cost_at_sale?: number | null;
    unmapped_name?: string;
    unmapped_sku?: string;
    /** The bundle this line was written from (20261108_bundles.sql). */
    bundle_variant_id?: string | null;
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
    total_cost?: number | null;
    shipping_cost: number;
    discount?: number | null;
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
    // The queue (20261119_confirm_queue.sql)
    next_attempt_at?: string | null;
    claimed_by?: string | null;
    claimed_at?: string | null;
    // The confirmation flow (20261120_confirm_flow.sql)
    confirm_rounds?: number | null;
    whatsapp_sent_by?: string | null;
    whatsapp_sent_at?: string | null;
}

interface Variant {
    id: string;
    title: string;
    sku: string;
    sale_price: number;
    cost_price?: number | null;
    products: { name: string };
}


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
    const [bundles, setBundles] = useState<Bundle[]>([]);
    
    // Treasury Modal state
    const [depositModalOpen, setDepositModalOpen] = useState(false);
    const [depositOrder, setDepositOrder] = useState<Order | null>(null);
    const [transactionAccount, setTransactionAccount] = useState("");
    const [depositLoading, setDepositLoading] = useState(false);
    const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
    const [platformFilter, setPlatformFilter] = useState<string>("all");
    
    const [selectedProductOverride, setSelectedProductOverride] = useState<Record<string, string>>({});

    
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
            loadBundles(supabase, activeBusiness.id).then(r => setBundles(r.bundles));
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
            .select('id, title, sku, sale_price, cost_price, products!inner(name)')
            .eq('products.business_id', activeBusiness.id);
        if (data) setVariants(data as any[]);
    };

    const fetchProducts = async () => {
        if (!activeBusiness) return;
        const { data, error } = await supabase
            .from('products')
            // sku is needed so the add-product search can match on it
            .select('*, variants(*)')
            .eq('business_id', activeBusiness.id)
            .order('name');
        if (error) console.error("Error fetching products:", error);
        // Archived products are not offered (20261117_products_inventory.sql).
        if (data) setProducts(activeCatalog(data));
    };

    const fetchOrders = async () => {
        setLoading(true);
        if (!activeBusiness) return;
        await promoteMissedOrders(activeBusiness.id);
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

    // EasyOrders' delivery rating for orders that arrived without one (see
    // delivery-rate-actions.ts). Each order is asked about once per visit; a
    // batch EasyOrders cut short is picked up again a little later.
    const rateAsked = useRef(new Set<string>());
    const [rateRetry, setRateRetry] = useState(0);
    const unrated = useMemo(
        () => orders.filter(o => o.easyorders_id && !deliveryRateOf(o.customer_info) && !rateAsked.current.has(o.id)).map(o => o.id),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [orders, rateRetry],
    );
    useEffect(() => {
        if (!activeBusiness || !unrated.length) return;
        const ids = unrated.slice(0, 15);
        // Marked before asking, so a re-render while this is out does not
        // send the same orders again.
        ids.forEach(id => rateAsked.current.add(id));
        fetchDeliveryRatesAction(activeBusiness.id, ids).then(({ rates, more }) => {
            if (Object.keys(rates).length) {
                setOrders(prev => prev.map(o => rates[o.id] ? { ...o, customer_info: { ...o.customer_info, delivery_rate: rates[o.id] } } : o));
            }
            if (more) {
                ids.forEach(id => { if (!rates[id]) rateAsked.current.delete(id); });
                setTimeout(() => setRateRetry(n => n + 1), 20_000);
            } else if (unrated.length > ids.length) {
                setRateRetry(n => n + 1);
            }
        }).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeBusiness?.id, unrated.join(",")]);

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
                await promoteMissedOrders(businessId);
                // With the attempt summary when the column exists; without it
                // until 20261006_confirmation_attempts.sql has been run.
                const query = (cols: string) => supabase.from('orders').select(cols).eq('business_id', businessId).ilike('status', 'waiting');
                const attempts = 'id, status, easyorders_id, tags, confirm_attempts, last_attempt_at, last_attempt_reason, last_attempt_note, last_attempt_by';
                let res = await query(`${attempts}, next_attempt_at, claimed_by, claimed_at`);
                if (res.error) res = await query(attempts);
                if (res.error) res = await query('id, status, easyorders_id, tags');
                const data = res.data as unknown as (AttemptSummary & { id: string; status: string; easyorders_id: string | null; tags: unknown })[] | null;
                if (res.error || !data) return;
                const attemptsById = new Map(data.map(o => [o.id, o]));
                if (data.some(o => o.confirm_attempts !== undefined)) {
                    setOrders(prev => {
                        let changed = false;
                        const keys = ["confirm_attempts", "last_attempt_at", "last_attempt_reason", "last_attempt_note", "last_attempt_by", "next_attempt_at", "claimed_by", "claimed_at"] as const;
                        const next = prev.map(o => {
                            const a = attemptsById.get(o.id);
                            // Only the columns the query brought back: before
                            // the queue migration the claim stays unknown.
                            if (!a || keys.every(k => a[k] === undefined || (a[k] ?? null) === (o[k] ?? null))) return o;
                            changed = true;
                            const patch: Partial<Order> = {};
                            for (const k of keys) if (a[k] !== undefined) (patch as Record<string, unknown>)[k] = a[k];
                            return { ...o, ...patch };
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
                    description: `Payment collection for Platform Order #${order.id.slice(0, 8)}${order.customer_info?.name ? ` (${order.customer_info.name})` : ""}`,
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

    const handleCancelOrder = async (orderId: string, reason: CancelReason, note: string | null) => {
        const targetOrder = orders.find(o => o.id === orderId);
        const card = takeOut(orderId);
        try {
            let moved: "done" | "gone";
            // Cancelled because they never answered: the last call is recorded
            // first, so the daily review does not take it for a cancel nobody
            // tried on, and bring it back.
            if (reason === "no_answer") {
                const r = await recordAttempt(orderId, "no_reply", "آخر محاولة قبل الإلغاء", null);
                if (r.ok && r.gone) { card.settle(); toast.info("الأوردر ده اتنقل أو اتلغى قبل كده من زميلك."); return; }
            }
            try {
                moved = await leaveWaiting(orderId, { status: 'Cancelled', cancel_reason: reason, cancel_note: note });
            } catch (e) {
                const code = (e as { code?: string })?.code;
                const older = CANCEL_REASON_FALLBACK[reason];
                if (code === "23514" && older) {
                    // A reason added by 20261120_confirm_flow.sql, before it has
                    // run: the nearest old one, with the words in the note.
                    moved = await leaveWaiting(orderId, {
                        status: 'Cancelled', cancel_reason: older,
                        cancel_note: [cancelReasonLabel(reason), note].filter(Boolean).join(" — "),
                    });
                } else {
                    // Until 20261107_cancellation_review.sql has run there is
                    // nowhere to keep the reason; cancel without it.
                    if (code !== "PGRST204" && code !== "42703") throw e;
                    moved = await leaveWaiting(orderId, { status: 'Cancelled' });
                }
            }
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
                        { field: "Status", old_value: targetOrder.status, new_value: "Cancelled" },
                        { field: "Cancel reason", old_value: "", new_value: [cancelReasonLabel(reason), note].filter(Boolean).join(" — ") },
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
        // Less the coupon's discount, as EasyOrders charged it (orders.discount).
        const newTotal = Math.max(0, newSubtotal + order.shipping_cost - (Number(order.discount) || 0));
        // The cost follows the lines too. It used to stay as the order arrived,
        // so an order whose unknown item was swapped for real products kept a
        // cost of 0, and every quantity change left it stale; profit is
        // generated from it, and so were Actual Returns and the dashboard.
        const newCost = itemsCost(newItems);

        setOrders(prev => prev.map(o => o.id === orderId
            ? { ...o, subtotal: newSubtotal, total_amount: newTotal, total_cost: newCost, order_items: newItems }
            : o));

        try {
            await enqueueSave(orderId, () => handleUpdateOrder(orderId, { subtotal: newSubtotal, total_amount: newTotal, total_cost: newCost }));
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
                cost_at_sale: Number(variant.cost_price) || 0,
                variants: {
                    title: variant.title,
                    sku: variant.sku,
                    product_id: '',
                    products: { name: variant.products?.name || "Mapped Product" }
                }
            }
            : item));

        try {
            await enqueueSave(orderId, () => handleUpdateItem(itemId, { variant_id: variantId, cost_at_sale: Number(variant.cost_price) || 0 }));

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


    /**
     * Write a bundle into an order as its products. `replace` is an unmapped
     * line that turned out to be this bundle (EasyOrders sends a bundle as one
     * product): it goes, and the bundle takes its quantity and its price.
     */
    const addBundleToOrder = async (orderId: string, bundle: Bundle, variant: BundleVariant, replace?: OrderItem) => {
        const order = ordersRef.current.find(o => o.id === orderId);
        if (!order || !activeBusiness) return;
        const lines = replace
            ? expandBundle(variant, Math.max(1, replace.quantity), replace.price_at_sale > 0 ? replace.price_at_sale : null)
            : expandBundle(variant, 1);
        const label = bundleLabel(bundle, variant);

        const { data: inserted, error } = await supabase.from('order_items').insert(lines.map(l => ({
            business_id: activeBusiness.id,
            order_id: orderId,
            variant_id: l.variant_id,
            quantity: l.quantity,
            price_at_sale: l.price_at_sale,
            cost_at_sale: l.cost_at_sale,
            bundle_variant_id: l.bundle_variant_id,
        }))).select('id');
        if (error || !inserted || inserted.length !== lines.length) {
            console.error("bundle insert", error);
            toast.error("الباندل ماتضافش، جرّب تاني.");
            return;
        }
        if (replace) {
            const { error: delError } = await supabase.from('order_items').delete().eq('business_id', activeBusiness.id).eq('id', replace.id);
            if (delError) toast.error("المنتجات اتضافت بس السطر القديم ماتشالش. امسحه بإيدك.");
        }

        const newItems: OrderItem[] = lines.map((l, k) => ({
            id: inserted[k].id,
            variant_id: l.variant_id,
            quantity: l.quantity,
            price_at_sale: l.price_at_sale,
            cost_at_sale: l.cost_at_sale,
            bundle_variant_id: l.bundle_variant_id,
            variants: { title: l.variantTitle, sku: l.sku || "", product_id: "", products: { name: l.productName } },
        }));
        await applyItemChange(orderId, items => [...items.filter(i => i.id !== replace?.id), ...newItems]);

        logBusinessAction({
            businessId: activeBusiness.id,
            userEmail: currentUser?.email || "Staff",
            actionType: "edit",
            entityType: "order",
            entityId: orderId,
            entityName: orderLogName(orderId, order.customer_info, "Platform Order"),
            changes: [{
                field: "Bundle",
                old_value: replace ? (replace.unmapped_name || "Unmapped Item") : null,
                new_value: `${label}: ${lines.map(l => `${l.productName} ×${l.quantity}`).join(" + ")}`,
            }],
        });
        toast.success(`اتضاف ${label}`);
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

    /** «Add Product»: one of the variant, at its price; true when it went in. */
    const addVariantToOrder = async (order: Order, prod: any, vari: any): Promise<boolean> => {
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
            return false;
        }
        const newItemObj = {
            id: newItem.id,
            variant_id: vari.id,
            quantity: 1,
            price_at_sale: vari.sale_price,
            cost_at_sale: vari.cost_price || 0,
            variants: { title: vari.title, sku: vari.sku || "", product_id: prod.id, products: { name: prod.name } },
        };
        await applyItemChange(order.id, items => [...items, newItemObj as OrderItem]);
        return true;
    };

    /** The edit section's actions for one order (components/orders/store-order-editor.tsx). */
    const editFor = (order: Order): OrderEditActions<Order> => ({
        saveStatus: saveStatus[order.id] || "",
        updateCustomerInfo, handleAutoSaveNotes, updateOrderField,
        updateOrderFields: (o, updates) => updateOrderFields(o, updates as Partial<Order>),
        updateOrderItem, mapVariantToItem, deleteItemFromOrder, addBundleToOrder,
        addVariant: addVariantToOrder,
        currentSubtotal: id => ordersRef.current.find(o => o.id === id)?.subtotal,
    });

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
            } else if (platformFilter === "missed") {
                matchesPlatform = isMissed(order);
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

    // The queue: every Waiting order sits in one state (lib/orders/confirm-queue.ts),
    // worked out again each minute so an order whose time comes moves to
    // "call now" on its own. The order's status stays Waiting throughout.
    const [queueTab, setQueueTabRaw] = useState<QueueTab>("new");
    // «للاتصال» opens first once it has someone in it, unless a tab was already picked.
    const tabPicked = useRef(false);
    const setQueueTab = (t: QueueTab) => { tabPicked.current = true; setQueueTabRaw(t); };
    const [shown, setShown] = useState(CARDS_PER_PAGE);
    const [failing, setFailing] = useState<Order | null>(null);
    const [cancelling, setCancelling] = useState<Order | null>(null);
    const [approving, setApproving] = useState<Order | null>(null);
    const [busy, setBusy] = useState<{ id: string; what: AttemptReason | "confirm" } | null>(null);
    const [focusId, setFocusId] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const chatStates = useChatStates(activeBusiness?.id, orders.map(o => o.customer_info?.phone));
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(timer);
    }, []);
    const me = currentUser?.email ?? null;

    // The WhatsApp, governorate and product filters (beside the search).
    const [waFilter, setWaFilter] = useState<WaFilter>("all");
    const [govFilter, setGovFilter] = useState("all");
    const [productFilter, setProductFilter] = useState("all");
    const govOf = (o: Order) => governorateArabic(o.customer_info?.governorate) || o.customer_info?.governorate || "";
    const productsOf = (o: Order) => (o.order_items || []).map(i => i.variants?.products?.name || i.unmapped_name || "").filter(Boolean);
    const filterChoices = useMemo(() => {
        const govs = new Map<string, number>(), prods = new Map<string, number>();
        for (const o of listed) {
            const g = govOf(o);
            if (g) govs.set(g, (govs.get(g) || 0) + 1);
            for (const p of new Set(productsOf(o))) prods.set(p, (prods.get(p) || 0) + 1);
        }
        const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]);
        return { govs: sorted(govs), prods: sorted(prods) };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listed]);
    const narrowed = listed.filter(o => (govFilter === "all" || govOf(o) === govFilter)
        && (productFilter === "all" || productsOf(o).includes(productFilter))
        && (waFilter === "all" || waStateOf(chatStateOf(chatStates, o.customer_info?.phone)) === waFilter));

    /** The order's tab: its step, or «للاتصال» when its number has no WhatsApp (an appointment still waits for its time). */
    const tabOf = (o: Order, at: number): QueueTab => {
        const st = queueStateOf(o, at);
        return st !== "scheduled" && chatStateOf(chatStates, o.customer_info?.phone)?.noWhatsApp ? "call" : st;
    };
    const byState = useMemo(() => {
        const m: Record<QueueTab, Order[]> = { call: [], new: [], whatsapp: [], last: [], scheduled: [] };
        for (const o of narrowed) m[tabOf(o, now)].push(o);
        m.call.sort(byDue);
        // The other lists: whoever has waited longest first. A WhatsApp sent
        // from my phone comes back to me first: only I can see whether they replied.
        const sentByMe = (o: Order) => (o.whatsapp_sent_at && !whatsappFromOther(o, me) ? 1 : 0);
        const mineFirst = (a: Order, b: Order) => sentByMe(b) - sentByMe(a) || byDue(a, b);
        // New orders: the one that just came in first. A customer who ordered
        // a minute ago still remembers it and answers; the older ones follow.
        m.new.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        m.whatsapp.sort(mineFirst);
        m.last.sort(mineFirst);
        m.scheduled.sort(byDue);
        return m;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [narrowed, now, me, chatStates]);
    const queueCounts = {
        call: byState.call.length, new: byState.new.length, whatsapp: byState.whatsapp.length, last: byState.last.length, scheduled: byState.scheduled.length,
    };
    const visibleOrders = byState[queueTab];
    useEffect(() => {
        if (!tabPicked.current && queueCounts.call > 0) setQueueTabRaw("call");
    }, [queueCounts.call]);

    // Picked cards, for «ابعت رسالة التأكيد» on many at once; a tab or filter change clears them.
    const [picked, setPicked] = useState<Set<string>>(new Set());
    useEffect(() => { setPicked(new Set()); }, [queueTab, waFilter, govFilter, productFilter, platformFilter, searchQuery, fromDate, toDate, repeatOnly]);
    const pickedHere = visibleOrders.filter(o => picked.has(o.id));
    const allPicked = visibleOrders.length > 0 && pickedHere.length === visibleOrders.length;
    const togglePick = (id: string) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const [bulkAsk, setBulkAsk] = useState(false);
    const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
    const sendConfirmations = async () => {
        if (!activeBusiness) return;
        const ids = pickedHere.map(o => o.id);
        const tally: Record<string, number> = {};
        const errors = new Set<string>();
        setBulkProgress({ done: 0, total: ids.length });
        for (let i = 0; i < ids.length; i += 10) {
            const res = await fetch("/api/whatsapp/send-confirmations", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ business_id: activeBusiness.id, order_ids: ids.slice(i, i + 10) }),
            }).catch(() => null);
            const body = await res?.json().catch(() => null) as { results?: { outcome: string; error?: string }[]; stopped?: string | null; error?: string } | null;
            if (!res?.ok || !body?.results) { errors.add(body?.error || "الإرسال وقف، جرّب تاني."); break; }
            for (const r of body.results) { tally[r.outcome] = (tally[r.outcome] || 0) + 1; if (r.error) errors.add(r.error); }
            setBulkProgress({ done: Math.min(ids.length, i + 10), total: ids.length });
            if (body.stopped) break;
        }
        setBulkProgress(null);
        setPicked(new Set());
        const said = [
            tally.confirm && `اتبعت تأكيد لـ ${tally.confirm}`,
            tally.reminder && `تذكير لـ ${tally.reminder} (كان اتبعتلهم قبل كده)`,
            tally.recent && `${tally.recent} اتبعتلهم من أقل من 3 ساعات فاستنّينا`,
            tally.no_whatsapp && `${tally.no_whatsapp} مش عليهم واتساب (في «للاتصال»)`,
            tally.not_waiting && `${tally.not_waiting} اتأكدوا أو اتلغوا خلاص`,
            tally.no_phone && `${tally.no_phone} من غير رقم`,
            tally.failed && `${tally.failed} ماتبعتوش`,
        ].filter(Boolean).join("، ");
        if (tally.confirm || tally.reminder) toast.success(said || "اتبعت.");
        else toast.info(said || "ماتبعتش حاجة.");
        if (errors.size) toast.error([...errors].slice(0, 2).join(" — "));
    };

    const patchOrder = (id: string, patch: Partial<Order>) =>
        setOrders(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));
    const dropOrder = (id: string) => setOrders(prev => prev.filter(o => o.id !== id));

    const onAttemptSaved = (order: Order, summary: AttemptSummary) => {
        const merged = { ...order, ...summary, claimed_by: null, claimed_at: null };
        patchOrder(order.id, { ...summary, claimed_by: null, claimed_at: null });
        setFailing(null);
        if (focusId === order.id) setFocusId(null);
        toast.success(nextTryToast(merged));
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

    /** One tap on "no answer, WhatsApp sent" or "no answer at all". */
    const quickAttempt = async (order: Order, reason: AttemptReason) => {
        setBusy({ id: order.id, what: reason });
        const r = await recordAttempt(order.id, reason, null, null);
        setBusy(null);
        if (!r.ok) { toast.error(r.message); return; }
        if (r.gone) { toast.info("الأوردر ده اتنقل أو اتلغى قبل كده من زميلك."); dropOrder(order.id); return; }
        onAttemptSaved(order, r.summary);
    };

    /**
     * "I'm calling this one", as a number is dialled or WhatsApp opens. It
     * never stops the call; if a colleague holds the order, the card says so.
     */
    const claim = async (order: Order) => {
        const other = claimedByOther(order, me, Date.now());
        if (other) toast.warning(`${shortName(other)} بيكلّم العميل ده دلوقتي.`);
        patchOrder(order.id, other ? {} : { claimed_by: me, claimed_at: new Date().toISOString() });
        const r = await claimOrder(order.id, { force: !!other });
        if (r?.status === "done") patchOrder(order.id, { claimed_by: r.claimed_by, claimed_at: r.claimed_at });
    };

    /**
     * The next order to call: the one that has waited longest among those
     * due now and not held by someone else. It is claimed on the server
     * first, so two moderators pressing at once get different orders.
     */
    const nextUp = (["call", ...DUE_STATES] as QueueTab[]).flatMap(k => byState[k]).filter(o => o.id !== focusId && !claimedByOther(o, me, now) && !inFlight.current.has(o.id));
    const [pickingNext, setPickingNext] = useState(false);
    const takeNext = async () => {
        setPickingNext(true);
        try {
            // Moving on without recording anything frees the one in hand.
            const held = focusId ? orders.find(o => o.id === focusId) : null;
            if (held && isMine(held, me, Date.now())) {
                patchOrder(held.id, { claimed_by: null, claimed_at: null });
                claimOrder(held.id, { release: true });
            }
            for (const o of nextUp.slice(0, 5)) {
                const r = await claimOrder(o.id);
                if (r?.status === "taken") { patchOrder(o.id, { claimed_by: r.claimed_by, claimed_at: r.claimed_at }); continue; }
                if (r?.status === "gone") { dropOrder(o.id); continue; }
                if (r?.status === "done") patchOrder(o.id, { claimed_by: r.claimed_by, claimed_at: r.claimed_at });
                const tab = tabOf(o, Date.now());
                setQueueTab(tab);
                setFocusId(o.id);
                const i = byState[tab].findIndex(x => x.id === o.id);
                if (i >= shown) setShown(i + CARDS_PER_PAGE);
                return;
            }
            toast.info("كل الأوردرات اللي عليها الدور زمايلك بيكلّموها.");
        } finally {
            setPickingNext(false);
        }
    };
    useEffect(() => {
        if (!focusId) return;
        const t = setTimeout(() => document.getElementById(`po-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
        return () => clearTimeout(t);
    }, [focusId]);

    // The editing fields stay closed unless opened, or unless something on the
    // order has to be fixed before it can be confirmed.
    const [editOpen, setEditOpen] = useState<Record<string, boolean>>({});
    const needsFix = (o: Order) => !o.order_items?.length || o.order_items.some(i => !i.variant_id)
        || (Array.isArray(o.tags) && o.tags.includes("total-mismatch"));
    const isEditing = (o: Order) => editOpen[o.id] ?? needsFix(o);
    const toggleEditing = (o: Order) => setEditOpen(prev => ({ ...prev, [o.id]: !isEditing(o) }));

    /** «خد بالك»: every warning on an order, one line each. */
    const headsUpFor = (o: Order): HeadsUpItem[] => {
        const out: HeadsUpItem[] = [];
        const rep = repeats.get(o.id);
        if (rep) out.push({
            key: "repeat", tone: rep.doubleRisk ? "danger" : "warning", icon: rep.doubleRisk ? AlertTriangle : Repeat,
            text: rep.doubleRisk
                ? "الرقم ده عليه أوردر تاني مفتوح. اتأكد إنه مش نفس الأوردر قبل ما تأكد، وإلا هيتشحن مرتين."
                : "الرقم ده طلب أوردرات تانية قريب.",
            more: <RepeatOrdersAlert info={rep} onPage={onPageIds} />, moreLabel: `شوفهم (${rep.related.length})`,
        });
        if (!o.order_items?.length || o.order_items.some(i => !i.variant_id)) out.push({
            key: "unmapped", tone: "danger", icon: Link2Off, text: "فيه منتج مش متربط. اربطه في التعديل تحت قبل ما تأكد.",
        });
        if (Array.isArray(o.tags) && o.tags.includes("total-mismatch")) out.push({
            key: "total", tone: "danger", icon: AlertTriangle, text: "الإجمالي مش زي اللي المتجر بعته. راجع الكميات والأسعار قبل ما تأكد.",
        });
        const rate = deliveryRateOf(o.customer_info);
        if (rate === "low") out.push({ key: "rate", tone: "danger", icon: HandCoins, text: "استلامه ضعيف: اطلب ديبوزت قبل ما تأكد. لو رفض، اتأكد من العنوان والميعاد كويس." });
        if (rate === "moderate") out.push({ key: "rate", tone: "warning", icon: HandCoins, text: "استلامه متوسط: يفضّل تطلب ديبوزت، خصوصًا لو الأوردر كبير." });
        if (isMissed(o)) out.push({
            key: "missed", tone: "info", icon: ShoppingBasket, text: "ماكملش الطلب في المتجر. اتأكد من المنتج والعدد قبل ما تأكد.",
            more: <MissedOrderNote info={o.customer_info} />, moreLabel: "التفاصيل",
        });
        if (JSON.stringify(o.tags || "").includes("reopened")) out.push({
            key: "reopened", tone: "info", icon: Undo2, text: "كان اتلغى ورجع عشان يتحاول عليه تاني: اتلغى بسرعة أو من غير محاولات كفاية.",
        });
        return out;
    };

    /** Confirm: map every product first, then a last look before it moves on. */
    const askConfirm = (order: Order) => {
        if (!order.order_items?.length || order.order_items.some(i => !i.variant_id)) {
            document.getElementById(`po-${order.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            toast.error("فيه منتج مش متربط — اربطه تحت الأول.");
            return;
        }
        setApproving(order);
    };

    // A twin that is itself a card on screen is linked by anchor; anything
    // else opens in a new tab.
    const onPageIds = new Set(visibleOrders.map(o => o.id));

    // Cards are drawn a page at a time. With missed orders in the queue the
    // list passed 130 cards, all drawn at once and all drawn again on every
    // keystroke in any of them; the next page is drawn as the moderator
    // scrolls near the end of this one.
    useEffect(() => { setShown(CARDS_PER_PAGE); }, [queueTab, platformFilter, searchQuery, fromDate, toDate, repeatOnly, waFilter, govFilter, productFilter]);
    const drawnOrders = visibleOrders.slice(0, shown);
    const moreRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = moreRef.current;
        if (!el) return;
        // Observed afresh after each page, so a sentinel still in view asks
        // for the next one straight away.
        const io = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting)) setShown(n => n + CARDS_PER_PAGE);
        }, { rootMargin: "1200px 0px" });
        io.observe(el);
        return () => io.disconnect();
    }, [shown, visibleOrders.length]);

    // A twin's anchor link (#po-<id>) may point past the drawn page: draw up
    // to it, then scroll to it once it is there.
    const scrollTo = useRef<string | null>(null);
    useEffect(() => {
        const go = () => {
            const id = window.location.hash.match(/^#po-(.+)$/)?.[1];
            if (!id) return;
            const i = visibleOrders.findIndex(o => o.id === id);
            if (i >= shown) {
                scrollTo.current = id;
                setShown(i + CARDS_PER_PAGE);
            }
        };
        window.addEventListener("hashchange", go);
        return () => window.removeEventListener("hashchange", go);
    }, [visibleOrders, shown]);
    useEffect(() => {
        if (!scrollTo.current) return;
        document.getElementById(`po-${scrollTo.current}`)?.scrollIntoView();
        scrollTo.current = null;
    }, [shown]);


    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="flex-1 space-y-4 p-4 pt-4 sm:p-8 sm:pt-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="flex items-center text-2xl font-bold tracking-tight sm:text-3xl">
                        {t("Platform Synced Orders")}
                        {!loading && orders.length > 0 && (
                            <Badge variant="secondary" className="ms-3 bg-primary/10 px-3 py-1 text-base text-primary sm:text-lg">
                                {orders.length} {t("Waiting")}
                            </Badge>
                        )}
                    </h2>
                    <p className="hidden text-muted-foreground sm:block">{t("Manage incoming orders from EasyOrders and Shopify waiting for review.")}</p>
                </div>
                {/* Missed orders are in the list above as orders; this is
                    the record behind them, bots included. */}
                <Link href="/platform-orders/missed" className="hidden shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:block">
                    سجل الطلبات الناقصة والبوتات
                </Link>
            </div>
            
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:py-2">
                <div className="relative col-span-2 w-full sm:flex-1 sm:max-w-sm">
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
                        {MISSED_ORDERS_IN_QUEUE && <SelectItem value="missed">طلبات ناقصة</SelectItem>}
                    </SelectContent>
                </Select>
                <DateRangePicker className="min-w-0" />
                <Select value={waFilter} onValueChange={v => setWaFilter(v as WaFilter)}>
                    <SelectTrigger className={cn("h-10 w-full sm:w-[180px]", waFilter !== "all" && "border-primary text-primary")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {WA_FILTERS.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={govFilter} onValueChange={setGovFilter}>
                    <SelectTrigger className={cn("h-10 w-full sm:w-[170px]", govFilter !== "all" && "border-primary text-primary")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">كل المحافظات</SelectItem>
                        {filterChoices.govs.map(([g, n]) => <SelectItem key={g} value={g}>{g} ({n})</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={productFilter} onValueChange={setProductFilter}>
                    <SelectTrigger className={cn("col-span-2 h-10 w-full sm:w-[220px]", productFilter !== "all" && "border-primary text-primary")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">كل المنتجات</SelectItem>
                        {filterChoices.prods.map(([p, n]) => <SelectItem key={p} value={p}>{p} ({n})</SelectItem>)}
                    </SelectContent>
                </Select>
                {(waFilter !== "all" || govFilter !== "all" || productFilter !== "all") && (
                    <Button variant="ghost" className="col-span-2 h-10 gap-1 sm:w-auto" onClick={() => { setWaFilter("all"); setGovFilter("all"); setProductFilter("all"); }}>
                        <X className="h-4 w-4" />شيل الفلاتر
                    </Button>
                )}
                {/* Only there when something is flagged, and red when two
                    orders on one number could both still ship. */}
                {(repeatCount > 0 || repeatOnly) && (
                    <Button
                        variant={repeatOnly ? "default" : "outline"}
                        onClick={() => setRepeatOnly(v => !v)}
                        title={t("Show only orders whose number has other orders")}
                        className={cn(
                            "col-span-2 h-10 w-full gap-1.5 sm:w-auto",
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

            {cancelling && (
                <CancelOrderDialog
                    customerName={cancelling.customer_info?.name || ""}
                    only={stepOf(cancelling, now) === 3 ? LAST_STEP_CANCEL_REASONS : FLOW_CANCEL_REASONS}
                    description={stepOf(cancelling, now) === 3 ? "اختار ليه اتلغى: لو مردش بعد كل المحاولات اختار «مابيردش»." : "العميل قال إيه؟"}
                    open={!!cancelling}
                    onOpenChange={o => { if (!o) setCancelling(null); }}
                    onConfirm={(reason, note) => { const id = cancelling.id; setCancelling(null); return handleCancelOrder(id, reason, note); }}
                />
            )}
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

            <AlertDialog open={bulkAsk} onOpenChange={setBulkAsk}>
                <AlertDialogContent dir="rtl">
                    <AlertDialogHeader className="text-start sm:text-start">
                        <AlertDialogTitle>ابعت رسالة التأكيد لـ {pickedHere.length} عميل؟</AlertDialogTitle>
                        <AlertDialogDescription>
                            هتتبعت من رقم الشركة. اللي ماوصلتلوش رسالة التأكيد قبل كده هتوصله، واللي وصلته من 3 ساعات أو أكتر هيوصله تذكير.
                            اللي اتبعتله من أقل من 3 ساعات أو رقمه مش عليه واتساب مش هيتبعتله.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2">
                        <AlertDialogCancel className="h-12">رجوع</AlertDialogCancel>
                        <AlertDialogAction className="h-12 bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700"
                            onClick={() => { setBulkAsk(false); sendConfirmations(); }}>
                            <MessageSquareText className="h-5 w-5" />ابعت
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* One confirm dialog for the page, opened by a card's "confirm". */}
            <AlertDialog open={!!approving} onOpenChange={o => { if (!o) setApproving(null); }}>
                <AlertDialogContent dir="rtl">
                    <AlertDialogHeader className="text-start sm:text-start">
                        <AlertDialogTitle>تأكيد أوردر {approving?.customer_info?.name || ""}؟</AlertDialogTitle>
                        <AlertDialogDescription>
                            {formatCurrency(approving?.total_amount || 0)} — هيروح Pending ويبدأ تجهيزه.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {/* Said again at the one moment it can still be acted on:
                        after this the order goes to fulfilment alongside the other one. */}
                    {approving && repeats.get(approving.id)?.doubleRisk && (
                        <div className="space-y-1 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                            <p className="font-semibold">الرقم ده عليه أوردر مفتوح تاني:</p>
                            <p className="font-mono">
                                {repeats.get(approving.id)!.related.filter(r => r.open).map(r => `#${r.id.slice(0, 8)} (${r.status})`).join(" · ")}
                            </p>
                            <p>اتأكد مع العميل إن ده أوردر جديد مش نفس الأوردر مرتين.</p>
                        </div>
                    )}
                    <AlertDialogFooter className="gap-2">
                        <AlertDialogCancel className="h-12">رجوع</AlertDialogCancel>
                        <AlertDialogAction className="h-12 bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700"
                            onClick={() => {
                                const o = approving;
                                setApproving(null);
                                if (o) { if (focusId === o.id) setFocusId(null); handleMoveToPending(o); }
                            }}>
                            <Check className="h-5 w-5" />أكّد
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

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
                <div className="space-y-3" dir="rtl">
                    <QueueTabs value={queueTab} onChange={setQueueTab} counts={queueCounts} />
                    {queueTab === "call" && queueCounts.call > 0 && (
                        <p className="text-sm font-medium text-orange-800 dark:text-orange-300">الأرقام دي مش عليها واتساب، فرسالة التأكيد ماوصلتلهمش. لازم تتصل بيهم.</p>
                    )}
                    {visibleOrders.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-muted/30 px-3 py-2">
                            <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-semibold">
                                <Checkbox checked={allPicked ? true : pickedHere.length ? "indeterminate" : false}
                                    onCheckedChange={() => setPicked(allPicked ? new Set() : new Set(visibleOrders.map(o => o.id)))} />
                                {pickedHere.length ? `اخترت ${pickedHere.length} من ${visibleOrders.length}` : `اختار الكل (${visibleOrders.length})`}
                            </label>
                            {pickedHere.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
                                    <Button size="sm" variant="ghost" className="h-10" onClick={() => setPicked(new Set())}>إلغاء الاختيار</Button>
                                    {queueTab !== "call" && <Button size="sm" disabled={!!bulkProgress} onClick={() => setBulkAsk(true)}
                                        className="h-10 gap-2 bg-emerald-600 font-semibold text-white hover:bg-emerald-700">
                                        {bulkProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
                                        {bulkProgress ? `بيتبعت ${bulkProgress.done} من ${bulkProgress.total}` : `ابعت رسالة التأكيد (${pickedHere.length})`}
                                    </Button>}
                                </div>
                            )}
                        </div>
                    )}
                    {queueTab === "whatsapp" && queueCounts.whatsapp > 0 && (
                        <p className="text-sm text-muted-foreground">اتبعتلهم واتساب من 4 ساعات أو أكتر. اللي اتبعتلهم من موبايلك فوق.</p>
                    )}
                    {queueTab === "last" && queueCounts.last > 0 && (
                        <p className="text-sm text-muted-foreground">آخر محاولة: لو مفيش رد بعدها الغي الأوردر. فيها كمان الأوردرات اللي عدّى عليها أكتر من 3 أيام.</p>
                    )}
                    {queueTab === "scheduled" && queueCounts.scheduled > 0 && (
                        <p className="text-sm text-muted-foreground">ليهم ميعاد لسه ماجاش. أول ما ييجي ميعادهم بيرجعوا لوحدهم في الخطوة بتاعتهم.</p>
                    )}
                </div>
            )}

            {/* The one button a moderator needs to work the queue: it picks
                and claims the order that has waited longest. On a phone it
                stays at the bottom of the screen, under the thumb. */}
            {orders.length > 0 && (
                <div dir="rtl" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
                    <Button onClick={takeNext} disabled={pickingNext || nextUp.length === 0}
                        className="h-14 w-full gap-2 text-base font-bold sm:h-12 sm:w-auto sm:px-8 [&_svg]:size-5">
                        {pickingNext ? <Loader2 className="animate-spin" /> : <PhoneCall />}
                        {nextUp.length ? `اللي عليه الدور (${nextUp.length})` : "مفيش حد عليه الدور دلوقتي"}
                    </Button>
                </div>
            )}

            <div id="platform-orders-table" className="pb-24 sm:pb-0">
            {visibleOrders.length === 0 && orders.length > 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-14 text-center text-muted-foreground" dir="rtl">
                    <PackageSearch className="mb-3 h-10 w-10 opacity-20" />
                    <p className="font-medium">
                        {queueTab === "scheduled" ? "مفيش أوردرات ليها ميعاد" : "مفيش أوردرات هنا دلوقتي 👌"}
                    </p>
                    {queueTab !== "scheduled" && DUE_STATES.some(k => k !== queueTab && queueCounts[k] > 0) && (
                        <button className="mt-2 text-sm text-primary underline" onClick={() => setQueueTab(DUE_STATES.find(k => k !== queueTab && queueCounts[k] > 0)!)}>
                            فيه أوردرات عليها الدور في «{DUE_STATES.filter(k => k !== queueTab && queueCounts[k] > 0).map(k => ({ new: "جديد", whatsapp: "بعتلهم واتساب", last: "آخر فرصة", scheduled: "", call: "للاتصال" })[k]).join("» و«")}»
                        </button>
                    )}
                    {queueTab !== "scheduled" && queueCounts.scheduled > 0 && (
                        <button className="mt-2 text-sm text-primary underline" onClick={() => setQueueTab("scheduled")}>
                            {queueCounts.scheduled} ليهم ميعاد بعدين
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

                <div className="mx-auto grid w-full max-w-3xl gap-6">
                    {drawnOrders.map(order => {
                        const info = order.customer_info || {};
                        return (
                        <Card
                            key={order.id}
                            id={`po-${order.id}`}
                            className={cn(
                                "gap-0 overflow-hidden rounded-2xl py-0 shadow-sm scroll-mt-24",
                                focusId === order.id && "border-emerald-500 ring-4 ring-emerald-500/30",
                                picked.has(order.id) && focusId !== order.id && "border-primary ring-2 ring-primary/30",
                            )}
                        >
                            {/* 1. Who and how much. */}
                            <div dir="rtl" className="flex items-start justify-between gap-3 p-4 pb-4 sm:px-5">
                                <div className="min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <Checkbox aria-label="اختار الأوردر" className="size-5" checked={picked.has(order.id)} onCheckedChange={() => togglePick(order.id)} />
                                        <h3 className="break-words text-xl font-bold leading-tight">{info.name || "من غير اسم"}</h3>
                                        <ClaimBadge order={order} me={me} now={now} />
                                    </div>
                                    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                                        {info.governorate && <span>{governorateArabic(info.governorate) || info.governorate}</span>}
                                        <span>وصل {ago(order.created_at)}</span>
                                        <span className="font-mono text-xs" dir="ltr">#{order.id.slice(0, 8)}</span>
                                        {deliveryRateOf(order.customer_info) === "high" && <span className="font-medium text-emerald-700 dark:text-emerald-400">بيستلم أوردراته</span>}
                                    </p>
                                </div>
                                <p className="shrink-0 text-xl font-bold tabular-nums">{egp(order.total_amount)}</p>
                            </div>
                            <OrderChatStatus state={chatStateOf(chatStates, info.phone)} now={now} />

                            {/* 2. What to do now, with the buttons to do it. */}
                            <FlowInstruction order={order} me={me} missed={isMissed(order)} now={now}>
                                <ContactActions order={order as any} storeName={storeName} size="default" big
                                    inverse={queueStateOf(order, now) !== "scheduled"} onContact={() => claim(order)} />
                                {activeBusiness && !chatStateOf(chatStates, info.phone)?.confirmSentAt && <SendConfirmationButton order={order as any} businessId={activeBusiness.id} />}
                            </FlowInstruction>

                            {/* 3. What to keep in mind, and what happened last time. */}
                            <div dir="rtl" className="space-y-3 pt-4">
                                <HeadsUp items={headsUpFor(order)} />
                                {(order.confirm_attempts ?? 0) > 0 && (
                                    <div className="space-y-1 px-4 sm:px-5">
                                        <h4 className="text-sm font-bold">آخر محاولة</h4>
                                        <LastAttempt order={order} />
                                        <AttemptHistory orderId={order.id} count={order.confirm_attempts ?? 0} />
                                    </div>
                                )}
                            </div>

                            {/* 4. The order, to read out; the fields open on «عدّل». */}
                            <OrderSummary
                                items={order.order_items || []}
                                shipping={order.shipping_cost || 0}
                                paid={order.paid_amount}
                                place={[governorateArabic(info.governorate) || info.governorate, info.area || info.city, info.address].filter(Boolean).join("، ")}
                                note={order.notes}
                                internalNote={info.internal_workbench_notes}
                                editing={isEditing(order)}
                                onToggle={() => toggleEditing(order)}
                            />
                            {isEditing(order) && <CardContent className="border-t px-4 py-5 sm:px-6">
                                <StoreOrderEditor order={order} businessId={activeBusiness?.id} products={products} bundles={bundles} edit={editFor(order)} />
                            </CardContent>}
                            {/* 5. What happened on the call, under the thumb. */}
                            <div className="border-t bg-muted/30 p-4 sm:p-5">
                                <FlowActions
                                    order={order}
                                    now={now}
                                    busy={busy?.id === order.id ? busy.what : null}
                                    onConfirm={() => askConfirm(order)}
                                    onAttempt={reason => quickAttempt(order, reason)}
                                    onOther={() => setFailing(order)}
                                    onCancel={() => setCancelling(order)}
                                />
                            </div>
                        </Card>
                        );
                    })}
                    {visibleOrders.length > shown && (
                        <div ref={moreRef} className="flex justify-center" dir="rtl">
                            <Button variant="outline" onClick={() => setShown(n => n + CARDS_PER_PAGE)}>
                                اعرض كمان ({visibleOrders.length - shown} باقيين)
                            </Button>
                        </div>
                    )}
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
