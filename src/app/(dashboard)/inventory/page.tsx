"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatCurrency, normalizeSearchText } from "@/lib/utils";
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
import { Loader2, Search, ArrowUpRight, ArrowDownRight, Package, Box, Plus, Edit, AlertTriangle } from "lucide-react";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useBusiness } from "@/contexts/BusinessContext";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { useLanguage } from "@/contexts/LanguageContext";

export default function InventoryPage() {
    const { activeBusiness, currentUser } = useBusiness();
    const { t } = useLanguage();
    const [loading, setLoading] = useState(true);
    const [stockItems, setStockItems] = useState<any[]>([]);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState("stock_asc");
    const [stockFilter, setStockFilter] = useState("all");

    useEffect(() => {
        fetchData();
    }, [activeBusiness]);

    async function fetchData() {
        if (!activeBusiness) return;
        try {
            setLoading(true);

            // 1. Fetch Stock Levels (Variants joined with Products)
            const { data: variants, error: varError } = await supabase
                .from("variants")
                .select(`
                    id, title, stock_qty, cost_price, track_inventory,
                    product:products!inner (name, business_id)
                `)
                .eq('products.business_id', activeBusiness.id)
                .order("stock_qty", { ascending: true }); // Show low stock first

            if (varError) throw varError;
            setStockItems(variants || []);

            // 2. Fetch Recent Transactions
            const { data: trans, error: transError } = await supabase
                .from("inventory_transactions")
                .select(`
                    *,
                    variant:variants!inner (title, product:products!inner(name, business_id))
                `)
                .eq('variants.products.business_id', activeBusiness.id)
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
        type: "add", // add, reduce, set
        qty: 0,
        costPrice: 0,
        supplier: "",
    });

    const openRestock = (item: any) => {
        setSelectedVariant(item);
        setRestockForm({
            type: "add",
            qty: 0,
            costPrice: item.cost_price || 0,
            supplier: "",
        });
        setIsRestockOpen(true);
    };

    const handleRestockSubmit = async () => {
        if (!selectedVariant) return;
        if (restockForm.type !== 'set' && restockForm.qty <= 0) {
            toast.error("Quantity must be greater than 0");
            return;
        }
        if (restockForm.type === 'set' && restockForm.qty < 0) {
            toast.error("Quantity cannot be negative");
            return;
        }

        try {
            setLoading(true);

            let changeAmount = 0;
            let transactionType = 'manual_adjustment';

            // Calculate Change
            if (restockForm.type === 'add') {
                changeAmount = restockForm.qty;
                transactionType = 'restock';
            } else if (restockForm.type === 'reduce') {
                changeAmount = -restockForm.qty;
                transactionType = 'manual_deduction';
            } else if (restockForm.type === 'set') {
                changeAmount = restockForm.qty - selectedVariant.stock_qty;
                transactionType = 'manual_set';
            }

            if (changeAmount === 0 && restockForm.type === 'set') {
                toast.info("No change in quantity");
                setIsRestockOpen(false);
                return;
            }

            // 1. Update Stock
            if (changeAmount > 0) {
                const { error } = await supabase.rpc('increment_stock', {
                    row_id: selectedVariant.id,
                    amount: changeAmount
                });
                if (error) throw error;
            } else if (changeAmount < 0) {
                const { error } = await supabase.rpc('decrement_stock', {
                    row_id: selectedVariant.id,
                    amount: Math.abs(changeAmount)
                });
                if (error) throw error;
            }

            // 2. Update Cost Price (if changed & adding/setting)
            if (restockForm.costPrice !== selectedVariant.cost_price && restockForm.type !== 'reduce') {
                await supabase.from('variants')
                    .update({ cost_price: restockForm.costPrice })
                    .eq('id', selectedVariant.id);
            }

            // 3. Log Transaction — the error must be checked. This insert
            //    silently failed for months (it referenced a business_id column
            //    that did not exist), so the counter moved while the audit
            //    ledger recorded nothing, which is what let stock drift unseen.
            const { error: logError } = await supabase.from('inventory_transactions').insert({
                business_id: activeBusiness!.id,
                variant_id: selectedVariant.id,
                quantity_change: changeAmount,
                transaction_type: transactionType,
                reference_id: null,
                note: `Action: ${restockForm.type}. Note: ${restockForm.supplier || 'N/A'}`
            });
            if (logError) throw logError;

            // Also to the actions log. inventory_transactions is the stock
            // ledger and answers "how did this number get here"; the actions
            // log answers "who touched what today", and a manual recount is
            // exactly the kind of thing someone goes looking for there. No
            // trigger does this for us — variants move on every order status
            // change, so auditing that table would bury everything else.
            logBusinessAction({
                businessId: activeBusiness!.id,
                userEmail: currentUser?.email || "Staff",
                actionType: "stock_adjust",
                entityType: "inventory",
                entityId: selectedVariant.id,
                entityName: `${selectedVariant.product?.name || "Product"} — ${selectedVariant.title || ""}`.trim(),
                changes: [
                    {
                        field: "Stock",
                        old_value: selectedVariant.stock_qty,
                        new_value: selectedVariant.stock_qty + changeAmount,
                    },
                    // The same dialog can change the unit cost, which moves the
                    // value of everything already on the shelf. Recorded only
                    // when it actually moved.
                    ...(restockForm.costPrice !== selectedVariant.cost_price && restockForm.type !== 'reduce'
                        ? [{
                            field: "Unit cost",
                            old_value: `${selectedVariant.cost_price ?? 0} EGP`,
                            new_value: `${restockForm.costPrice} EGP`,
                        }]
                        : []),
                ],
                metadata: {
                    adjustment: restockForm.type,
                    change: changeAmount,
                    note: restockForm.supplier || null,
                },
            });

            toast.success("Stock updated successfully");
            setIsRestockOpen(false);
            fetchData(); // Refresh list
        } catch (error: any) {
            console.error(error);
            toast.error("Failed to update stock");
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

            // Turning tracking off stops stock moving on this variant at all,
            // which is exactly the kind of change someone later cannot explain.
            logBusinessAction({
                businessId: activeBusiness!.id,
                userEmail: currentUser?.email || "Staff",
                actionType: "edit",
                entityType: "inventory",
                entityId: item.id,
                entityName: `${item.product?.name || "Product"} — ${item.title || ""}`.trim(),
                changes: [{ field: "Track inventory", old_value: !newValue, new_value: newValue }],
            });

            toast.success(`Inventory tracking ${newValue ? 'enabled' : 'disabled'}`);
        } catch (error) {
            toast.error("Failed to update tracking");
        }
    };

    // Search folds Arabic the way people type it — without this, "احمر" never
    // finds "أحمر" and the box looks broken on a product that plainly exists.
    const filteredStock = (() => {
        const q = normalizeSearchText(searchQuery);
        let rows = stockItems.filter(item => {
            if (q) {
                const hay = normalizeSearchText(
                    `${item.product?.name || ""} ${item.title || ""} ${item.sku || ""}`);
                if (!hay.includes(q)) return false;
            }
            const qty = Number(item.stock_qty) || 0;
            if (stockFilter === "out") return qty <= 0;
            if (stockFilter === "low") return item.track_inventory && qty > 0 && qty <= 5;
            if (stockFilter === "in") return qty > 0;
            if (stockFilter === "untracked") return !item.track_inventory;
            return true;
        });

        const name = (i: any) => `${i.product?.name || ""} ${i.title || ""}`.trim();
        const value = (i: any) => (Number(i.stock_qty) || 0) * (Number(i.cost_price) || 0);
        const cmp: Record<string, (a: any, b: any) => number> = {
            stock_asc:  (a, b) => (a.stock_qty || 0) - (b.stock_qty || 0),
            stock_desc: (a, b) => (b.stock_qty || 0) - (a.stock_qty || 0),
            name_asc:   (a, b) => name(a).localeCompare(name(b), "ar"),
            name_desc:  (a, b) => name(b).localeCompare(name(a), "ar"),
            value_desc: (a, b) => value(b) - value(a),
            value_asc:  (a, b) => value(a) - value(b),
            cost_desc:  (a, b) => (b.cost_price || 0) - (a.cost_price || 0),
            cost_asc:   (a, b) => (a.cost_price || 0) - (b.cost_price || 0),
        };
        return [...rows].sort(cmp[sortBy] || cmp.stock_asc);
    })();

    const totalStockValue = filteredStock.reduce((acc, item) => acc + (item.stock_qty * item.cost_price), 0);
    const totalItems = filteredStock.reduce((acc, item) => acc + item.stock_qty, 0);
    const lowStockCount = filteredStock.filter(item => item.track_inventory && item.stock_qty <= 5).length;

    if (loading) return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">{t("Inventory")}</h1>

            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t("Total Stock Value")}</CardTitle>
                        <Box className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{formatCurrency(totalStockValue)}</div>
                        <p className="text-xs text-muted-foreground">{totalItems} {t("Total Units")}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t("Low Stock Alerts")}</CardTitle>
                        <ArrowDownRight className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{lowStockCount}</div>
                        <p className="text-xs text-muted-foreground">{t("Variants with ≤ 5 units")}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t("Recent Moves")}</CardTitle>
                        <Package className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{transactions.length}</div>
                        <p className="text-xs text-muted-foreground">{t("Transactions (Last 50)")}</p>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="stock">
                <TabsList>
                    <TabsTrigger value="stock">{t("Current Stock")}</TabsTrigger>
                    <TabsTrigger value="transactions">{t("History Log")}</TabsTrigger>
                </TabsList>

                <TabsContent value="stock" className="space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder={t("Search products...")}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-8"
                            />
                        </div>

                        <Select value={stockFilter} onValueChange={setStockFilter}>
                            <SelectTrigger className="w-[170px]">
                                <SelectValue placeholder={t("Show")} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t("All variants")}</SelectItem>
                                <SelectItem value="in">{t("In stock")}</SelectItem>
                                <SelectItem value="low">{t("Low stock (5 or less)")}</SelectItem>
                                <SelectItem value="out">{t("Out of stock")}</SelectItem>
                                <SelectItem value="untracked">{t("Not tracked")}</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={sortBy} onValueChange={setSortBy}>
                            <SelectTrigger className="w-[190px]">
                                <SelectValue placeholder={t("Sort by")} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="stock_asc">{t("Quantity: low to high")}</SelectItem>
                                <SelectItem value="stock_desc">{t("Quantity: high to low")}</SelectItem>
                                <SelectItem value="value_desc">{t("Stock value: high to low")}</SelectItem>
                                <SelectItem value="value_asc">{t("Stock value: low to high")}</SelectItem>
                                <SelectItem value="cost_desc">{t("Unit cost: high to low")}</SelectItem>
                                <SelectItem value="cost_asc">{t("Unit cost: low to high")}</SelectItem>
                                <SelectItem value="name_asc">{t("Name: A to Z")}</SelectItem>
                                <SelectItem value="name_desc">{t("Name: Z to A")}</SelectItem>
                            </SelectContent>
                        </Select>

                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {filteredStock.length} / {stockItems.length}
                        </span>
                    </div>

                    <Card>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t("Product")}</TableHead>
                                        <TableHead>{t("Variant")}</TableHead>
                                        <TableHead>{t("Tracking")}</TableHead>
                                        <TableHead className="text-right">{t("Quantity")}</TableHead>
                                        <TableHead className="text-right">{t("Unit Cost")}</TableHead>
                                        <TableHead className="text-right">{t("Total Value")}</TableHead>
                                        <TableHead className="text-right">{t("Actions")}</TableHead>
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
                                                    <Edit className="h-4 w-4 mr-1" /> {t("Adjust")}
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
                                <DialogTitle>Adjust Stock: {selectedVariant?.product?.name} - {selectedVariant?.title}</DialogTitle>
                                <DialogDescription>
                                    Enter quantity received and supplier details.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">Action</Label>
                                    <Select
                                        value={restockForm.type}
                                        onValueChange={(v) => setRestockForm({ ...restockForm, type: v })}
                                    >
                                        <SelectTrigger className="col-span-3">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="add">Add Stock (+)</SelectItem>
                                            <SelectItem value="reduce">Remove Stock (-)</SelectItem>
                                            <SelectItem value="set">Set Exact Quantity (=)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">
                                        {restockForm.type === 'set' ? 'New Quantity' : 'Quantity'}
                                    </Label>
                                    <Input
                                        type="number"
                                        className="col-span-3"
                                        value={restockForm.qty}
                                        onChange={(e) => setRestockForm({ ...restockForm, qty: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                                {restockForm.type !== 'reduce' && (
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label className="text-right">Unit Cost</Label>
                                        <Input
                                            type="number"
                                            className="col-span-3"
                                            value={restockForm.costPrice}
                                            onChange={(e) => setRestockForm({ ...restockForm, costPrice: parseFloat(e.target.value) || 0 })}
                                        />
                                    </div>
                                )}
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">Note/Reason</Label>
                                    <Input
                                        className="col-span-3"
                                        placeholder={restockForm.type === 'add' ? "Supplier Name" : "Reason for adjustment"}
                                        value={restockForm.supplier}
                                        onChange={(e) => setRestockForm({ ...restockForm, supplier: e.target.value })}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleRestockSubmit}>Confirm Update</Button>
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
                                        <TableHead>{t("Date")}</TableHead>
                                        <TableHead>{t("Product")}</TableHead>
                                        <TableHead>{t("Type")}</TableHead>
                                        <TableHead className="text-right">{t("Change")}</TableHead>
                                        <TableHead>{t("Note")}</TableHead>
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
