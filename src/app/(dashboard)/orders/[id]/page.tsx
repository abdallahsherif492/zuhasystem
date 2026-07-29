"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { STOCK_OUT_STATUSES } from "@/lib/inventory";
import { syncStatusToEasyOrders } from "@/lib/easyorders";
import { processOrderForVrobo } from "@/lib/vrobo/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, Printer, Save, Edit, PlusCircle, Trash2, Check, ChevronsUpDown, Search } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const ORDER_STATUSES = ["Pending", "Processing", "Prepared", "Hold To redeliver", "Shipped", "Delivered", "Returning", "Cancelled", "Returned", "Unavailable"];
const GOVERNORATES = [
    "Cairo", "New Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
];

const CHANNELS = ["Facebook", "Instagram", "Tiktok", "Tiktok Website", "Website", "Whatsapp"];

import { useBusiness } from "@/contexts/BusinessContext";
import { logBusinessAction, ActionDiff } from "@/lib/logs/actions-logger";

export default function OrderDetailsPage() {
    const { activeBusiness, currentUser } = useBusiness();

    const params = useParams();
    const router = useRouter();
    const orderId = params.id as string;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [order, setOrder] = useState<any>(null);

    // Product Data for Selector
    const [products, setProducts] = useState<any[]>([]);
    const [shippingCompanies, setShippingCompanies] = useState<any[]>([]);
    const [selectedProduct, setSelectedProduct] = useState("");
    const [selectedVariant, setSelectedVariant] = useState("");

    // Edit State
    const [editForm, setEditForm] = useState({
        customerName: "",
        customerPhone: "",
        customerPhone2: "",
        customerAddress: "",
        customerGov: "",
        status: "",
        shippingCost: 0,
        discount: 0,
        channel: "",
        shippingCompanyId: "",
        tags: "",
        notes: "",

        createdAt: "",
        paymentStatus: "",
        paidAmount: 0,
    });

    // Items Editing State
    // We map existing items to this structure and allow adding new ones.
    const [editItems, setEditItems] = useState<any[]>([]);

    // Transaction UI State
    const [showTransactionDialog, setShowTransactionDialog] = useState(false);
    const [completedOrder, setCompletedOrder] = useState<{ id: string, amount: number, cName: string, cPhone: string } | null>(null);
    const [transactionAccount, setTransactionAccount] = useState<string>("");
    const [transactionLoading, setTransactionLoading] = useState(false);
    const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);

    useEffect(() => {
        if (activeBusiness) {
            fetchOrderDetails();
            fetchProducts();
            fetchAccounts();
            fetchShippingCompanies();
        }
    }, [orderId, activeBusiness]);

    // Helpers for Product Selection
    const activeProduct = products.find((p) => p.id === selectedProduct);
    const activeVariant = activeProduct?.variants.find((v: any) => v.id === selectedVariant);

    async function fetchProducts() {
        if (!activeBusiness) return;
        const { data } = await supabase
            .from("products")
            .select("*, variants(*)")
            .eq("business_id", activeBusiness.id)
            .order("name");
        setProducts(data || []);
    }

    async function fetchAccounts() {
        if (!activeBusiness) return;
        try {
            const { data } = await supabase
                .from("financial_accounts")
                .select("id, name")
                .eq("business_id", activeBusiness.id)
                .order("name");
            if (data && data.length > 0) {
                setAccounts(data);
            } else {
                setAccounts([{ id: "default", name: "الخزينة الرئيسية" }]);
            }
        } catch (e) {
            console.error("Error fetching treasuries:", e);
        }
    }


    async function fetchShippingCompanies() {
        if (!activeBusiness) return;
        const { data } = await supabase
            .from("shipping_companies")
            .select("*")
            .eq("business_id", activeBusiness.id)
            .eq("active", true)
            .order("name");
        setShippingCompanies(data || []);
    }

    async function fetchOrderDetails() {
        if (!activeBusiness) return;
        try {
            const { data, error } = await supabase
                .from("orders")
                .select(`
                    *,
                    items:order_items (
                        *,
                        variant:variants (
                            title,
                            cost_price,
                            stock_qty,
                            track_inventory,
                            product:products (name)
                        )
                    )
                `)
                .eq("business_id", activeBusiness!.id)
                .eq("id", orderId)
                .single();

            if (error) throw error;
            setOrder(data);

            // Initialize Edit Form
            setEditForm({
                customerName: data.customer_info?.name || "",
                customerPhone: data.customer_info?.phone || "",
                customerPhone2: data.customer_info?.phone2 || "",
                customerAddress: data.customer_info?.address || "",
                customerGov: data.customer_info?.governorate || "",
                status: data.status,
                shippingCost: data.shipping_cost || 0,
                discount: data.discount || 0,
                channel: data.channel || "",
                shippingCompanyId: data.shipping_company_id || "",
                tags: (data.tags || []).join(", "),
                notes: data.notes || "",

                createdAt: data.created_at ? new Date(data.created_at).toISOString().slice(0, 16) : "",
                paymentStatus: data.payment_status || "Not Paid",
                paidAmount: data.paid_amount || 0
            });

            // Initialize Edit Items
            // We ensure we carry over necessary fields for display and logic
            setEditItems(data.items.map((item: any) => ({
                id: item.id, // Keep ID for updates
                variantId: item.variant_id,
                productName: item.variant?.product?.name,
                variantTitle: item.variant?.title,
                quantity: item.quantity,
                sale_price: item.price_at_sale,
                cost_price: item.cost_at_sale || item.variant?.cost_price || 0, // Fallback
                stock_qty: item.variant?.stock_qty, // For reference
                track_inventory: item.variant?.track_inventory
            })));

        } catch (error) {
            console.error("Error fetching order:", error);
            toast.error("Failed to load order");
        } finally {
            setLoading(false);
        }
    }

    // --- Item Handlers ---

    const handleAddItem = () => {
        if (!activeProduct || !activeVariant) return;

        // check if already exists
        const existingIdx = editItems.findIndex(i => i.variantId === activeVariant.id);
        if (existingIdx >= 0) {
            const newItems = [...editItems];
            newItems[existingIdx].quantity += 1;
            setEditItems(newItems);
        } else {
            setEditItems([...editItems, {
                // No ID implies new item
                variantId: activeVariant.id,
                productName: activeProduct.name,
                variantTitle: activeVariant.title,
                quantity: 1,
                sale_price: activeVariant.sale_price,
                cost_price: activeVariant.cost_price,
                stock_qty: activeVariant.stock_qty,
                track_inventory: activeVariant.track_inventory
            }]);
        }
        setSelectedVariant("");
    };

    const handleRemoveItem = (index: number) => {
        const newItems = [...editItems];
        newItems.splice(index, 1);
        setEditItems(newItems);
    };

    const updateItem = (index: number, field: string, value: any) => {
        const newItems = [...editItems];
        newItems[index] = { ...newItems[index], [field]: value };
        setEditItems(newItems);
    };

    // --- Save Logic ---

    async function handleSave() {
        setSaving(true);
        try {
            // Validate Shipping Company if Status is 'Shipped'
            if (editForm.status === 'Shipped' && !editForm.shippingCompanyId) {
                toast.error("Please select a Shipping Company for shipped orders.");
                setSaving(false);
                return;
            }

            // 1. Calculations
            const newSubtotal = editItems.reduce((acc, i) => acc + (i.sale_price * i.quantity), 0);
            const newTotalCost = editItems.reduce((acc, i) => acc + (i.cost_price * i.quantity), 0);
            const newTotal = Math.max(0, newSubtotal + editForm.shippingCost - editForm.discount);

            // 2. Oversell guard only — the DATABASE now owns stock movement.
            //    Triggers on orders.status and order_items apply every deduction
            //    and restock (see the inventory ledger migration), so this block
            //    must not mutate stock. It only blocks selling more of a tracked
            //    variant than is on hand, at the moment goods leave the shelf.
            const originalItems = order.items;
            const wasOut = STOCK_OUT_STATUSES.includes((order.status || "").toLowerCase().trim());
            const willBeOut = STOCK_OUT_STATUSES.includes((editForm.status || "").toLowerCase().trim());

            if (willBeOut) {
                const variantIds = [...new Set(editItems.map(i => i.variantId))];
                const { data: freshVariants } = await supabase
                    .from('variants')
                    .select('id, stock_qty, track_inventory')
                    .eq('business_id', activeBusiness!.id)
                    .in('id', variantIds);

                // Units already out (only if the order was already in a deducted
                // state); the DB will move just the increase over these.
                const alreadyOut = new Map<string, number>();
                if (wasOut) {
                    (originalItems || []).forEach((i: any) =>
                        alreadyOut.set(i.variant_id, (alreadyOut.get(i.variant_id) || 0) + i.quantity));
                }
                const wantMap = new Map<string, number>();
                editItems.forEach((i: any) =>
                    wantMap.set(i.variantId, (wantMap.get(i.variantId) || 0) + i.quantity));

                for (const [vid, want] of Array.from(wantMap.entries())) {
                    const vInfo = freshVariants?.find(v => v.id === vid);
                    if (!vInfo?.track_inventory) continue;
                    const needed = want - (alreadyOut.get(vid) || 0);
                    if (needed > 0 && (vInfo.stock_qty || 0) < needed) {
                        throw new Error(`مخزون غير كافٍ. المتاح ${vInfo.stock_qty || 0}، والمطلوب خصمه ${needed}.`);
                    }
                }
            }

            // 5 & 6. Transactional Update via RPC
            const upsertItemsPayload = editItems.map(item => ({
                id: item.id || null, // null for new items
                variant_id: item.variantId,
                quantity: item.quantity,
                price_at_sale: item.sale_price,
                cost_at_sale: item.cost_price
            }));

            const keptIds = editItems.map(i => i.id).filter(Boolean);
            const deleteIds = originalItems
                .filter((i: any) => !keptIds.includes(i.id))
                .map((i: any) => i.id);


            // --- Actual Shipping Cost Calculation ---
            let actual_shipping_cost = 0;
            try {
                let companyToUse = null;
                if (editForm.shippingCompanyId) {
                    const { data } = await supabase.from('shipping_companies').select('rates').eq('id', editForm.shippingCompanyId).single();
                    companyToUse = data;
                } else {
                    const { data } = await supabase.from('shipping_companies').select('rates').eq('business_id', activeBusiness!.id).eq('is_default', true).single();
                    companyToUse = data;
                }

                if (companyToUse && companyToUse.rates && companyToUse.rates[editForm.customerGov]) {
                    actual_shipping_cost = Number(companyToUse.rates[editForm.customerGov]);
                } else {
                    const isCairoGiza = editForm.customerGov === 'Cairo' || editForm.customerGov === 'Giza' || editForm.customerGov === 'New Cairo' || editForm.customerGov === 'القاهرة' || editForm.customerGov === 'الجيزة';
                    actual_shipping_cost = isCairoGiza ? 65 : 75;
                }
            } catch(e) {
                const isCairoGiza = editForm.customerGov === 'Cairo' || editForm.customerGov === 'Giza' || editForm.customerGov === 'New Cairo' || editForm.customerGov === 'القاهرة' || editForm.customerGov === 'الجيزة';
                actual_shipping_cost = isCairoGiza ? 65 : 75;
            }

            const newProfit = newTotal - newTotalCost - actual_shipping_cost;
            // --- End Actual Shipping Cost Calculation ---

            const orderUpdatePayload = {
                created_at: new Date(editForm.createdAt).toISOString(),
                status: editForm.status,
                customer_info: {
                    name: editForm.customerName,
                    phone: editForm.customerPhone,
                    phone2: editForm.customerPhone2,
                    address: editForm.customerAddress,
                    governorate: editForm.customerGov
                },
                shipping_cost: editForm.shippingCost,
                discount: editForm.discount,
                total_amount: newTotal,
                subtotal: newSubtotal,
                total_cost: newTotalCost,
                channel: editForm.channel,
                shipping_company_id: editForm.shippingCompanyId || null,
                actual_shipping_cost: actual_shipping_cost,
                

                notes: editForm.notes,
                tags: editForm.tags.split(",").map(t => t.trim()).filter(Boolean),
                payment_status: editForm.paymentStatus,
                paid_amount: editForm.paymentStatus === "Not Paid" ? 0 : editForm.paymentStatus === "Paid" ? newTotal : editForm.paidAmount,
            };

            const { error: rpcError } = await supabase.rpc('update_order_and_items', {
                p_order_id: orderId,
                p_order_update: orderUpdatePayload,
                p_upsert_items: upsertItemsPayload,
                p_delete_item_ids: deleteIds
            });

            if (rpcError) throw rpcError;

            const auditChanges: ActionDiff[] = [];
            if (order?.status !== editForm.status) {
                auditChanges.push({ field: "Status", old_value: order?.status, new_value: editForm.status });
            }
            if (order?.total_amount !== newTotal) {
                auditChanges.push({ field: "Total Amount", old_value: `${order?.total_amount} EGP`, new_value: `${newTotal} EGP` });
            }
            if (order?.customer_info?.phone !== editForm.customerPhone) {
                auditChanges.push({ field: "Customer Phone", old_value: order?.customer_info?.phone, new_value: editForm.customerPhone });
            }
            if (order?.shipping_cost !== editForm.shippingCost) {
                auditChanges.push({ field: "Shipping Cost", old_value: `${order?.shipping_cost} EGP`, new_value: `${editForm.shippingCost} EGP` });
            }
            if (auditChanges.length === 0) {
                auditChanges.push({ field: "Order Details", old_value: "Previous Info", new_value: "Updated Order Info" });
            }

            logBusinessAction({
                businessId: activeBusiness!.id,
                userEmail: currentUser?.email || "Staff",
                actionType: order?.status !== editForm.status ? "update_status" : "edit",
                entityType: "order",
                entityId: orderId,
                entityName: `Order #${orderId.substring(0, 8)} (${editForm.customerName})`,
                changes: auditChanges
            });


            // 7. Status-driven stock (including Returned → restock) is applied
            //    by the database trigger on orders.status inside the RPC above,
            //    so no stock handling is needed here.

            const paymentStatusChanged = editForm.paymentStatus !== order.payment_status;
            const paidAmountChanged = editForm.paidAmount !== order.paid_amount;
            const isPaidNow = editForm.paymentStatus === "Paid" || editForm.paymentStatus === "Partially Paid";

            if (isPaidNow && (paymentStatusChanged || paidAmountChanged)) {
                const pAmount = editForm.paymentStatus === "Paid" ? newTotal : editForm.paidAmount;
                setCompletedOrder({
                    id: orderId,
                    amount: pAmount,
                    cName: editForm.customerName,
                    cPhone: editForm.customerPhone
                });
                setShowTransactionDialog(true);
            }

            if (activeBusiness && order.status !== editForm.status) {
                syncStatusToEasyOrders(orderId, editForm.status, activeBusiness.id).catch(err => {
                    console.error("Failed to sync status to EasyOrders:", err);
                });
                
                // VROBO Integration for manual status change
                if (editForm.status === "Returning" || editForm.status === "Hold To redeliver") {
                    console.log(`[VROBO] Initiating sync for order ${orderId}...`);
                    processOrderForVrobo(orderId).then(res => {
                        console.log(`[VROBO] Result for ${orderId}:`, res);
                    }).catch(err => {
                        console.error("[VROBO] Failed to process VROBO sync for manual update:", err);
                    });
                }
            }

            toast.success("Order updated successfully");
            setIsEditing(false);
            fetchOrderDetails();
        } catch (error: any) {
            console.error("Error updating order:", error);
            toast.error(error.message || "Failed to update order");
        } finally {
            setSaving(false);
        }
    }

    const calculateCurrentTotal = () => {
        const sub = editItems.reduce((acc, i) => acc + (i.sale_price * i.quantity), 0);
        return Math.max(0, sub + editForm.shippingCost - editForm.discount);
    };

    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    if (!order) {
        return <div>Order not found</div>;
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="sm" onClick={() => router.back()}>
                        <ArrowLeft className="h-4 w-4 mr-2" /> Back
                    </Button>
                    <h1 className="text-2xl font-bold">Order #{order.id.slice(0, 8)}</h1>
                    <Badge variant={order.status === 'Delivered' ? 'default' : 'secondary'}>
                        {order.status}
                    </Badge>
                </div>
                <div className="flex items-center gap-2">
                    {isEditing ? (
                        <>
                            <Button variant="outline" onClick={() => { setIsEditing(false); fetchOrderDetails(); }} disabled={saving}>Cancel</Button>
                            <Button onClick={handleSave} disabled={saving}>
                                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Changes
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={() => window.open(`/orders/${order.id}/invoice`, '_blank')}>
                                <Printer className="mr-2 h-4 w-4" /> Print
                            </Button>
                            <Button onClick={() => setIsEditing(true)}>
                                <Edit className="mr-2 h-4 w-4" /> Edit Order
                            </Button>
                        </>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* 1. Customer Info */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Customer Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            {isEditing ? (
                                <Input value={editForm.customerName} onChange={e => setEditForm({ ...editForm, customerName: e.target.value })} />
                            ) : (
                                <div className="font-medium">{order.customer_info?.name}</div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>Phone</Label>
                            {isEditing ? (
                                <Input value={editForm.customerPhone} onChange={e => setEditForm({ ...editForm, customerPhone: e.target.value })} />
                            ) : (
                                <div className="font-medium">{order.customer_info?.phone}</div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>Phone 2</Label>
                            {isEditing ? (
                                <Input value={editForm.customerPhone2} onChange={e => setEditForm({ ...editForm, customerPhone2: e.target.value })} />
                            ) : (
                                <div className="font-medium">{order.customer_info?.phone2 || "-"}</div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>Governorate</Label>
                            {isEditing ? (
                                <Select value={editForm.customerGov} onValueChange={v => setEditForm({ ...editForm, customerGov: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>{GOVERNORATES.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                                </Select>
                            ) : (
                                <div className="font-medium">{order.customer_info?.governorate}</div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>Address</Label>
                            {isEditing ? (
                                <Input value={editForm.customerAddress} onChange={e => setEditForm({ ...editForm, customerAddress: e.target.value })} />
                            ) : (
                                <div className="text-sm text-muted-foreground">{order.customer_info?.address}</div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* 2. Order Settings */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Order Settings</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Status</Label>
                            {isEditing ? (
                                <Select value={editForm.status} onValueChange={v => setEditForm({ ...editForm, status: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div><Badge variant="outline">{order.status}</Badge></div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>Channel</Label>
                            {isEditing ? (
                                <Input value={editForm.channel} onChange={e => setEditForm({ ...editForm, channel: e.target.value })} />
                            ) : (
                                <div>{order.channel}</div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>Shipping Company</Label>
                            {isEditing ? (
                                <Select
                                    value={editForm.shippingCompanyId}
                                    onValueChange={v => setEditForm({ ...editForm, shippingCompanyId: v })}
                                >
                                    <SelectTrigger><SelectValue placeholder="Select Courier" /></SelectTrigger>
                                    <SelectContent>
                                        {shippingCompanies.map(c => (
                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div>
                                    {order.shipping_company_id
                                        ? shippingCompanies.find(c => c.id === order.shipping_company_id)?.name
                                        : <span className="text-muted-foreground">-</span>
                                    }
                                </div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>Date Created</Label>
                            {isEditing ? (
                                <Input
                                    type="datetime-local"
                                    value={editForm.createdAt}
                                    onChange={e => setEditForm({ ...editForm, createdAt: e.target.value })}
                                />
                            ) : (
                                <div className="text-sm text-muted-foreground">
                                    {format(new Date(order.created_at), "PPP p")}
                                </div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>Notes</Label>
                            {isEditing ? (
                                <Textarea
                                    value={editForm.notes}
                                    onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                                    placeholder="Add notes..."
                                />
                            ) : (
                                <div className="text-sm whitespace-pre-wrap">{order.notes || "No notes"}</div>
                            )}

                        </div>
                        <div className="space-y-2">
                            <Label>Payment Status</Label>
                            {isEditing ? (
                                <Select value={editForm.paymentStatus} onValueChange={v => setEditForm({ ...editForm, paymentStatus: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Not Paid">Not Paid</SelectItem>
                                        <SelectItem value="Partially Paid">Partially Paid</SelectItem>
                                        <SelectItem value="Paid">Paid</SelectItem>
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div className="space-x-2">
                                    <Badge variant={order.payment_status === 'Paid' ? 'secondary' : 'outline'}>{order.payment_status || 'Not Paid'}</Badge>
                                    {order.payment_status === 'Partially Paid' && (
                                        <span className="text-sm text-muted-foreground">{formatCurrency(order.paid_amount)} paid</span>
                                    )}
                                </div>
                            )}
                        </div>

                        {editForm.paymentStatus === "Partially Paid" && isEditing && (
                            <div className="space-y-2">
                                <Label>Paid Amount (EGP)</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={editForm.paidAmount}
                                    onChange={(e) => setEditForm({ ...editForm, paidAmount: parseFloat(e.target.value) || 0 })}
                                />
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* 3. Items & Financials */}
                <Card className="md:col-span-3">
                    <CardHeader>
                        <CardTitle>Order Items</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">

                        {/* Edit Mode: Product Selector */}
                        {isEditing && (
                            <div className="p-4 bg-muted/20 rounded-lg space-y-4 border mb-4">
                                <Label>Add Item to Order</Label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="flex flex-col space-y-2">
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    role="combobox"
                                                    className={cn(
                                                        "w-full justify-between",
                                                        !selectedProduct ? "text-muted-foreground" : ""
                                                    )}
                                                >
                                                    {selectedProduct
                                                        ? products.find((p) => p.id === selectedProduct)?.name
                                                        : "Select product..."}
                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-[300px] p-0">
                                                <Command>
                                                    <CommandInput placeholder="Search product..." />
                                                    <CommandList>
                                                        <CommandEmpty>No product found.</CommandEmpty>
                                                        <CommandGroup>
                                                            {products.map((product) => (
                                                                <CommandItem
                                                                    key={product.id}
                                                                    value={product.name}
                                                                    onSelect={() => setSelectedProduct(product.id === selectedProduct ? "" : product.id)}
                                                                >
                                                                    <Check className={cn("mr-2 h-4 w-4", selectedProduct === product.id ? "opacity-100" : "opacity-0")} />
                                                                    {product.name}
                                                                </CommandItem>
                                                            ))}
                                                        </CommandGroup>
                                                    </CommandList>
                                                </Command>
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Select value={selectedVariant} onValueChange={setSelectedVariant} disabled={!selectedProduct}>
                                            <SelectTrigger><SelectValue placeholder="Select Variant" /></SelectTrigger>
                                            <SelectContent>
                                                {activeProduct?.variants.map((v: any) => (
                                                    <SelectItem key={v.id} value={v.id}>
                                                        {v.title} - {formatCurrency(v.sale_price)} ({v.stock_qty})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button onClick={handleAddItem} disabled={!selectedVariant} size="icon">
                                            <PlusCircle className="h-5 w-5" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Product</TableHead>
                                    <TableHead className="text-right">Price</TableHead>
                                    <TableHead className="text-right">Qty</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    {isEditing && <TableHead className="w-[50px]"></TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {(isEditing ? editItems : order.items).map((item: any, idx: number) => (
                                    <TableRow key={idx}>
                                        <TableCell>
                                            <div className="font-medium">{item.productName || item.variant?.product?.name}</div>
                                            <div className="text-xs text-muted-foreground">{item.variantTitle || item.variant?.title}</div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {isEditing ? (
                                                <Input
                                                    type="number"
                                                    className="w-24 text-right ml-auto"
                                                    value={item.sale_price}
                                                    onChange={e => updateItem(idx, 'sale_price', parseFloat(e.target.value) || 0)}
                                                />
                                            ) : formatCurrency(item.sale_price || item.price_at_sale)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {isEditing ? (
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    className="w-20 text-right ml-auto"
                                                    value={item.quantity}
                                                    onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                                                />
                                            ) : item.quantity}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatCurrency((item.sale_price || item.price_at_sale) * item.quantity)}
                                        </TableCell>
                                        {isEditing && (
                                            <TableCell>
                                                <Button variant="ghost" size="sm" onClick={() => handleRemoveItem(idx)}>
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>

                    <CardFooter className="flex flex-col items-end space-y-2 border-t pt-4">
                        {isEditing ? (
                            <div className="w-full max-w-xs space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-muted-foreground">Subtotal</span>
                                    <span>{formatCurrency(editItems.reduce((acc, i) => acc + (i.sale_price * i.quantity), 0))}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-muted-foreground">Shipping</span>
                                    <Input
                                        type="number" className="w-24 h-8 text-right"
                                        value={editForm.shippingCost}
                                        onChange={e => setEditForm({ ...editForm, shippingCost: parseFloat(e.target.value) || 0 })}
                                    />
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-muted-foreground">Discount</span>
                                    <Input
                                        type="number" className="w-24 h-8 text-right"
                                        value={editForm.discount}
                                        onChange={e => setEditForm({ ...editForm, discount: parseFloat(e.target.value) || 0 })}
                                    />
                                </div>
                                <div className="flex justify-between items-center pt-2 border-t font-bold text-lg">
                                    <span>Total</span>
                                    <span>{formatCurrency(calculateCurrentTotal())}</span>
                                </div>
                            </div>
                        ) : (
                            <div className="w-full max-w-xs space-y-2 text-right">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Subtotal</span>
                                    <span>{formatCurrency(order.subtotal)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Shipping</span>
                                    <span>{formatCurrency(order.shipping_cost)}</span>
                                </div>
                                <div className="flex justify-between text-green-600">
                                    <span>Discount</span>
                                    <span>- {formatCurrency(order.discount)}</span>
                                </div>
                                <div className="flex justify-between font-bold text-lg border-t pt-2">
                                    <span>Total</span>
                                    <span>{formatCurrency(order.total_amount)}</span>
                                </div>
                            </div>
                        )}
                    </CardFooter>
                </Card>
            </div>

            {/* Transaction Dialog */}
            <Dialog open={showTransactionDialog} onOpenChange={setShowTransactionDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Payment to Revenue?</DialogTitle>
                        <DialogDescription>
                            This order has a paid amount of {formatCurrency(completedOrder?.amount || 0)}.
                            Would you like to automatically record this as a Revenue (Deposit) transaction?
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>اختر الخزينة / الحساب (Treasury Account)</Label>
                            <Select value={transactionAccount} onValueChange={setTransactionAccount}>
                                <SelectTrigger><SelectValue placeholder="اختر الخزينة" /></SelectTrigger>
                                <SelectContent>
                                    {accounts.map((acc) => (
                                        <SelectItem key={acc.id} value={acc.name}>
                                            {acc.name}
                                        </SelectItem>
                                    ))}
                                    <SelectItem value="Split">Split (تقسيم مناصفة 50/50)</SelectItem>
                                </SelectContent>
                            </Select>

                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowTransactionDialog(false)}>Skip</Button>
                        <Button disabled={!transactionAccount || transactionLoading} onClick={async () => {
                            setTransactionLoading(true);
                            try {
                                const payload = {
                                    business_id: activeBusiness!.id,
                                    transaction_date: new Date().toISOString(),
                                    type: "revenue",
                                    category: "Deposits",
                                    description: `Order #${completedOrder?.id} - ${completedOrder?.cName} - ${completedOrder?.cPhone}`,
                                };

                                if (transactionAccount === "Split") {
                                    const half = (completedOrder?.amount || 0) / 2;
                                    await supabase.from("transactions").insert([
                                        { ...payload, amount: half, account_name: "Mohamed Adel" },
                                        { ...payload, amount: half, account_name: "Abdallah Sherif" },
                                    ]);
                                } else {
                                    await supabase.from("transactions").insert({
                                        ...payload,
                                        amount: completedOrder?.amount || 0,
                                        account_name: transactionAccount
                                    });
                                }
                                toast.success("Transaction added successfully!");
                                setShowTransactionDialog(false);
                            } catch (e) {
                                console.error(e);
                                toast.error("Failed to add transaction");
                            } finally {
                                setTransactionLoading(false);
                            }
                        }}>
                            {transactionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Add Transaction
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div >
    );
}
