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
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, X, AlertTriangle, Search, PackageSearch, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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
    easyorders_id: string;
    payment_status: string;
    paid_amount: number;
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


const GOVERNORATES = [
    "Cairo", "New Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
];

export default function EasyOrdersPage() {
    const { activeBusiness } = useBusiness();
    const { t } = useLanguage();
    
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [variants, setVariants] = useState<Variant[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    
    // Treasury Modal state
    const [treasuryModalOpen, setTreasuryModalOpen] = useState(false);
    const [pendingOrder, setPendingOrder] = useState<Order | null>(null);
    const [transactionAccount, setTransactionAccount] = useState("");
    
    // Add Item state per order
    const [addItemOpen, setAddItemOpen] = useState<Record<string, boolean>>({});
    const [selectedProductForAdd, setSelectedProductForAdd] = useState<Record<string, string>>({});
    const [selectedVariantForAdd, setSelectedVariantForAdd] = useState<Record<string, string>>({});
    const [selectedProductOverride, setSelectedProductOverride] = useState<Record<string, string>>({});

    useEffect(() => {
        if (activeBusiness) {
            fetchOrders();
            fetchVariants();
            fetchProducts();
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

    
    const fetchProducts = async () => {
        if (!activeBusiness) return;
        const { data, error } = await supabase
            .from('products')
            .select('id, name, variants(id, title, sale_price, stock_qty, track_inventory)')
            .order('name');
        if (error) console.error("Error fetching products:", error);
        if (data) setProducts(data);
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

    
    const executeMoveToPending = async (order: Order, accountName?: string) => {
        setSaving(order.id);
        try {
            await handleUpdateOrder(order.id, { status: 'Pending' });
            
            // Create transaction if paid
            if (accountName && order.paid_amount > 0) {
                await supabase.from('transactions').insert({
                    business_id: activeBusiness?.id,
                    transaction_date: new Date().toISOString().split('T')[0],
                    type: 'revenue',
                    category: 'orders_collection',
                    amount: order.paid_amount,
                    description: `Payment collection for Order ${order.easyorders_id || order.id.slice(0,8)}`,
                    account_name: accountName
                });
            }
            
            toast.success(t("Order moved to Pending successfully"));
            setOrders(orders.filter(o => o.id !== order.id));
            setTreasuryModalOpen(false);
            setPendingOrder(null);
            setTransactionAccount("");
        } catch (error) {
            console.error("Error moving to pending:", error);
            toast.error(t("Failed to move order"));
        } finally {
            setSaving(null);
        }
    };

    const handleMoveToPending = async (order: Order) => {
        // Validate unmapped items
        const hasUnmapped = order.order_items.some(item => !item.variant_id);
        if (hasUnmapped) {
            toast.error(t("Please map all products before moving to pending"));
            return;
        }

        if (order.payment_status === 'Paid' || order.payment_status === 'Partially Paid') {
            setPendingOrder(order);
            setTreasuryModalOpen(true);
        } else {
            executeMoveToPending(order);
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
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, [field]: value } : o));
        try {
            await handleUpdateOrder(order.id, { [field]: value });
        } catch(e) {
            toast.error(t("Failed to save"));
        }
    };

    const updateItemField = async (orderId: string, itemId: string, field: string, value: any) => {
        let updatedOrder: Order | undefined;
        setOrders(prev => prev.map(o => {
            if (o.id === orderId) {
                const newItems = o.order_items.map(i => i.id === itemId ? { ...i, [field]: value } : i);
                const newTotal = newItems.reduce((sum, item) => sum + (item.price_at_sale * item.quantity), 0) + o.shipping_cost;
                const newOrderObj = { ...o, order_items: newItems, total_amount: newTotal, subtotal: newTotal - o.shipping_cost };
                updatedOrder = newOrderObj;
                return newOrderObj;
            }
            return o;
        }));
        
        try {
            await handleUpdateItem(itemId, { [field]: value });
            if (updatedOrder) {
                await handleUpdateOrder(orderId, { subtotal: updatedOrder.subtotal, total_amount: updatedOrder.total_amount });
            }
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
                    <h2 className="text-3xl font-bold tracking-tight flex items-center">
                        {t("EasyOrders")}
                        {!loading && orders.length > 0 && (
                            <Badge variant="secondary" className="ml-3 text-lg px-3 py-1 bg-primary/10 text-primary">
                                {orders.length} {t("Waiting")}
                            </Badge>
                        )}
                    </h2>
                    <p className="text-muted-foreground">{t("Manage incoming orders from EasyOrders that are waiting for review.")}</p>
                </div>
            </div>

            
            {/* Treasury Transaction Modal */}
            <AlertDialog open={treasuryModalOpen} onOpenChange={setTreasuryModalOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Payment Collection</AlertDialogTitle>
                        <AlertDialogDescription>
                            This order has a payment of {formatCurrency(pendingOrder?.paid_amount || 0)}. Select the treasury account to deposit this amount into.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Select Account</Label>
                            <Select value={transactionAccount} onValueChange={setTransactionAccount}>
                                <SelectTrigger><SelectValue placeholder="Choose Account" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Mohamed Adel">Mohamed Adel</SelectItem>
                                    <SelectItem value="Abdallah Sherif">Abdallah Sherif</SelectItem>
                                    <SelectItem value="Split">Split (50/50)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => { setPendingOrder(null); setTransactionAccount(""); }}>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                            disabled={!transactionAccount || saving === pendingOrder?.id}
                            onClick={() => pendingOrder && executeMoveToPending(pendingOrder, transactionAccount)}
                        >
                            {saving === pendingOrder?.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirm & Deposit
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

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
                                                <Select 
                                                    value={order.customer_info?.governorate || ""} 
                                                    onValueChange={val => updateCustomerInfo(order, 'governorate', val)}
                                                >
                                                    <SelectTrigger className={!order.customer_info?.governorate ? "border-destructive" : ""}>
                                                        <SelectValue placeholder="Select Governorate" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {GOVERNORATES.map(g => (
                                                            <SelectItem key={g} value={g}>{g}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
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
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-normal text-muted-foreground">Shipping:</span>
                                                <Input 
                                                    type="number"
                                                    className="w-24 h-8"
                                                    value={order.shipping_cost}
                                                    onChange={e => {
                                                        const val = parseFloat(e.target.value) || 0;
                                                        const newTotal = order.order_items.reduce((sum, item) => sum + (item.price_at_sale * item.quantity), 0) + val;
                                                        updateOrderField(order, 'shipping_cost', val);
                                                        updateOrderField(order, 'total_amount', newTotal);
                                                    }}
                                                />
                                            </div>
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
                                                                <Popover>
                                                                    <PopoverTrigger asChild>
                                                                        <Button variant="outline" className="w-full h-8 text-xs justify-between border-destructive font-normal">
                                                                            Select Match
                                                                            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                                                                        </Button>
                                                                    </PopoverTrigger>
                                                                    <PopoverContent className="w-[300px] p-0" align="start">
                                                                        <Command>
                                                                            <CommandInput placeholder="Search variant..." />
                                                                            <CommandEmpty>No variant found.</CommandEmpty>
                                                                            <CommandGroup className="max-h-60 overflow-auto">
                                                                                <CommandList>
                                                                                {variants.map(v => (
                                                                                    <CommandItem
                                                                                        key={v.id}
                                                                                        value={v.products?.name + " " + v.title + " " + v.sku}
                                                                                        onSelect={() => {
                                                                                            const newOrders = [...orders];
                                                                                            const oIndex = newOrders.findIndex(o => o.id === order.id);
                                                                                            const iIndex = newOrders[oIndex].order_items.findIndex(i => i.id === item.id);
                                                                                            newOrders[oIndex].order_items[iIndex] = {
                                                                                                ...item,
                                                                                                variant_id: v.id,
                                                                                                variants: v as any
                                                                                            };
                                                                                            setOrders(newOrders);
                                                                                            handleUpdateItem(item.id, { variant_id: v.id });
                                                                                        }}
                                                                                    >
                                                                                        <Check className={cn("mr-2 h-4 w-4", item.variant_id === v.id ? "opacity-100" : "opacity-0")} />
                                                                                        {v.products?.name} - {v.title} ({v.sku})
                                                                                    </CommandItem>
                                                                                ))}
                                                                                </CommandList>
                                                                            </CommandGroup>
                                                                        </Command>
                                                                    </PopoverContent>
                                                                </Popover>
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
                                        
                                            {/* Add Extra Item */}
                                            <div className="mt-4 pt-4 border-t border-dashed">
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    className="w-full border-dashed"
                                                    onClick={() => setAddItemOpen(prev => ({...prev, [order.id]: !prev[order.id]}))}
                                                >
                                                    {addItemOpen[order.id] ? "Cancel Adding" : "+ Add Item"}
                                                </Button>
                                                
                                                {addItemOpen[order.id] && (
                                                    <div className="mt-3 p-3 bg-muted/20 border rounded-md space-y-3">
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Product</Label>
                                                                <Popover>
                                                                    <PopoverTrigger asChild>
                                                                        <Button variant="outline" className="w-full justify-between h-8 text-xs font-normal">
                                                                            {selectedProductForAdd[order.id] ? products.find(p => p.id === selectedProductForAdd[order.id])?.name : "Select product..."}
                                                                            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                                                                        </Button>
                                                                    </PopoverTrigger>
                                                                    <PopoverContent className="w-[250px] p-0" align="start">
                                                                        <Command>
                                                                            <CommandInput placeholder="Search product..." />
                                                                            <CommandEmpty>No product found.</CommandEmpty>
                                                                            <CommandGroup className="max-h-60 overflow-auto">
                                                                                <CommandList>
                                                                                {products.map(p => (
                                                                                    <CommandItem
                                                                                        key={p.id}
                                                                                        value={p.name}
                                                                                        onSelect={() => {
                                                                                            setSelectedProductForAdd(prev => ({...prev, [order.id]: p.id}));
                                                                                            setSelectedVariantForAdd(prev => ({...prev, [order.id]: ""}));
                                                                                        }}
                                                                                    >
                                                                                        <Check className={cn("mr-2 h-4 w-4", selectedProductForAdd[order.id] === p.id ? "opacity-100" : "opacity-0")} />
                                                                                        {p.name}
                                                                                    </CommandItem>
                                                                                ))}
                                                                                </CommandList>
                                                                            </CommandGroup>
                                                                        </Command>
                                                                    </PopoverContent>
                                                                </Popover>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Variant</Label>
                                                                <Select 
                                                                    value={selectedVariantForAdd[order.id] || ""}
                                                                    onValueChange={(val) => setSelectedVariantForAdd(prev => ({...prev, [order.id]: val}))}
                                                                    disabled={!selectedProductForAdd[order.id]}
                                                                >
                                                                    <SelectTrigger className="h-8 text-xs">
                                                                        <SelectValue placeholder="Variant" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {products.find(p => p.id === selectedProductForAdd[order.id])?.variants.map((v: any) => (
                                                                            <SelectItem key={v.id} value={v.id}>
                                                                                {v.title} - {formatCurrency(v.sale_price)}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        </div>
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
                                                                        sku: "",
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
                                                                
                                                                handleUpdateOrder(order.id, { subtotal: newTotal - order.shipping_cost, total_amount: newTotal });
                                                                
                                                                setAddItemOpen(prev => ({...prev, [order.id]: false}));
                                                                toast.success("Item added");
                                                            }}
                                                        >
                                                            Add to Order
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>

                                        <div className="flex flex-col gap-3 pt-2 mt-4 border-t">
                                            <div className="flex justify-between items-center">
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
                                            {order.payment_status === 'Partially Paid' && (
                                                <div className="flex justify-between items-center">
                                                    <Label>{t("Paid Amount")}</Label>
                                                    <Input 
                                                        type="number" 
                                                        className="w-[150px] h-8" 
                                                        value={order.paid_amount || 0}
                                                        onChange={(e) => updateOrderField(order, 'paid_amount', parseFloat(e.target.value) || 0)}
                                                    />
                                                </div>
                                            )}
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
