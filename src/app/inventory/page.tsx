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
import { Loader2, Search, ArrowUpRight, ArrowDownRight, Package, Box, Plus } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

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

    // --- Handlers ---

    const [isRestockOpen, setIsRestockOpen] = useState(false);
    const [selectedVariant, setSelectedVariant] = useState<any>(null);
    const [restockForm, setRestockForm] = useState({
        qty: 0,
        costPrice: 0,
        supplier: "",
    });

    const openRestock = (item: any) => {
        setSelectedVariant(item);
        setRestockForm({
            qty: 0,
            costPrice: item.cost_price || 0,
            supplier: "",
        });
        setIsRestockOpen(true);
    };

    const handleRestockSubmit = async () => {
        if (!selectedVariant) return;
        if (restockForm.qty <= 0) {
            toast.error("Quantity must be greater than 0");
            return;
        }

        try {
            setLoading(true);

            // 1. Increment Stock
            const { error: rpcError } = await supabase.rpc('increment_stock', {
                row_id: selectedVariant.id,
                amount: restockForm.qty
            });
            if (rpcError) throw rpcError;

            // 2. Update Cost Price (if changed)
            if (restockForm.costPrice !== selectedVariant.cost_price) {
                await supabase.from('variants')
                    .update({ cost_price: restockForm.costPrice })
                    .eq('id', selectedVariant.id);
            }

            // 3. Log Transaction
            await supabase.from('inventory_transactions').insert({
                variant_id: selectedVariant.id,
                quantity_change: restockForm.qty,
                transaction_type: 'restock',
                reference_id: null,
                note: `Supplier: ${restockForm.supplier || 'Unknown'}`
            });

            toast.success("Stock added successfully");
            setIsRestockOpen(false);
            fetchData(); // Refresh list
        } catch (error: any) {
            console.error(error);
            toast.error("Failed to add stock");
        } finally {
            setLoading(false);
        }
    };

    const toggleTracking = async (item: any) => {
        try {
            const newValue = !item.track_inventory;
            const { error } = await supabase
                .from('variants')
                .update({ track_inventory: newValue })
                .eq('id', item.id);

            if (error) throw error;

            // Optimistic update
            setStockItems(prev => prev.map(i => i.id === item.id ? { ...i, track_inventory: newValue } : i));
            toast.success(`Inventory tracking ${newValue ? 'enabled' : 'disabled'}`);
        } catch (error) {
            toast.error("Failed to update tracking");
        }
    };

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
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredStock.map((item) => (
                                        <TableRow key={item.id}>
                                            <TableCell className="font-medium">{item.product?.name}</TableCell>
                                            <TableCell>{item.title}</TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <Switch
                                                        checked={item.track_inventory}
                                                        onCheckedChange={() => toggleTracking(item)}
                                                    />
                                                    <span className="text-xs text-muted-foreground">
                                                        {item.track_inventory ? 'On' : 'Off'}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <span className={item.stock_qty <= 0 ? "text-red-500 font-bold" : ""}>
                                                    {item.stock_qty}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right">{formatCurrency(item.cost_price)}</TableCell>
                                            <TableCell className="text-right font-bold">{formatCurrency(item.stock_qty * item.cost_price)}</TableCell>
                                            <TableCell className="text-right">
                                                <Button size="sm" variant="outline" onClick={() => openRestock(item)}>
                                                    <Plus className="h-4 w-4 mr-1" /> Add Stock
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                    <Dialog open={isRestockOpen} onOpenChange={setIsRestockOpen}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Add Stock: {selectedVariant?.product?.name} - {selectedVariant?.title}</DialogTitle>
                                <DialogDescription>
                                    Enter quantity received and supplier details.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">Quantity</Label>
                                    <Input
                                        type="number"
                                        className="col-span-3"
                                        value={restockForm.qty}
                                        onChange={(e) => setRestockForm({ ...restockForm, qty: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">Unit Cost</Label>
                                    <Input
                                        type="number"
                                        className="col-span-3"
                                        value={restockForm.costPrice}
                                        onChange={(e) => setRestockForm({ ...restockForm, costPrice: parseFloat(e.target.value) || 0 })}
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">Supplier</Label>
                                    <Input
                                        className="col-span-3"
                                        placeholder="e.g. Ali Baba, Local Market"
                                        value={restockForm.supplier}
                                        onChange={(e) => setRestockForm({ ...restockForm, supplier: e.target.value })}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleRestockSubmit}>Confirm Add Stock</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
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
