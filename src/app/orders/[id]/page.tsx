"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { restockItems, deductStock } from "@/lib/inventory";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, Printer, Save, Edit } from "lucide-react";
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

export default function OrderDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const orderId = params.id as string;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [order, setOrder] = useState<any>(null);

    // Edit State
    const [editForm, setEditForm] = useState({
        customerName: "",
        customerPhone: "",
        customerAddress: "",
        customerGov: "",
        status: "",
        shippingCost: 0,
        discount: 0,
        subtotal: 0, // Not directly editable, derived from items
        channel: "",
        tags: ""
    });

    useEffect(() => {
        fetchOrderDetails();
    }, [orderId]);

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
                subtotal: data.subtotal || 0,
                channel: data.channel || "",
                tags: (data.tags || []).join(", ")
            });

        } catch (error) {
            console.error("Error fetching order:", error);
            toast.error("Failed to load order");
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        try {
            const total = Math.max(0, editForm.subtotal + editForm.shippingCost - editForm.discount);

            // 1. Update Order
            const { error: orderError } = await supabase
                .from("orders")
                .update({
                    customer_info: {
                        name: editForm.customerName,
                        phone: editForm.customerPhone,
                        address: editForm.customerAddress,
                        governorate: editForm.customerGov
                    },
                    status: editForm.status,
                    shipping_cost: editForm.shippingCost,
                    discount: editForm.discount,
                    total_amount: total,
                    channel: editForm.channel,
                    tags: editForm.tags.split(",").map(t => t.trim()).filter(Boolean)
                })
                .eq("id", orderId);

            if (orderError) throw orderError;

            // --- Inventory Logic ---
            const oldStatus = order.status;
            const newStatus = editForm.status;

            if (oldStatus !== newStatus) {
                const itemsToUpdate = order.items.map((i: any) => ({
                    variant_id: i.variant_id,
                    qty: i.quantity
                }));

                // 1. If Changed TO Returned -> Restock
                if (newStatus === 'Returned' && oldStatus !== 'Returned') {
                    await restockItems(itemsToUpdate, orderId, "Order Returned: " + orderId);
                    toast.success("Items returned to stock");
                }
                // 2. If Changed FROM Returned -> Deduct (Un-return)
                else if (oldStatus === 'Returned' && newStatus !== 'Returned') {
                    await deductStock(itemsToUpdate, orderId, "Status Change (Un-returned)", "adjustment");
                    toast.info("Items deducted from stock");
                }
            }
            // -----------------------

            // 2. Update Customer Record (Optional but good for consistency)
            if (order.customer_id) {
                await supabase.from("customers").update({
                    name: editForm.customerName,
                    phone: editForm.customerPhone,
                    address: editForm.customerAddress,
                    governorate: editForm.customerGov
                }).eq("id", order.customer_id);
            }

            toast.success("Order updated successfully");
            setIsEditing(false);
            fetchOrderDetails();
        } catch (error: any) {
            console.error("Error updating order:", error);
            toast.error("Failed to update order");
        } finally {
            setSaving(false);
        }
    }

    const calculateTotal = () => {
        // Dynamic calc during editing
        return Math.max(0, editForm.subtotal + editForm.shippingCost - editForm.discount);
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
                            <Button variant="outline" onClick={() => setIsEditing(false)} disabled={saving}>Cancel</Button>
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
                            <div className="text-sm text-muted-foreground">
                                {format(new Date(order.created_at), "PPP p")}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* 3. Items & Financials (Full Width on mobile, 2 cols on desktop) */}
                <Card className="md:col-span-3">
                    <CardHeader>
                        <CardTitle>Order Items</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Product</TableHead>
                                    <TableHead className="text-right">Price</TableHead>
                                    <TableHead className="text-right">Qty</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {order.items?.map((item: any, idx: number) => (
                                    <TableRow key={idx}>
                                        <TableCell>
                                            <div className="font-medium">{item.variant?.product?.name || "Unknown Product"}</div>
                                            <div className="text-xs text-muted-foreground">{item.variant?.title}</div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatCurrency(item.price_at_sale)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {item.quantity}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatCurrency(item.price_at_sale * item.quantity)}
                                        </TableCell>
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
                                    <span>{formatCurrency(editForm.subtotal)}</span>
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
                                    <span>{formatCurrency(calculateTotal())}</span>
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
