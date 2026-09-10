"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
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
import { Check, ChevronsUpDown, Undo2 } from "lucide-react";
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

/**
 * What can become of damaged stock, and whether it comes back onto the shelf.
 * The default for `restock` is only a starting point — the form lets it be
 * changed, because a repaired unit is not always put back up for sale.
 */
const RESOLUTIONS: { value: string; label: string; restock: boolean }[] = [
    { value: "repaired", label: "Repaired", restock: true },
    { value: "returned_to_supplier", label: "Returned to supplier", restock: false },
    { value: "recorded_by_mistake", label: "Recorded by mistake", restock: true },
    { value: "sold_as_is", label: "Sold as-is", restock: false },
    { value: "other", label: "Other", restock: false },
];

const emptyResolve = () => ({
    variant_id: "",
    quantity: 1,
    resolution: "repaired",
    restocked: true,
    recovered_value: 0,
    date: format(new Date(), "yyyy-MM-dd"),
    notes: "",
});

export default function DamagesPage() {
    const { activeBusiness, currentUser } = useBusiness();
    const { t } = useLanguage();
    const [damages, setDamages] = useState<any[]>([]);
    const [resolutions, setResolutions] = useState<any[]>([]);
    const [resolutionsMissing, setResolutionsMissing] = useState(false);
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

    const [resolveOpen, setResolveOpen] = useState(false);
    const [resolveForm, setResolveForm] = useState(emptyResolve);
    const [resolving, setResolving] = useState(false);

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

            // Units taken back out. A missing table means the migration has not
            // run yet: the page still works, it just cannot record removals.
            const { data: resData, error: resError } = await supabase
                .from('inventory_damage_resolutions')
                .select('*, variants(title, products(name))')
                .eq('business_id', activeBusiness!.id)
                .order('date', { ascending: false });

            if (resError) {
                setResolutionsMissing(true);
                setResolutions([]);
            } else {
                setResolutionsMissing(false);
                setResolutions(resData || []);
            }

        } catch (error: any) {
            toast.error(t("Error fetching data") + ": " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAddDamage = async () => {
        if (!formData.variant_id) return toast.error(t("Select a product"));
        if (formData.quantity <= 0) return toast.error(t("Quantity must be greater than 0"));
        if (!formData.date) return toast.error(t("Date is required"));

        setIsSubmitting(true);
        try {
            const selectedVariant = variants.find(v => v.id === formData.variant_id);
            if (!selectedVariant) throw new Error(t("Variant not found"));

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

            toast.success(t("Damage recorded successfully"));
            setIsAddOpen(false);
            setFormData({
                variant_id: "",
                quantity: 1,
                date: format(new Date(), "yyyy-MM-dd"),
                notes: ""
            });
            fetchData();
        } catch (error: any) {
            toast.error(t("Failed to add damage") + ": " + error.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    /**
     * Per product: what was damaged, what has come back out, and what is left.
     *
     * `open` is what can still be removed. The database enforces the same
     * limit, so this is what the form offers rather than the only guard.
     */
    const grouped = useMemo(() => {
        const m = new Map<string, any>();
        const row = (id: string, v: any) => {
            if (!m.has(id)) m.set(id, {
                variant_id: id,
                name: v?.products?.name,
                title: v?.title,
                damaged: 0, loss: 0, removed: 0, recovered: 0,
            });
            return m.get(id);
        };
        for (const d of damages) {
            const r = row(d.variant_id, d.variants);
            r.damaged += d.quantity;
            r.loss += Number(d.total_loss) || 0;
        }
        for (const x of resolutions) {
            const r = row(x.variant_id, x.variants);
            r.removed += x.quantity;
            r.recovered += Number(x.recovered_value) || 0;
        }
        return [...m.values()].map(r => ({
            ...r,
            open: r.damaged - r.removed,
            net: r.loss - r.recovered,
            // What these units were written off at, averaged over the
            // product's damages — the figure a restock reverses.
            unitCost: r.damaged ? r.loss / r.damaged : 0,
        })).sort((a, b) => b.open - a.open || b.net - a.net);
    }, [damages, resolutions]);

    const totals = useMemo(() => ({
        damaged: grouped.reduce((a, r) => a + r.damaged, 0),
        open: grouped.reduce((a, r) => a + r.open, 0),
        loss: grouped.reduce((a, r) => a + r.loss, 0),
        recovered: grouped.reduce((a, r) => a + r.recovered, 0),
    }), [grouped]);

    /** Both kinds of event on one timeline, newest first. */
    const history = useMemo(() => [
        ...damages.map(d => ({ ...d, kind: "damage" as const })),
        ...resolutions.map(r => ({ ...r, kind: "resolution" as const })),
    ].sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
        || new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [damages, resolutions]);

    const openRows = grouped.filter(r => r.open > 0);
    const selected = grouped.find(r => r.variant_id === resolveForm.variant_id);
    const restockValue = selected ? resolveForm.quantity * selected.unitCost : 0;

    function startResolve(variantId: string) {
        const r = grouped.find(x => x.variant_id === variantId);
        setResolveForm({ ...emptyResolve(), variant_id: variantId, quantity: Math.min(1, r?.open || 1) });
        setResolveOpen(true);
    }

    function pickResolution(value: string) {
        const spec = RESOLUTIONS.find(r => r.value === value);
        setResolveForm(f => ({ ...f, resolution: value, restocked: spec?.restock ?? false }));
    }

    const handleResolve = async () => {
        if (!activeBusiness || !selected) return;
        const qty = Math.floor(Number(resolveForm.quantity) || 0);
        if (qty <= 0) return toast.error(t("Quantity must be greater than 0"));
        if (qty > selected.open) return toast.error(`${t("Still open")}: ${selected.open}`);
        if (!resolveForm.date) return toast.error(t("Date is required"));

        setResolving(true);
        try {
            const { data, error } = await supabase
                .from('inventory_damage_resolutions')
                .insert({
                    business_id: activeBusiness.id,
                    variant_id: selected.variant_id,
                    quantity: qty,
                    resolution: resolveForm.resolution,
                    restocked: resolveForm.restocked,
                    // Left to the database when restocked: it values the units
                    // at what they were actually written off at.
                    recovered_value: resolveForm.restocked ? 0 : Math.max(0, Number(resolveForm.recovered_value) || 0),
                    date: resolveForm.date + "T00:00:00Z",
                    notes: resolveForm.notes.trim() || null,
                    created_by: currentUser?.email || null,
                })
                .select('id');

            if (error) throw error;
            if (!data || data.length === 0) throw new Error(t("Failed to remove"));

            toast.success(t("Removed from damages"));
            setResolveOpen(false);
            fetchData();
        } catch (error: any) {
            // The database refuses a quantity above what is still open and
            // says how many are; that sentence is more use than a generic one.
            toast.error(t("Failed to remove") + ": " + (error?.message || ""));
        } finally {
            setResolving(false);
        }
    };

    const resolutionLabel = (v: string) => t(RESOLUTIONS.find(r => r.value === v)?.label || v);

    return (
        <div className="flex flex-col gap-6 w-full p-4 md:p-6 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t("Damaged Products")}</h1>
                    <p className="text-muted-foreground">{t("Track inventory losses and damaged items.")}</p>
                </div>

                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogTrigger asChild>
                        <Button className="gap-2">
                            <Plus className="h-4 w-4" />
                            {t("Record Damage")}
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t("Record Damaged Product")}</DialogTitle>
                            <DialogDescription>
                                {/* It used to say the stock was NOT deducted. A trigger has
                                    deducted it on every damage since 30 July, so the old
                                    text told people to take the same units off twice. */}
                                {t("This deducts the quantity from stock and records the loss.")}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-medium">{t("Product / Variant")}</label>
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
                                                    return v ? `${v.products?.name} - ${v.title} (${formatCurrency(v.cost_price)})` : t("Select product...");
                                                })()
                                                : t("Search product...")}
                                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[400px] p-0" align="start">
                                        <Command>
                                            <CommandInput placeholder={t("Search by name...")} />
                                            <CommandList>
                                                <CommandEmpty>{t("No product found.")}</CommandEmpty>
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
                                    <label className="text-sm font-medium">{t("Quantity Damaged")}</label>
                                    <Input
                                        type="number"
                                        min="1"
                                        value={formData.quantity}
                                        onChange={(e) => setFormData({...formData, quantity: parseInt(e.target.value) || 0})}
                                    />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <label className="text-sm font-medium">{t("Date")}</label>
                                    <Input
                                        type="date"
                                        value={formData.date}
                                        onChange={(e) => setFormData({...formData, date: e.target.value})}
                                    />
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-medium">{t("Notes / Reason (Optional)")}</label>
                                <Input
                                    placeholder={t("e.g. Broken during shipping")}
                                    value={formData.notes}
                                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsAddOpen(false)}>{t("Cancel")}</Button>
                            <Button onClick={handleAddDamage} disabled={isSubmitting}>
                                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Save")}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Taking units back out. One dialog for every row; the product is
                preselected from the row that opened it but can be switched to
                any other product that still has damaged units open. */}
            <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("Take units back out of the damaged pile")}</DialogTitle>
                        <DialogDescription>
                            {t("For units repaired, returned to the supplier, or recorded against the wrong product. The damage stays in the history; this records what became of it.")}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-2">
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium">{t("Product / Variant")}</label>
                            <Select
                                value={resolveForm.variant_id}
                                onValueChange={v => setResolveForm(f => ({ ...f, variant_id: v, quantity: 1 }))}
                            >
                                <SelectTrigger><SelectValue placeholder={t("Select product...")} /></SelectTrigger>
                                <SelectContent>
                                    {openRows.map(r => (
                                        <SelectItem key={r.variant_id} value={r.variant_id}>
                                            {r.name} - {r.title} ({t("Still open")}: {r.open})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-medium">{t("Quantity")}</label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={selected?.open || 1}
                                    value={resolveForm.quantity}
                                    onChange={e => setResolveForm(f => ({ ...f, quantity: parseInt(e.target.value) || 0 }))}
                                />
                                {selected && (
                                    <p className="text-xs text-muted-foreground">
                                        {t("Still open")}: {selected.open}
                                    </p>
                                )}
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-medium">{t("Date")}</label>
                                <Input
                                    type="date"
                                    value={resolveForm.date}
                                    onChange={e => setResolveForm(f => ({ ...f, date: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium">{t("Reason")}</label>
                            <Select value={resolveForm.resolution} onValueChange={pickResolution}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {RESOLUTIONS.map(r => (
                                        <SelectItem key={r.value} value={r.value}>{t(r.label)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={resolveForm.restocked}
                                onChange={e => setResolveForm(f => ({ ...f, restocked: e.target.checked }))}
                            />
                            {t("Put the units back in stock")}
                        </label>

                        {/* Back on the shelf, the whole cost came back and there is
                            nothing to type. Otherwise only what actually returned
                            counts: a supplier credit is rarely the full cost. */}
                        {resolveForm.restocked ? (
                            <div className="rounded-md border bg-emerald-500/5 border-emerald-500/30 p-3 text-sm">
                                <div className="flex justify-between gap-2">
                                    <span className="text-muted-foreground">{t("Value recovered (EGP)")}</span>
                                    <span className="font-semibold tabular-nums text-emerald-700">
                                        {formatCurrency(restockValue)}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t("Back on the shelf at the cost it was written off at, so the whole loss on these units is reversed.")}
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-medium">{t("Value recovered (EGP)")}</label>
                                <Input
                                    type="number" min={0} step="0.01"
                                    value={resolveForm.recovered_value}
                                    onChange={e => setResolveForm(f => ({ ...f, recovered_value: parseFloat(e.target.value) || 0 }))}
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t("What came back: the supplier's credit, the value of a replacement, or the discounted sale price.")}
                                    {selected && (
                                        <> {t("Cost per unit")}: {formatCurrency(selected.unitCost)}</>
                                    )}
                                </p>
                            </div>
                        )}

                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium">{t("Notes / Reason (Optional)")}</label>
                            <Input
                                value={resolveForm.notes}
                                onChange={e => setResolveForm(f => ({ ...f, notes: e.target.value }))}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setResolveOpen(false)}>{t("Cancel")}</Button>
                        <Button onClick={handleResolve} disabled={resolving || !selected}>
                            {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Save")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
            ) : (
                <>
                    {resolutionsMissing && (
                        <p className="text-sm text-muted-foreground">
                            {t("Run migration 20260910_damage_resolutions.sql to remove units from damages.")}
                        </p>
                    )}

                    <div className="grid gap-4 md:grid-cols-2">
                        <Card className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-red-600 dark:text-red-400">{t("Open damaged units")}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-bold text-red-700 dark:text-red-300">
                                    {totals.open} <span className="text-lg font-normal">{t("pcs")}</span>
                                </div>
                                {totals.damaged !== totals.open && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {t("Damaged")}: {totals.damaged} · {t("Removed")}: {totals.damaged - totals.open}
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                        <Card className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-red-600 dark:text-red-400">{t("Net financial loss")}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-bold text-red-700 dark:text-red-300">
                                    {formatCurrency(totals.loss - totals.recovered)}
                                </div>
                                {totals.recovered > 0 && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {formatCurrency(totals.loss)} − {t("Recovered")} {formatCurrency(totals.recovered)}
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-orange-500"/> {t("Damages by Product")}</CardTitle>
                                <CardDescription>{t("Aggregate losses per product")}</CardDescription>
                            </CardHeader>
                            <CardContent className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t("Product")}</TableHead>
                                            <TableHead className="text-right">{t("Damaged")}</TableHead>
                                            <TableHead className="text-right">{t("Open")}</TableHead>
                                            <TableHead className="text-right">{t("Net loss")}</TableHead>
                                            <TableHead className="w-10"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {grouped.map(g => (
                                            <TableRow key={g.variant_id} className={g.open === 0 ? "opacity-60" : undefined}>
                                                <TableCell className="font-medium">{g.name} - {g.title}</TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {g.damaged}
                                                    {g.removed > 0 && (
                                                        <span className="block text-[11px] text-emerald-600">
                                                            −{g.removed}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums font-semibold">{g.open}</TableCell>
                                                <TableCell className="text-right text-red-600 font-bold tabular-nums">{formatCurrency(g.net)}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        size="icon" variant="ghost" className="h-8 w-8"
                                                        title={t("Remove from damages")}
                                                        disabled={g.open === 0 || resolutionsMissing}
                                                        onClick={() => startResolve(g.variant_id)}
                                                    >
                                                        <Undo2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {grouped.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">{t("No damaged products found.")}</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5"/> {t("Recent Transactions")}</CardTitle>
                                <CardDescription>{t("History of logged damages")}</CardDescription>
                            </CardHeader>
                            <CardContent className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t("Date")}</TableHead>
                                            <TableHead>{t("Product")}</TableHead>
                                            <TableHead className="text-right">{t("Qty")}</TableHead>
                                            <TableHead className="text-right">{t("Loss")}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {history.map(h => h.kind === "damage" ? (
                                            <TableRow key={h.id}>
                                                <TableCell>{format(new Date(h.date), "MMM d, yyyy")}</TableCell>
                                                <TableCell>
                                                    <div className="font-medium">{h.variants?.products?.name}</div>
                                                    <div className="text-xs text-muted-foreground">{h.variants?.title}</div>
                                                    {h.notes && <div className="text-xs italic text-muted-foreground mt-1">{t("Note")}: {h.notes}</div>}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">{h.quantity}</TableCell>
                                                <TableCell className="text-right text-red-600 tabular-nums">{formatCurrency(h.total_loss)}</TableCell>
                                            </TableRow>
                                        ) : (
                                            <TableRow key={h.id} className="bg-emerald-500/5">
                                                <TableCell>{format(new Date(h.date), "MMM d, yyyy")}</TableCell>
                                                <TableCell>
                                                    <div className="font-medium">{h.variants?.products?.name}</div>
                                                    <div className="text-xs text-muted-foreground">{h.variants?.title}</div>
                                                    <div className="text-xs text-emerald-700 mt-1">
                                                        {resolutionLabel(h.resolution)}
                                                        {h.restocked && <> · {t("Put the units back in stock")}</>}
                                                    </div>
                                                    {h.notes && <div className="text-xs italic text-muted-foreground mt-1">{t("Note")}: {h.notes}</div>}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums text-emerald-700">−{h.quantity}</TableCell>
                                                <TableCell className="text-right tabular-nums text-emerald-700">
                                                    −{formatCurrency(h.recovered_value)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {history.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">{t("No transactions recorded.")}</TableCell>
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
