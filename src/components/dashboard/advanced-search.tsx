"use client";

import { useState, useEffect } from "react";
import { Search, Package, ShoppingCart, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";

export function AdvancedSearch() {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<{ products: any[], orders: any[] }>({ products: [], orders: [] });
    const [loading, setLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState<{ type: 'product' | 'order', data: any } | null>(null);

    useEffect(() => {
        const delayDebounce = setTimeout(() => {
            if (query.trim().length > 1) {
                performSearch(query);
            } else {
                setResults({ products: [], orders: [] });
            }
        }, 500);

        return () => clearTimeout(delayDebounce);
    }, [query]);

    async function performSearch(searchTerm: string) {
        setLoading(true);
        try {
            const cleanQuery = searchTerm.trim();
            if (!cleanQuery) return;

            // 1. Search Products (Simple Name Search - Most reliable)
            const { data: products } = await supabase
                .from("products")
                .select("*, variants(*)")
                .ilike("name", `%${cleanQuery}%`)
                .limit(5);

            // 2. Search Orders Strategy
            let matchingOrders: any[] = [];

            // A. Search by specific Order ID if it looks like a generic ID or UUID
            // Note: Postgres UUID check is strict. We'll search text columns or use a specific strategy if needed.
            // For now, let's search Customers first, as that's the most common "text" search user wants (Name/Phone).

            const { data: matchingCustomers } = await supabase
                .from("customers")
                .select("id")
                .or(`name.ilike.%${cleanQuery}%,phone.ilike.%${cleanQuery}%`)
                .limit(10);

            const customerIds = matchingCustomers?.map(c => c.id) || [];

            let orderQuery = supabase
                .from("orders")
                .select("*, order_items(*, variants(*))")
                .order("created_at", { ascending: false })
                .limit(10);

            if (customerIds.length > 0) {
                // If we found customers, get their orders
                orderQuery = orderQuery.in("customer_id", customerIds);
            } else {
                // If no key customers found, strictly search generic columns if possible, OR just search ID if applicable.
                // Searching JSONB "customer_info" directly with 'ilike' crashes, so we avoid it.
                // We'll fallback to ID search if it matches UUID format, or Channel/Status.

                // Check if query is a valid-ish UUID to prevent DB errors
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanQuery);
                if (isUuid) {
                    orderQuery = orderQuery.eq('id', cleanQuery);
                } else {
                    // Just search text columns we have
                    orderQuery = orderQuery.or(`status.ilike.%${cleanQuery}%,channel.ilike.%${cleanQuery}%`);
                }
            }

            const { data: orders } = await orderQuery;
            matchingOrders = orders || [];

            // If we found customers but strict ID search was main intent, we might want to blend? 
            // Current logic: If found customers -> Search THEIR orders. 
            // If NOT found customers -> Search Orders by ID/Status. 
            // This is a reasonable "Smart" logic.

            setResults({
                products: products || [],
                orders: matchingOrders
            });
            setIsOpen(true);
        } catch (error) {
            console.error("Search Error:", error);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="relative w-full max-w-3xl mx-auto z-40">
            <div className="relative group">
                <Search className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                <Input
                    placeholder="Search Products, Orders, Customers (Phone/Name)... | بحث شامل"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-12 h-12 text-lg bg-background border-2 focus-visible:ring-primary/50 shadow-sm transition-all duration-200"
                />
                {loading && (
                    <div className="absolute right-4 top-3.5">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                )}
            </div>

            {/* Results Dropdown */}
            {query.length > 1 && isOpen && (results.products.length > 0 || results.orders.length > 0) && (
                <Card className="absolute top-full mt-2 w-full max-h-[600px] overflow-auto shadow-2xl border-2 z-50 animate-in fade-in slide-in-from-top-2">
                    <CardContent className="p-2 space-y-6">

                        {/* Products */}
                        {results.products.length > 0 && (
                            <div className="space-y-2">
                                <h3 className="text-sm font-semibold text-muted-foreground px-2">Products</h3>
                                {results.products.map(product => (
                                    <Dialog key={product.id}>
                                        <DialogTrigger asChild>
                                            <div
                                                className="flex items-center gap-3 p-2 hover:bg-muted rounded-md cursor-pointer transition-colors"
                                                onClick={() => setSelectedItem({ type: 'product', data: product })}
                                            >
                                                <Package className="h-4 w-4 text-primary" />
                                                <div className="flex-1">
                                                    <div className="font-medium">{product.name}</div>
                                                    <div className="text-xs text-muted-foreground line-clamp-1">{product.description}</div>
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {product.variants?.length} variants
                                                </div>
                                            </div>
                                        </DialogTrigger>
                                        <DialogContent className="max-w-2xl">
                                            <DialogHeader>
                                                <DialogTitle>{product.name}</DialogTitle>
                                            </DialogHeader>
                                            <div className="space-y-4">
                                                <p className="text-sm text-muted-foreground">{product.description}</p>
                                                <div className="border rounded-md">
                                                    <table className="w-full text-sm text-left">
                                                        <thead className="bg-muted text-muted-foreground">
                                                            <tr>
                                                                <th className="p-2">Variant</th>
                                                                <th className="p-2">SKU</th>
                                                                <th className="p-2">Price</th>
                                                                <th className="p-2">Cost</th>
                                                                <th className="p-2">Stock</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {product.variants?.map((v: any) => (
                                                                <tr key={v.id} className="border-t">
                                                                    <td className="p-2 font-medium">{v.title}</td>
                                                                    <td className="p-2">{v.sku}</td>
                                                                    <td className="p-2">{formatCurrency(v.sale_price)}</td>
                                                                    <td className="p-2 text-muted-foreground">{formatCurrency(v.cost_price)}</td>
                                                                    <td className="p-2">
                                                                        {v.track_inventory ? v.stock_qty : 'N/A'}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </DialogContent>
                                    </Dialog>
                                ))}
                            </div>
                        )}

                        {/* Orders */}
                        {results.orders.length > 0 && (
                            <div className="space-y-2">
                                <h3 className="text-sm font-semibold text-muted-foreground px-2">Orders</h3>
                                {results.orders.map(order => (
                                    <Dialog key={order.id}>
                                        <DialogTrigger asChild>
                                            <div
                                                className="flex items-center gap-3 p-2 hover:bg-muted rounded-md cursor-pointer transition-colors"
                                                onClick={() => setSelectedItem({ type: 'order', data: order })}
                                            >
                                                <ShoppingCart className="h-4 w-4 text-blue-500" />
                                                <div className="flex-1">
                                                    <div className="font-medium">Order #{order.id.slice(0, 8)}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {format(new Date(order.created_at), 'PPP')} • {order.status}
                                                    </div>
                                                </div>
                                                <div className="font-bold">
                                                    {formatCurrency(order.total_amount)}
                                                </div>
                                            </div>
                                        </DialogTrigger>
                                        <DialogContent className="max-w-2xl">
                                            <DialogHeader>
                                                <DialogTitle className="flex justify-between items-center">
                                                    <span>Order Details</span>
                                                    <Badge variant="outline">{order.status}</Badge>
                                                </DialogTitle>
                                            </DialogHeader>
                                            <div className="grid gap-4 py-4">
                                                <div className="grid grid-cols-2 gap-4 text-sm">
                                                    <div>
                                                        <label className="font-semibold text-muted-foreground">Customer</label>
                                                        <div className="font-medium">{order.customer_info?.name || 'Guest'}</div>
                                                        <div className="text-muted-foreground">{order.customer_info?.phone}</div>
                                                    </div>
                                                    <div className="text-right">
                                                        <label className="font-semibold text-muted-foreground">Date</label>
                                                        <div>{format(new Date(order.created_at), 'PPP p')}</div>
                                                    </div>
                                                </div>

                                                <div className="border rounded-md overflow-hidden">
                                                    <table className="w-full text-sm">
                                                        <thead className="bg-muted">
                                                            <tr>
                                                                <th className="p-2 text-left">Item</th>
                                                                <th className="p-2 text-right">Price</th>
                                                                <th className="p-2 text-right">Qty</th>
                                                                <th className="p-2 text-right">Total</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {order.order_items?.map((item: any) => (
                                                                <tr key={item.id} className="border-t">
                                                                    <td className="p-2">
                                                                        <div className="font-medium">{item.variants?.products?.name || 'Product'}</div>
                                                                        <div className="text-xs text-muted-foreground">{item.variants?.title}</div>
                                                                    </td>
                                                                    <td className="p-2 text-right">{formatCurrency(item.price_at_sale)}</td>
                                                                    <td className="p-2 text-right">{item.quantity}</td>
                                                                    <td className="p-2 text-right">{formatCurrency(item.price_at_sale * item.quantity)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                        <tfoot className="bg-muted/50 font-medium">
                                                            <tr>
                                                                <td colSpan={3} className="p-2 text-right">Subtotal</td>
                                                                <td className="p-2 text-right">{formatCurrency(order.subtotal)}</td>
                                                            </tr>
                                                            {order.shipping_cost > 0 && (
                                                                <tr>
                                                                    <td colSpan={3} className="p-2 text-right">Shipping</td>
                                                                    <td className="p-2 text-right">{formatCurrency(order.shipping_cost)}</td>
                                                                </tr>
                                                            )}
                                                            {order.discount > 0 && (
                                                                <tr>
                                                                    <td colSpan={3} className="p-2 text-right text-green-600">Discount</td>
                                                                    <td className="p-2 text-right text-green-600">-{formatCurrency(order.discount)}</td>
                                                                </tr>
                                                            )}
                                                            <tr className="border-t border-muted-foreground/20">
                                                                <td colSpan={3} className="p-2 text-right text-base font-bold">Total</td>
                                                                <td className="p-2 text-right text-base font-bold">{formatCurrency(order.total_amount)}</td>
                                                            </tr>
                                                        </tfoot>
                                                    </table>
                                                </div>

                                                <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                                                    <div>Channel: {order.channel}</div>
                                                    <div className="text-right">ID: {order.id}</div>
                                                </div>
                                            </div>
                                        </DialogContent>
                                    </Dialog>
                                ))}
                            </div>
                        )}

                        {results.products.length === 0 && results.orders.length === 0 && (
                            <div className="text-center py-4 text-muted-foreground text-sm">
                                No results found.
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
