"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Search, ArrowUpRight, ArrowDownRight, Package, Box } from "lucide-react";
import { format } from "date-fns";

export default function InventoryPage() {
    const [loading, setLoading] = useState(true);
    const [stockItems, setStockItems] = useState<any[]>([]);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        fetchData();
    }, []);

    async function fetchData() {
        try {
            setLoading(true);

            // 1. Fetch Stock Levels (Variants joined with Products)
            const { data: variants, error: varError } = await supabase
                .from("variants")
                .select(`
                    id, title, stock_qty, cost_price, track_inventory,
                    product:products (name)
                `)
                .order("stock_qty", { ascending: true }); // Show low stock first

            if (varError) throw varError;
            setStockItems(variants || []);

            // 2. Fetch Recent Transactions
            const { data: trans, error: transError } = await supabase
                .from("inventory_transactions")
                .select(`
                    *,
                    variant:variants (title, product:products(name))
                `)
                .order("created_at", { ascending: false })
                .limit(50);

            if (transError) {
                // Ignore 404/missing table error initially if migration hasn't run, 
                // but generally we expect it to exist.
                console.warn("Transactions fetch error", transError);
            } else {
                setTransactions(trans || []);
            }

        } catch (error) {
            console.error("Error fetching inventory:", error);
        } finally {
            setLoading(false);
        }
    }

    // Calculations
    const filteredStock = stockItems.filter(item =>
        item.product?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.title?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const totalStockValue = filteredStock.reduce((acc, item) => acc + (item.stock_qty * item.cost_price), 0);
    const totalItems = filteredStock.reduce((acc, item) => acc + item.stock_qty, 0);
    const lowStockCount = filteredStock.filter(item => item.track_inventory && item.stock_qty <= 5).length;

    if (loading) return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Inventory Management</h1>

            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Stock Value</CardTitle>
                        <Box className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{formatCurrency(totalStockValue)}</div>
                        <p className="text-xs text-muted-foreground">{totalItems} Total Units</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Low Stock Alerts</CardTitle>
                        <ArrowDownRight className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{lowStockCount}</div>
                        <p className="text-xs text-muted-foreground">Variants with ≤ 5 units</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Recent Moves</CardTitle>
                        <Package className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{transactions.length}</div>
                        <p className="text-xs text-muted-foreground">Transactions (Last 50)</p>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="stock">
                <TabsList>
                    <TabsTrigger value="stock">Current Stock</TabsTrigger>
                    <TabsTrigger value="transactions">History Log</TabsTrigger>
                </TabsList>

                <TabsContent value="stock" className="space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search products..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-8"
                            />
                        </div>
                    </div>

                    <Card>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Product</TableHead>
                                        <TableHead>Variant</TableHead>
                                        <TableHead>Tracking</TableHead>
                                        <TableHead className="text-right">Quantity</TableHead>
                                        <TableHead className="text-right">Unit Cost</TableHead>
                                        <TableHead className="text-right">Total Value</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredStock.map((item) => (
                                        <TableRow key={item.id}>
                                            <TableCell className="font-medium">{item.product?.name}</TableCell>
                                            <TableCell>{item.title}</TableCell>
                                            <TableCell>
                                                {item.track_inventory ? (
                                                    <Badge variant="outline" className="border-green-500 text-green-600">On</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-muted-foreground">Off</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <span className={item.stock_qty <= 0 ? "text-red-500 font-bold" : ""}>
                                                    {item.stock_qty}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right">{formatCurrency(item.cost_price)}</TableCell>
                                            <TableCell className="text-right font-bold">{formatCurrency(item.stock_qty * item.cost_price)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="transactions">
                    <Card>
                        <CardHeader>
                            <CardTitle>Stock History</CardTitle>
                            <CardDescription>Recent inventory movements</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Product</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead className="text-right">Change</TableHead>
                                        <TableHead>Note</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {transactions.map((t) => (
                                        <TableRow key={t.id}>
                                            <TableCell className="whitespace-nowrap">
                                                {format(new Date(t.created_at), "MMM d, p")}
                                            </TableCell>
                                            <TableCell>
                                                <div className="font-medium">{t.variant?.product?.name}</div>
                                                <div className="text-xs text-muted-foreground">{t.variant?.title}</div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={t.transaction_type === "return" || t.transaction_type === "restock" ? "default" : "secondary"}>
                                                    {t.transaction_type}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className={cn("text-right font-bold", t.quantity_change > 0 ? "text-green-600" : "text-red-600")}>
                                                {t.quantity_change > 0 ? "+" : ""}{t.quantity_change}
                                            </TableCell>
                                            <TableCell className="max-w-[200px] truncate text-muted-foreground">
                                                {t.note || "-"}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

// Helper for dynamic class names if not imported
function cn(...classes: (string | undefined | null | false)[]) {
    return classes.filter(Boolean).join(" ");
}
