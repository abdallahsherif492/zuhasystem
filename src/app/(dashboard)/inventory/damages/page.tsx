"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { useBusiness } from "@/contexts/BusinessContext";
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
import { Button } from "@/components/ui/button";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { Loader2, Plus, AlertTriangle, FileText } from "lucide-react";

export default function DamagesPage() {
    const { activeBusiness } = useBusiness();
    const [damages, setDamages] = useState<any[]>([]);
    const [variants, setVariants] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isAddOpen, setIsAddOpen] = useState(false);
    
    const [formData, setFormData] = useState({
        variant_id: "",
        quantity: 1,
        date: format(new Date(), "yyyy-MM-dd"),
        notes: ""
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [openPopover, setOpenPopover] = useState(false);

    useEffect(() => {
        if (activeBusiness) {
            fetchData();
        }
    }, [activeBusiness]);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch variants for the dropdown
            const { data: variantsData, error: variantsError } = await supabase
                .from('variants')
                .select('id, title, cost_price, products(name)')
                .eq('business_id', activeBusiness!.id)
                .order('title');

            if (variantsError) throw variantsError;
            setVariants(variantsData || []);

            // Fetch damages
            const { data: damagesData, error: damagesError } = await supabase
                .from('inventory_damages')
                .select('*, variants(title, products(name))')
                .eq('business_id', activeBusiness!.id)
                .order('date', { ascending: false });

            if (damagesError) throw damagesError;
            setDamages(damagesData || []);

        } catch (error: any) {
            toast.error("Error fetching data: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAddDamage = async () => {
        if (!formData.variant_id) return toast.error("Select a product");
        if (formData.quantity <= 0) return toast.error("Quantity must be greater than 0");
        if (!formData.date) return toast.error("Date is required");

        setIsSubmitting(true);
        try {
            const selectedVariant = variants.find(v => v.id === formData.variant_id);
            if (!selectedVariant) throw new Error("Variant not found");

            const costAtTime = selectedVariant.cost_price;

            const { error } = await supabase
                .from('inventory_damages')
                .insert({
                    business_id: activeBusiness!.id,
                    variant_id: formData.variant_id,
                    quantity: formData.quantity,
                    cost_at_time: costAtTime,
                    date: formData.date + "T00:00:00Z",
                    notes: formData.notes
                });

            if (error) throw error;

            toast.success("Damage recorded successfully");
            setIsAddOpen(false);
            setFormData({
                variant_id: "",
                quantity: 1,
                date: format(new Date(), "yyyy-MM-dd"),
                notes: ""
            });
            fetchData();
        } catch (error: any) {
            toast.error("Failed to add damage: " + error.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const totalDamagesCount = damages.reduce((sum, d) => sum + d.quantity, 0);
    const totalDamagesCost = damages.reduce((sum, d) => sum + Number(d.total_loss), 0);

    // Group damages by variant
    const groupedDamages = damages.reduce((acc, curr) => {
        const key = curr.variant_id;
        if (!acc[key]) {
            acc[key] = {
                name: curr.variants?.products?.name,
                title: curr.variants?.title,
                total_qty: 0,
                total_loss: 0
            };
        }
        acc[key].total_qty += curr.quantity;
        acc[key].total_loss += Number(curr.total_loss);
        return acc;
    }, {} as Record<string, any>);

    return (
        <div className="flex flex-col gap-6 w-full p-4 md:p-6 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Damaged Products</h1>
                    <p className="text-muted-foreground">Track inventory losses and damaged items.</p>
                </div>
                
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogTrigger asChild>
                        <Button className="gap-2">
                            <Plus className="h-4 w-4" />
                            Record Damage
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Record Damaged Product</DialogTitle>
                            <DialogDescription>
                                This will log a financial loss but will NOT deduct from current active stock automatically.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-medium">Product / Variant</label>
                                <Popover open={openPopover} onOpenChange={setOpenPopover}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            role="combobox"
                                            aria-expanded={openPopover}
                                            className="justify-between w-full font-normal"
                                        >
                                            {formData.variant_id
                                                ? (() => {
                                                    const v = variants.find((variant) => variant.id === formData.variant_id);
                                                    return v ? `${v.products?.name} - ${v.title} (${formatCurrency(v.cost_price)})` : "Select product...";
                                                })()
                                                : "Search product..."}
                                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[400px] p-0" align="start">
                                        <Command>
                                            <CommandInput placeholder="Search by name..." />
                                            <CommandList>
                                                <CommandEmpty>No product found.</CommandEmpty>
                                                <CommandGroup>
                                                    {variants.map((v) => (
                                                        <CommandItem
                                                            key={v.id}
                                                            value={`${v.products?.name} ${v.title}`}
                                                            onSelect={() => {
                                                                setFormData({ ...formData, variant_id: v.id });
                                                                setOpenPopover(false);
                                                            }}
                                                        >
                                                            <Check
                                                                className={cn(
                                                                    "mr-2 h-4 w-4",
                                                                    formData.variant_id === v.id ? "opacity-100" : "opacity-0"
                                                                )}
                                                            />
                                                            {v.products?.name} - {v.title} ({formatCurrency(v.cost_price)})
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="flex flex-col gap-2">
                                    <label className="text-sm font-medium">Quantity Damaged</label>
                                    <Input 
                                        type="number" 
                                        min="1" 
                                        value={formData.quantity}
                                        onChange={(e) => setFormData({...formData, quantity: parseInt(e.target.value) || 0})}
                                    />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <label className="text-sm font-medium">Date</label>
                                    <Input 
                                        type="date" 
                                        value={formData.date}
                                        onChange={(e) => setFormData({...formData, date: e.target.value})}
                                    />
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-medium">Notes / Reason (Optional)</label>
                                <Input 
                                    placeholder="e.g. Broken during shipping"
                                    value={formData.notes}
                                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                            <Button onClick={handleAddDamage} disabled={isSubmitting}>
                                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
            ) : (
                <>
                    <div className="grid gap-4 md:grid-cols-2">
                        <Card className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-red-600 dark:text-red-400">Total Damaged Items</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-bold text-red-700 dark:text-red-300">
                                    {totalDamagesCount} <span className="text-lg font-normal">pcs</span>
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-red-600 dark:text-red-400">Total Financial Loss</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-bold text-red-700 dark:text-red-300">
                                    {formatCurrency(totalDamagesCost)}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-orange-500"/> Damages by Product</CardTitle>
                                <CardDescription>Aggregate losses per product</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Product</TableHead>
                                            <TableHead className="text-right">Qty</TableHead>
                                            <TableHead className="text-right">Loss</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {Object.values(groupedDamages).map((g: any, i) => (
                                            <TableRow key={i}>
                                                <TableCell className="font-medium">{g.name} - {g.title}</TableCell>
                                                <TableCell className="text-right">{g.total_qty}</TableCell>
                                                <TableCell className="text-right text-red-600 font-bold">{formatCurrency(g.total_loss)}</TableCell>
                                            </TableRow>
                                        ))}
                                        {Object.keys(groupedDamages).length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No damaged products found.</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5"/> Recent Transactions</CardTitle>
                                <CardDescription>History of logged damages</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Product</TableHead>
                                            <TableHead className="text-right">Qty</TableHead>
                                            <TableHead className="text-right">Loss</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {damages.map((d) => (
                                            <TableRow key={d.id}>
                                                <TableCell>{format(new Date(d.date), "MMM d, yyyy")}</TableCell>
                                                <TableCell>
                                                    <div className="font-medium">{d.variants?.products?.name}</div>
                                                    <div className="text-xs text-muted-foreground">{d.variants?.title}</div>
                                                    {d.notes && <div className="text-xs italic text-gray-500 mt-1">Note: {d.notes}</div>}
                                                </TableCell>
                                                <TableCell className="text-right">{d.quantity}</TableCell>
                                                <TableCell className="text-right text-red-600">{formatCurrency(d.total_loss)}</TableCell>
                                            </TableRow>
                                        ))}
                                        {damages.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">No transactions recorded.</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>
                </>
            )}
        </div>
    );
}
