"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { Loader2, PackageSearch, AlertCircle } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type RestockItem = {
    variantId: string;
    productName: string;
    variantTitle: string;
    sku: string;
    currentStock: number;
    salesVelocity: number;
    predictedDemand: number;
    needToBuy: number;
};

export function RestockPredictor() {
    const { activeBusiness } = useBusiness();
    const [loading, setLoading] = useState(true);
    const [restockItems, setRestockItems] = useState<RestockItem[]>([]);
    const [historyDays, setHistoryDays] = useState(14);
    const [coverageDays, setCoverageDays] = useState(14);

    useEffect(() => {
        if (activeBusiness) {
            fetchRestockData();
        }
    }, [activeBusiness]);

    const fetchRestockData = async () => {
        setLoading(true);
        try {
            // 1. Get settings
            const hDays = activeBusiness?.theme_config?.restock_history_days || 14;
            const cDays = activeBusiness?.theme_config?.restock_coverage_days || 14;
            setHistoryDays(hDays);
            setCoverageDays(cDays);

            // 2. Fetch all variants for this business (paginated to avoid 1000 limit)
            let allVariants: any[] = [];
            let vPage = 0;
            let vHasMore = true;
            
            while (vHasMore) {
                const { data: variantsData, error: variantsError } = await supabase
                    .from("variants")
                    .select("id, title, sku, stock_qty, products(name)")
                    .eq("business_id", activeBusiness!.id)
                    .range(vPage * 1000, (vPage + 1) * 1000 - 1);
                    
                if (variantsError) throw variantsError;
                
                if (variantsData && variantsData.length > 0) {
                    allVariants.push(...variantsData);
                    if (variantsData.length < 1000) vHasMore = false;
                    else vPage++;
                } else {
                    vHasMore = false;
                }
            }

            // 3. Fetch order items from the last `hDays`
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - hDays);
            
            // Note: We paginate order fetching to bypass the 1000 limit
            let allOrders: any[] = [];
            let page = 0;
            let hasMore = true;
            
            while (hasMore) {
                const { data: ordersData, error: ordersError } = await supabase
                    .from("orders")
                    .select("id, status")
                    .eq("business_id", activeBusiness!.id)
                    .gte("created_at", startDate.toISOString())
                    .neq("status", "Cancelled")
                    .neq("status", "Waiting")
                    .range(page * 1000, (page + 1) * 1000 - 1);
                    
                if (ordersError) throw ordersError;
                
                if (ordersData && ordersData.length > 0) {
                    allOrders.push(...ordersData);
                    if (ordersData.length < 1000) hasMore = false;
                    else page++;
                } else {
                    hasMore = false;
                }
            }
            
            const orderIds = allOrders.map(o => o.id);
            
            let allOrderItems: any[] = [];
            // Chunk orderIds if there are too many (PostgREST limit for 'in' filter is usually high, but safe to chunk if > 500)
            const chunkSize = 200;
            for (let i = 0; i < orderIds.length; i += chunkSize) {
                const chunk = orderIds.slice(i, i + chunkSize);
                if (chunk.length === 0) continue;
                
                const { data: itemsData, error: itemsError } = await supabase
                    .from("order_items")
                    .select("variant_id, quantity")
                    .in("order_id", chunk);
                    
                if (itemsError) throw itemsError;
                if (itemsData) allOrderItems.push(...itemsData);
            }

            // 4. Aggregate sales per variant
            const salesMap: Record<string, number> = {};
            allOrderItems.forEach(item => {
                if (item.variant_id) {
                    salesMap[item.variant_id] = (salesMap[item.variant_id] || 0) + (item.quantity || 1);
                }
            });

            // 5. Calculate metrics
            const items: RestockItem[] = [];
            allVariants.forEach(v => {
                const totalSold = salesMap[v.id] || 0;
                const dailyVelocity = totalSold / hDays;
                const predictedDemand = dailyVelocity * cDays;
                const currentStock = v.stock_qty || 0;
                
                const needToBuy = Math.max(0, Math.ceil(predictedDemand - currentStock));
                
                if (needToBuy > 0) {
                    items.push({
                        variantId: v.id,
                        // @ts-ignore
                        productName: v.products?.name || "Unknown Product",
                        variantTitle: v.title,
                        sku: v.sku || "N/A",
                        currentStock,
                        salesVelocity: Number(dailyVelocity.toFixed(2)),
                        predictedDemand: Math.ceil(predictedDemand),
                        needToBuy
                    });
                }
            });
            
            // Sort by highest need
            items.sort((a, b) => b.needToBuy - a.needToBuy);
            
            setRestockItems(items);

        } catch (error) {
            console.error("Error fetching restock data:", error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-4" />
                <p>Analyzing sales data and predicting inventory...</p>
            </div>
        );
    }

    if (restockItems.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center border rounded-lg bg-muted/10 mt-6">
                <PackageSearch className="h-12 w-12 text-emerald-500 mb-4" />
                <h3 className="text-xl font-semibold mb-2">Inventory Looks Good!</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                    Based on your sales velocity over the last {historyDays} days, you have enough stock to cover the next {coverageDays} days.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6 mt-6">
            <div className="flex items-center gap-2 bg-blue-50 text-blue-800 p-4 rounded-md border border-blue-200">
                <AlertCircle className="h-5 w-5 text-blue-600" />
                <p className="text-sm">
                    Showing predictions based on the last <strong>{historyDays} days</strong> of sales, covering demand for the next <strong>{coverageDays} days</strong>.
                </p>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Product</TableHead>
                                <TableHead>Variant / SKU</TableHead>
                                <TableHead className="text-center">Current Stock</TableHead>
                                <TableHead className="text-center">Sales/Day</TableHead>
                                <TableHead className="text-center">Predicted Demand</TableHead>
                                <TableHead className="text-right font-bold text-red-600">Need to Buy</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {restockItems.map((item) => (
                                <TableRow key={item.variantId}>
                                    <TableCell className="font-medium">{item.productName}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span>{item.variantTitle}</span>
                                            <span className="text-xs text-muted-foreground">{item.sku}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Badge variant="outline" className={item.currentStock <= 0 ? "text-red-600 border-red-200 bg-red-50" : ""}>
                                            {item.currentStock}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-center text-muted-foreground">
                                        {item.salesVelocity}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {item.predictedDemand} units
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Badge variant="destructive" className="text-sm px-2 py-1">
                                            {item.needToBuy}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
