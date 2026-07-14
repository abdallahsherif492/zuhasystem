"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Check, X, AlertTriangle, Search, PackageSearch } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    total_amount: number;
    shipping_cost: number;
    easyorders_id: string;
    payment_status: string;
    created_at: string;
    order_items: OrderItem[];
}

interface Variant {
    id: string;
    title: string;
    sku: string;
    sale_price: number;
    products: { name: string };
}

export default function EasyOrdersPage() {
    const { activeBusiness } = useBusiness();
    const { t } = useLanguage();
    
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [variants, setVariants] = useState<Variant[]>([]);

    useEffect(() => {
        if (activeBusiness) {
            fetchOrders();
            fetchVariants();
        }
    }, [activeBusiness]);

    const fetchVariants = async () => {
        if (!activeBusiness) return;
        const { data } = await supabase
            .from('variants')
            .select('id, title, sku, sale_price, products!inner(name)')
            .eq('products.business_id', activeBusiness.id);
        if (data) setVariants(data as any[]);
    };

    const fetchOrders = async () => {
        setLoading(true);
        if (!activeBusiness) return;
        const { data, error } = await supabase
            .from('orders')
            .select(`
                *,
                order_items (
                    id, variant_id, quantity, price_at_sale, unmapped_name, unmapped_sku,
                    variants (
                        title, sku, product_id,
                        products (name)
                    )
                )
            `)
            .eq('business_id', activeBusiness.id)
            .eq('status', 'Waiting')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Error fetching easy orders:", error);
            toast.error(t("Failed to load Easy Orders"));
        } else {
            setOrders(data || []);
        }
        setLoading(false);
    };

    const handleUpdateOrder = async (orderId: string, updates: any) => {
        const { error } = await supabase.from('orders').update(updates).eq('id', orderId);
        if (error) throw error;
    };

    const handleUpdateItem = async (itemId: string, updates: any) => {
        const { error } = await supabase.from('order_items').update(updates).eq('id', itemId);
        if (error) throw error;
    };

    const handleMoveToPending = async (order: Order) => {
        // Validate unmapped items
        const hasUnmapped = order.order_items.some(item => !item.variant_id);
        if (hasUnmapped) {
            toast.error(t("Please map all products before moving to pending"));
            return;
        }

        setSaving(order.id);
        try {
            await handleUpdateOrder(order.id, { status: 'Pending' });
            toast.success(t("Order moved to Pending successfully"));
            setOrders(orders.filter(o => o.id !== order.id));
        } catch (error) {
            console.error("Error moving to pending:", error);
            toast.error(t("Failed to move order"));
        } finally {
            setSaving(null);
        }
    };

    const handleCancelOrder = async (orderId: string) => {
        setSaving(orderId);
        try {
            await handleUpdateOrder(orderId, { status: 'Cancelled' });
            toast.success(t("Order cancelled"));
            setOrders(orders.filter(o => o.id !== orderId));
        } catch (error) {
            console.error("Error cancelling order:", error);
            toast.error(t("Failed to cancel order"));
        } finally {
            setSaving(null);
        }
    };

    const updateCustomerInfo = async (order: Order, field: string, value: string) => {
        const newInfo = { ...order.customer_info, [field]: value };
        setOrders(orders.map(o => o.id === order.id ? { ...o, customer_info: newInfo } : o));
        try {
            await handleUpdateOrder(order.id, { customer_info: newInfo });
        } catch(e) {
            toast.error(t("Failed to save"));
        }
    };
    
    const updateOrderField = async (order: Order, field: string, value: any) => {
        setOrders(orders.map(o => o.id === order.id ? { ...o, [field]: value } : o));
        try {
            await handleUpdateOrder(order.id, { [field]: value });
        } catch(e) {
            toast.error(t("Failed to save"));
        }
    };

    const updateItemField = async (orderId: string, itemId: string, field: string, value: any) => {
        const orderIndex = orders.findIndex(o => o.id === orderId);
        if (orderIndex === -1) return;
        const newOrders = [...orders];
        const itemIndex = newOrders[orderIndex].order_items.findIndex(i => i.id === itemId);
        if (itemIndex === -1) return;
        
        newOrders[orderIndex].order_items[itemIndex] = { ...newOrders[orderIndex].order_items[itemIndex], [field]: value };
        
        // Recalculate totals
        let newSubtotal = 0;
        newOrders[orderIndex].order_items.forEach(item => {
            newSubtotal += (item.price_at_sale * item.quantity);
        });
        const newTotal = newSubtotal + newOrders[orderIndex].shipping_cost;
        newOrders[orderIndex].total_amount = newTotal;
        
        setOrders(newOrders);
        
        try {
            await handleUpdateItem(itemId, { [field]: value });
            await handleUpdateOrder(orderId, { subtotal: newSubtotal, total_amount: newTotal });
        } catch(e) {
            toast.error(t("Failed to save item"));
        }
    };

    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">{t("EasyOrders")}</h2>
                    <p className="text-muted-foreground">{t("Manage incoming orders from EasyOrders that are waiting for review.")}</p>
                </div>
            </div>

            {orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-20 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
                    <PackageSearch className="h-12 w-12 mb-4 opacity-20" />
                    <p className="text-lg font-medium">{t("No waiting orders from EasyOrders")}</p>
                    <p className="text-sm">{t("Orders will appear here automatically when they are placed on your EasyOrders store.")}</p>
                </div>
            ) : (
                <div className="grid gap-6">
                    {orders.map(order => (
                        <Card key={order.id} className="border-2 border-primary/20 shadow-md">
                            <CardHeader className="bg-muted/30 pb-4 border-b">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <CardTitle className="flex items-center gap-2">
                                            {order.customer_info?.name || "Unknown"} 
                                            <span className="text-sm font-normal text-muted-foreground">({order.easyorders_id})</span>
                                        </CardTitle>
                                        <p className="text-sm text-muted-foreground mt-1">
                                            {format(new Date(order.created_at), "PPP p")}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xl font-bold text-primary">{formatCurrency(order.total_amount)}</p>
                                        <Badge variant="outline" className="mt-1 bg-yellow-50 text-yellow-700 border-yellow-200">
                                            Waiting Review
                                        </Badge>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <div className="grid md:grid-cols-2 gap-8">
                                    {/* Customer Details */}
                                    <div className="space-y-4">
                                        <h3 className="font-semibold text-lg flex items-center border-b pb-2">{t("Customer Details")}</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>{t("Name")}</Label>
                                                <Input 
                                                    value={order.customer_info?.name || ""} 
                                                    onChange={e => updateCustomerInfo(order, 'name', e.target.value)} 
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>{t("Governorate")}</Label>
                                                <Input 
                                                    value={order.customer_info?.governorate || ""} 
                                                    onChange={e => updateCustomerInfo(order, 'governorate', e.target.value)}
                                                    className={!order.customer_info?.governorate ? "border-destructive" : ""}
                                                />
                                                {!order.customer_info?.governorate && <p className="text-xs text-destructive">Required</p>}
                                            </div>
                                            <div className="space-y-2">
                                                <Label>{t("Phone 1")}</Label>
                                                <Input 
                                                    value={order.customer_info?.phone || ""} 
                                                    onChange={e => updateCustomerInfo(order, 'phone', e.target.value)} 
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>{t("Phone 2")}</Label>
                                                <Input 
                                                    value={order.customer_info?.phone2 || ""} 
                                                    onChange={e => updateCustomerInfo(order, 'phone2', e.target.value)} 
                                                />
                                            </div>
                                            <div className="col-span-2 space-y-2">
                                                <Label>{t("Address")}</Label>
                                                <Input 
                                                    value={order.customer_info?.address || ""} 
                                                    onChange={e => updateCustomerInfo(order, 'address', e.target.value)} 
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Order Items */}
                                    <div className="space-y-4">
                                        <h3 className="font-semibold text-lg flex justify-between items-center border-b pb-2">
                                            <span>{t("Products")}</span>
                                            <span className="text-sm font-normal text-muted-foreground">Shipping: {formatCurrency(order.shipping_cost)}</span>
                                        </h3>
                                        <div className="space-y-3">
                                            {order.order_items.map(item => (
                                                <div key={item.id} className={`p-3 rounded-md border ${!item.variant_id ? 'border-destructive bg-destructive/5' : 'bg-muted/20'}`}>
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div className="flex-1">
                                                            {!item.variant_id ? (
                                                                <div className="text-destructive flex items-center text-sm font-medium mb-2">
                                                                    <AlertTriangle className="h-4 w-4 mr-1" />
                                                                    Unmapped: {item.unmapped_name} (SKU: {item.unmapped_sku || "N/A"})
                                                                </div>
                                                            ) : (
                                                                <div className="font-medium text-sm">
                                                                    {item.variants?.products?.name} - {item.variants?.title}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-[1fr,80px,100px] gap-2 items-center">
                                                        <div>
                                                            {!item.variant_id && (
                                                                <Select 
                                                                    onValueChange={(val) => {
                                                                        const v = variants.find(vr => vr.id === val);
                                                                        if (v) {
                                                                            const newOrders = [...orders];
                                                                            const oIndex = newOrders.findIndex(o => o.id === order.id);
                                                                            const iIndex = newOrders[oIndex].order_items.findIndex(i => i.id === item.id);
                                                                            newOrders[oIndex].order_items[iIndex] = {
                                                                                ...item,
                                                                                variant_id: val,
                                                                                variants: v as any
                                                                            };
                                                                            setOrders(newOrders);
                                                                            handleUpdateItem(item.id, { variant_id: val });
                                                                        }
                                                                    }}
                                                                >
                                                                    <SelectTrigger className="h-8 text-xs border-destructive">
                                                                        <SelectValue placeholder="Select Match" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {variants.map(v => (
                                                                            <SelectItem key={v.id} value={v.id}>
                                                                                {v.products?.name} - {v.title} ({v.sku})
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <Input 
                                                                type="number" 
                                                                className="h-8 text-xs" 
                                                                value={item.quantity} 
                                                                onChange={e => updateItemField(order.id, item.id, 'quantity', parseInt(e.target.value) || 1)}
                                                            />
                                                        </div>
                                                        <div>
                                                            <Input 
                                                                type="number" 
                                                                className="h-8 text-xs" 
                                                                value={item.price_at_sale} 
                                                                onChange={e => updateItemField(order.id, item.id, 'price_at_sale', parseFloat(e.target.value) || 0)}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="flex justify-between items-center pt-2 mt-4 border-t">
                                            <Label>{t("Payment Status")}</Label>
                                            <Select value={order.payment_status || "Not Paid"} onValueChange={(val) => updateOrderField(order, 'payment_status', val)}>
                                                <SelectTrigger className="w-[150px] h-8">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Not Paid">Not Paid</SelectItem>
                                                    <SelectItem value="Paid">Paid</SelectItem>
                                                    <SelectItem value="Partial">Partial</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="bg-muted/10 border-t p-4 flex justify-end gap-3">
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10">
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

                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
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
    );
}
