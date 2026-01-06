"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { restockItems, deductStock, validateStock } from "@/lib/inventory";
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
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const ORDER_STATUSES = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled", "Returned"];
const GOVERNORATES = [
    "Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
];

const CHANNELS = ["Facebook", "Instagram", "Tiktok", "Website"];

export default function OrderDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const orderId = params.id as string;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [order, setOrder] = useState<any>(null);

    // Product Data for Selector
    const [products, setProducts] = useState<any[]>([]);
    const [selectedProduct, setSelectedProduct] = useState("");
    const [selectedVariant, setSelectedVariant] = useState("");

    // Edit State
    const [editForm, setEditForm] = useState({
        customerName: "",
        customerPhone: "",
        customerAddress: "",
        customerGov: "",
        status: "",
        shippingCost: 0,
        discount: 0,
        channel: "",
        tags: "",
        notes: "",
        createdAt: ""
    });

    // Items Editing State
    // We map existing items to this structure and allow adding new ones.
    const [editItems, setEditItems] = useState<any[]>([]);

    useEffect(() => {
        fetchOrderDetails();
        fetchProducts();
    }, [orderId]);

    // Helpers for Product Selection
    const activeProduct = products.find((p) => p.id === selectedProduct);
    const activeVariant = activeProduct?.variants.find((v: any) => v.id === selectedVariant);

    async function fetchProducts() {
        const { data } = await supabase.from("products").select("*, variants(*)").order("name");
        setProducts(data || []);
    }

    async function fetchOrderDetails() {
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
                .eq("id", orderId)
                .single();

            if (error) throw error;
            setOrder(data);

            // Initialize Edit Form
            setEditForm({
                customerName: data.customer_info?.name || "",
                customerPhone: data.customer_info?.phone || "",
                customerAddress: data.customer_info?.address || "",
                customerGov: data.customer_info?.governorate || "",
                status: data.status,
                shippingCost: data.shipping_cost || 0,
                discount: data.discount || 0,
                channel: data.channel || "",
                tags: (data.tags || []).join(", "),
                notes: data.notes || "",
                createdAt: data.created_at ? new Date(data.created_at).toISOString().slice(0, 16) : ""
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
            // 1. Calculations
            const newSubtotal = editItems.reduce((acc, i) => acc + (i.sale_price * i.quantity), 0);
            const newTotalCost = editItems.reduce((acc, i) => acc + (i.cost_price * i.quantity), 0);
            const newTotal = Math.max(0, newSubtotal + editForm.shippingCost - editForm.discount);

            // 2. Validate Stock (Changes Only)
            // We need to fetch FRESH stock data because 'editItems.stock_qty' might be stale.
            const variantIds = [...new Set(editItems.map(i => i.variantId))];
            const { data: freshVariants } = await supabase
                .from('variants')
                .select('id, stock_qty, track_inventory')
                .in('id', variantIds);

            // 3. Inventory Diffing
            // Compare Original Order Items vs Edit Items
            // originalItemsMap: Map<variantId, quantity>
            const originalItems = order.items;
            const originalMap = new Map();
            originalItems.forEach((i: any) => {
                originalMap.set(i.variant_id, (originalMap.get(i.variant_id) || 0) + i.quantity);
            });

            const newMap = new Map();
            editItems.forEach((i: any) => {
                newMap.set(i.variantId, (newMap.get(i.variantId) || 0) + i.quantity);
            });

            const allInvolvedVariants = new Set([...originalMap.keys(), ...newMap.keys()]);

            // Prepare Stock Adjustments
            const deductionQueue: { variant_id: string, qty: number }[] = [];
            const restockQueue: { variant_id: string, qty: number }[] = [];

            for (const vid of Array.from(allInvolvedVariants)) {
                const oldQty = originalMap.get(vid) || 0;
                const newQty = newMap.get(vid) || 0;
                const diff = newQty - oldQty;

                if (diff > 0) {
                    // Need more items -> Deduct
                    // Check stock first
                    const vInfo = freshVariants?.find(v => v.id === vid);
                    if (vInfo?.track_inventory) {
                        if (vInfo.stock_qty < diff) {
                            throw new Error(`Insufficient stock for variant ${vid}. Need ${diff} more, have ${vInfo.stock_qty}.`);
                        }
                    }
                    deductionQueue.push({ variant_id: vid as string, qty: diff });
                } else if (diff < 0) {
                    // Less items -> Return to stock
                    restockQueue.push({ variant_id: vid as string, qty: Math.abs(diff) });
                }
            }

            // 4. Apply Stock Changes
            if (deductionQueue.length > 0) {
                await deductStock(deductionQueue, orderId, "Order Edit: Added Items/Qty");
            }
            if (restockQueue.length > 0) {
                await restockItems(restockQueue, orderId, "Order Edit: Removed Items/Qty");
            }

            // 5. Update Order Record
            const { error: orderError } = await supabase
                .from("orders")
                .update({
                    created_at: new Date(editForm.createdAt).toISOString(),
                    customer_info: {
                        name: editForm.customerName,
                        phone: editForm.customerPhone,
                        address: editForm.customerAddress,
                        governorate: editForm.customerGov
                    },
                    status: editForm.status,
                    shipping_cost: editForm.shippingCost,
                    discount: editForm.discount,
                    total_amount: newTotal,
                    subtotal: newSubtotal,
                    total_cost: newTotalCost,
                    channel: editForm.channel,
                    notes: editForm.notes,
                    tags: editForm.tags.split(",").map(t => t.trim()).filter(Boolean)
                })
                .eq("id", orderId);

            if (orderError) throw orderError;

            // 6. Sync Order Items (Upsert/Delete)
            // Existing items have IDs. New items don't.
            // Items to Keep/Update/Add
            const itemsToUpsert = editItems.map(item => ({
                id: item.id || undefined, // If undefined, Supabase creates new ID
                order_id: orderId,
                variant_id: item.variantId,
                quantity: item.quantity,
                price_at_sale: item.sale_price,
                cost_at_sale: item.cost_price
            }));

            const { data: upsertedData, error: upsertError } = await supabase
                .from("order_items")
                .upsert(itemsToUpsert)
                .select("id");

            if (upsertError) throw upsertError;

            // Delete removed items
            // Any item ID that was in original but NOT in upsertedData should be deleted?
            // Wait, upsert response only returns IDs we sent or created.
            // Safer way: Get IDs of items currently in `editItems` that HAVE `id`.
            // Any ID in `order.items` that is NOT in `editItems` IDs list should be removed.

            const keptIds = editItems.map(i => i.id).filter(Boolean);
            const itemsToDelete = originalItems
                .filter((i: any) => !keptIds.includes(i.id))
                .map((i: any) => i.id);

            if (itemsToDelete.length > 0) {
                await supabase.from("order_items").delete().in("id", itemsToDelete);
            }

            // 7. Handle Status Change Inventory Logic (Standard Return Logic)
            // *NOTE*: The above diff logic handles line-item changes.
            // If the STATUS itself changes (e.g. to Returned), we might double-count if we aren't careful.
            // The Logic in previous version was:
            // "If status changes TO Returned -> Restock everything".
            // "If status changes FROM Returned -> Deduct everything".

            // To be safe: Only run status-based FULL restock/deduct if we assume the line-item diffs handled the quantity changes *within* the current status context.
            // Actually, blending "Edit Items" and "Change Status" in one go is very risky.
            // If user changes Qty AND changes Status to Returned:
            // 1. Diff logic applies Qty change.
            // 2. Status logic applies Full Restock of NEW quantities?

            // Let's simplify:
            // If status is changing to/from 'Returned', we should probably rely on the *final* list of items for that bulk operation.
            // But we already ran diffs.

            const oldStatus = order.status;
            const newStatus = editForm.status;

            if (oldStatus !== newStatus) {
                // If moving TO Returned: Restock ALL items (based on the NEW list).
                // BUT we just did diffs.
                // Example: Old: 5. New: 3. Diff: Restock 2.
                // Status Change: Pending -> Returned.
                // We restocked 2. Now we currently have 3 "sold". We need to restock those 3 too.
                // So yes, we should restock the *new* quantities.

                if (newStatus === 'Returned' && oldStatus !== 'Returned') {
                    const finalItems = editItems.map(i => ({ variant_id: i.variantId, qty: i.quantity }));
                    await restockItems(finalItems, orderId, "Status Change: Returned");
                    toast.success("Order marked Returned - Stock restored");
                }
                // If moving FROM Returned: Deduct ALL items (based on NEW list)
                else if (oldStatus === 'Returned' && newStatus !== 'Returned') {
                    // Example: Old: 5 (Returned). New: 3 (Pending).
                    // Diff: "Removed 2". Restock 2? Wait, if it was returned, we theoretically "have" them.
                    // This gets complex.
                    // Simplified approach for User:
                    // If changing status to/from Returned, recommend doing it separately from editing quantities?
                    // OR: just handle it blindly.

                    // If it WAS Returned, the "Diff" logic assumes they were "sold" (deducted).
                    // But in "Returned" state, they are effectively "in stock".
                    // This edge case is tricky.

                    // Allow me to handle basic status changes.
                    // If moving FROM Returned, we need to DEDUCT the items represented by the new list.
                    const finalItems = editItems.map(i => ({ variant_id: i.variantId, qty: i.quantity }));
                    await deductStock(finalItems, orderId, "Status Change: Un-returned");
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
        </div>
    );
}
