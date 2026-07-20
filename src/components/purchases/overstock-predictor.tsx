"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { Loader2, PackageMinus, AlertTriangle } from "lucide-react";
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
import { formatCurrency } from "@/lib/utils";

type OverstockItem = {
    variantId: string;
    productName: string;
    variantTitle: string;
    sku: string;
    currentStock: number;
    salesVelocity: number;
    daysPerSale: number;
    predictedDemand: number;
    surplusQuantity: number;
    overstockValue: number;
};

export function OverstockPredictor() {
    const { activeBusiness } = useBusiness();
    const [loading, setLoading] = useState(true);
    const [overstockItems, setOverstockItems] = useState<OverstockItem[]>([]);
    const [historyDays, setHistoryDays] = useState(14);
    const [coverageDays, setCoverageDays] = useState(14);

    useEffect(() => {
        if (activeBusiness) {
            fetchOverstockData();
        }
    }, [activeBusiness]);

    const fetchOverstockData = async () => {
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
                    .select("id, title, sku, stock_qty, cost_price, products(name)")
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
            const items: OverstockItem[] = [];
            allVariants.forEach(v => {
                const totalSold = salesMap[v.id] || 0;
                const dailyVelocity = totalSold / hDays;
                const daysPerSale = dailyVelocity > 0 ? (1 / dailyVelocity) : 0;
                const predictedDemand = Math.ceil(dailyVelocity * cDays);
                const currentStock = v.stock_qty || 0;
                const costPrice = v.cost_price || 0;
                
                const surplusQuantity = currentStock - predictedDemand;
                
                if (surplusQuantity > 0) {
                    items.push({
                        variantId: v.id,
                        // @ts-ignore
                        productName: v.products?.name || "Unknown Product",
                        variantTitle: v.title,
                        sku: v.sku || "N/A",
                        currentStock,
                        salesVelocity: Number(dailyVelocity.toFixed(2)),
                        daysPerSale: Number(daysPerSale.toFixed(1)),
                        predictedDemand,
                        surplusQuantity,
                        overstockValue: surplusQuantity * costPrice
                    });
                }
            });
            
            // Sort by highest overstock value first, then by highest surplus quantity
            items.sort((a, b) => {
                if (b.overstockValue !== a.overstockValue) {
                    return b.overstockValue - a.overstockValue;
                }
                return b.surplusQuantity - a.surplusQuantity;
            });
            
            setOverstockItems(items);

        } catch (error) {
            console.error("Error fetching overstock data:", error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-4" />
                <p>Analyzing slow-moving inventory and overstock...</p>
            </div>
        );
    }

    if (overstockItems.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center border rounded-lg bg-muted/10 mt-6">
                <PackageMinus className="h-12 w-12 text-emerald-500 mb-4" />
                <h3 className="text-xl font-semibold mb-2">No Overstock!</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                    Your inventory is well-optimized. You do not have any excess stock based on your coverage settings.
                </p>
            </div>
        );
    }

    const totalOverstockValue = overstockItems.reduce((sum, item) => sum + item.overstockValue, 0);

    return (
        <div className="space-y-6 mt-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 bg-amber-50 text-amber-900 p-4 rounded-md border border-amber-200 w-full md:w-auto">
                    <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                    <p className="text-sm">
                        Showing products with excess stock for the next <strong>{coverageDays} days</strong> based on sales from the last <strong>{historyDays} days</strong>.
                    </p>
                </div>

                <div className="bg-white p-4 rounded-md border shadow-sm flex flex-col items-end shrink-0 w-full sm:w-auto">
                    <span className="text-sm text-muted-foreground font-medium">Total Value Tied Up</span>
                    <span className="text-2xl font-bold text-amber-600">{formatCurrency(totalOverstockValue)}</span>
                </div>
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
                                <TableHead className="text-center">1 Unit Every</TableHead>
                                <TableHead className="text-center">Predicted Demand</TableHead>
                                <TableHead className="text-right font-bold text-amber-600">Surplus Qty</TableHead>
                                <TableHead className="text-right font-bold text-amber-600">Surplus Value</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {overstockItems.map((item) => (
                                <TableRow key={item.variantId}>
                                    <TableCell className="font-medium">{item.productName}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span>{item.variantTitle}</span>
                                            <span className="text-xs text-muted-foreground">{item.sku}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Badge variant="outline">
                                            {item.currentStock}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-center text-muted-foreground">
                                        {item.salesVelocity}
                                    </TableCell>
                                    <TableCell className="text-center text-muted-foreground">
                                        {item.daysPerSale > 0 ? `${item.daysPerSale} Days` : (item.salesVelocity === 0 ? "Dead Stock" : "-")}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {item.predictedDemand} units
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100/80 text-sm px-2 py-1">
                                            +{item.surplusQuantity}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-bold text-amber-700">
                                        {formatCurrency(item.overstockValue)}
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
