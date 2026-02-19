"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import { Loader2, CheckCircle2, Package, User, MapPin, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { ItemsSummary } from "@/components/purchases/items-summary";
import { MultiSelect, Option } from "@/components/ui/multi-select";

const GOVERNORATES = [
    "Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
].sort();

const GOV_OPTIONS: Option[] = [
    { label: "All Except Cairo & Giza", value: "ALL_EXCEPT_CAIRO_GIZA" },
    ...GOVERNORATES.map(g => ({ label: g, value: g }))
];

// Type definitions
type OrderItem = {
    id: string; // items usually have IDs in DB, but if not we can use index
    quantity: number;
    variant: {
        title: string;
        product: {
            name: string;
        };
    };
};

type Order = {
    id: string;
    created_at: string;
    status: string;
    customer_info: {
        name: string;
        phone: string;
        governorate: string;
    };
    items: OrderItem[];
};

export default function PurchasesPage() {
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    // Track checked items: Record<OrderId, ItemIndex[]>
    // We use Set<number> for O(1) lookups per order, stored in a Record by OrderID
    const [checkedState, setCheckedState] = useState<Record<string, Set<number>>>({});
    const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
    const [govFilter, setGovFilter] = useState<string[]>([]);

    useEffect(() => {
        fetchPendingOrders();
    }, []);

    const fetchPendingOrders = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("orders")
            .select(`
                id,
                created_at,
                status,
                customer_info,
                items:order_items (
                    quantity,
                    variant:variants (
                        title,
                        cost_price,
                        stock_qty,
                        product:products (
                            name
                        )
                    )
                )
            `)
            .in("status", ["Pending", "Processing"])
            .order("created_at", { ascending: true }); // Oldest first (FIFO)

        if (error) {
            console.error("Error fetching orders:", error);
            toast.error("Failed to load pending orders");
        } else {
            // Need to map data to our type safely
            const mappedOrders = (data || []).map((o: any) => ({
                ...o,
                items: o.items || []
            }));
            setOrders(mappedOrders);
            if (mappedOrders.length === 0) {
                // Debugging help for user
                console.log("No orders found with status Pending or Processing");
            }
        }
        setLoading(false);
    };

    const handleCheckItem = async (orderId: string, itemIndex: number, totalItems: number) => {
        // Update local checked state
        setCheckedState(prev => {
            const currentChecks = new Set(prev[orderId] || []);
            if (currentChecks.has(itemIndex)) {
                currentChecks.delete(itemIndex);
            } else {
                currentChecks.add(itemIndex);
            }

            const newState = { ...prev, [orderId]: currentChecks };

            // Check if all items are checked
            if (currentChecks.size === totalItems) {
                // Trigger auto-complete logic
                completeOrder(orderId);
            }

            return newState;
        });
    };

    const completeOrder = async (orderId: string) => {
        if (processingIds.has(orderId)) return; // Prevent double submission

        setProcessingIds(prev => new Set(prev).add(orderId));
        toast.promise(
            performUpdate(orderId),
            {
                loading: 'All items checked! Moving to Prepared...',
                success: 'Order marked as Prepared',
                error: 'Failed to update order'
            }
        );
    };

    const performUpdate = async (orderId: string) => {
        // 1. Wait a brief moment so user sees the last checkmark
        await new Promise(resolve => setTimeout(resolve, 500));

        // 2. Update Supabase
        const { error } = await supabase
            .from("orders")
            .update({ status: "Prepared" })
            .eq("id", orderId);

        if (error) throw error;

        // 3. Remove from local list
        setOrders(prev => prev.filter(o => o.id !== orderId));

        // 4. Cleanup state
        setProcessingIds(prev => {
            const next = new Set(prev);
            next.delete(orderId);
            return next;
        });
        setCheckedState(prev => {
            const next = { ...prev };
            delete next[orderId];
            return next;
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const filteredOrders = orders.filter(order => {
        if (govFilter.length === 0) return true;
        
        const gov = order.customer_info?.governorate || "";
        const hasAllExcept = govFilter.includes("ALL_EXCEPT_CAIRO_GIZA");
        
        if (hasAllExcept) {
            if (gov === "Cairo" || gov === "Giza") {
                return govFilter.includes(gov);
            }
            return true;
        }
        
        return govFilter.includes(gov);
    });

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Purchases / Fulfillment</h1>
                    <p className="text-muted-foreground">Pick items to move Pending orders to Prepared.</p>
                </div>
                <Badge variant="secondary" className="text-lg px-4 py-1">
                    {filteredOrders.length} Pending
                </Badge>
            </div>

            <div className="flex items-center gap-2 bg-white p-4 rounded-md border shadow-sm w-full md:max-w-md">
                <MultiSelect
                    options={GOV_OPTIONS}
                    selected={govFilter}
                    onChange={setGovFilter}
                    placeholder="Filter by Governorate..."
                    className="w-full bg-white z-50 text-sm"
                />
            </div>

            <ItemsSummary orders={filteredOrders} />

            {
                filteredOrders.length === 0 ? (
                    <div className="text-center py-12 border rounded-lg bg-muted/10">
                        <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
                        <h3 className="text-xl font-semibold">All Caught Up!</h3>
                        <p className="text-muted-foreground">No pending orders to fulfill.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {filteredOrders.map((order) => {
                            const checked = checkedState[order.id] || new Set();
                            const isCompleting = processingIds.has(order.id);

                            return (
                                <Card
                                    key={order.id}
                                    className={`flex flex-col h-full transition-all duration-500 ${isCompleting ? 'opacity-50 scale-95 bg-green-50' : 'hover:shadow-md'}`}
                                >
                                    <CardHeader className="pb-3 bg-muted/30">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <CardTitle className="font-mono text-lg">#{order.id.slice(0, 8)}</CardTitle>
                                                <p className="text-xs text-muted-foreground">
                                                    {format(new Date(order.created_at), "MMM d, h:mm a")}
                                                </p>
                                            </div>
                                            <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
                                                Warning: Pending
                                            </Badge>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="flex-1 pt-4">
                                        <div className="mb-4 space-y-1 text-sm">
                                            <div className="flex items-center gap-2 text-gray-700">
                                                <User className="h-4 w-4" />
                                                <span className="font-semibold">{order.customer_info?.name || "Unknown"}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-gray-500">
                                                <MapPin className="h-4 w-4" />
                                                <span>{order.customer_info?.governorate || "No Location"}</span>
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">
                                                Items to Pick ({checked.size}/{order.items.length})
                                            </div>
                                            <div className="space-y-2">
                                                {order.items.map((item, idx) => (
                                                    <div
                                                        key={idx}
                                                        className={`flex items-start space-x-3 p-2 rounded-md border transition-colors ${checked.has(idx) ? 'bg-green-50 border-green-200' : 'bg-white'}`}
                                                    >
                                                        <Checkbox
                                                            id={`item-${order.id}-${idx}`}
                                                            checked={checked.has(idx)}
                                                            onCheckedChange={() => handleCheckItem(order.id, idx, order.items.length)}
                                                            disabled={isCompleting}
                                                        />
                                                        <label
                                                            htmlFor={`item-${order.id}-${idx}`}
                                                            className={`text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer ${checked.has(idx) ? 'line-through text-gray-400' : 'font-medium'}`}
                                                        >
                                                            <div className="flex justify-between w-full">
                                                                <span>{item.variant.product.name}</span>
                                                                <Badge variant="secondary" className="h-5 px-1.5 text-xs">x{item.quantity}</Badge>
                                                            </div>
                                                            <span className="text-xs text-muted-foreground mt-1 block">{item.variant.title}</span>
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </CardContent>
                                    <CardFooter className="bg-muted/10 py-3 text-xs text-muted-foreground flex justify-center border-t">
                                        {checked.size === order.items.length && isCompleting
                                            ? "Completing..."
                                            : "Check all items to finish"
                                        }
                                    </CardFooter>
                                </Card>
                            );
                        })}
                    </div>
                )
            }
        </div >
    );
}
