"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { formatCurrency, cn } from "@/lib/utils";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Loader2, UserPlus, FileText, Plus, ArrowLeft, Pencil, Trash2,
    TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useBusiness } from "@/contexts/BusinessContext";

type EntryType = "invoice" | "payment";

interface Balance {
    supplier_id: string;
    supplier_name: string;
    phone: string | null;
    invoiced_total: number;
    paid_total: number;
    balance: number;
    entry_count: number;
    last_entry_date: string | null;
}

interface LedgerEntry {
    id: string;
    supplier_id: string;
    entry_type: EntryType;
    entry_date: string;
    amount: number;
    description: string | null;
    reference: string | null;
    account_name: string | null;
    created_by: string | null;
    created_at: string;
}

const todayStr = () => format(new Date(), "yyyy-MM-dd");

function PayableContent() {
    const { activeBusiness, currentUser } = useBusiness();

    const [loading, setLoading] = useState(true);
    const [balances, setBalances] = useState<Balance[]>([]);
    const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
    const [suppliers, setSuppliers] = useState<any[]>([]);

    // When set, the page shows that supplier's statement instead of the list.
    const [openSupplier, setOpenSupplier] = useState<Balance | null>(null);
    const [entries, setEntries] = useState<LedgerEntry[]>([]);
    const [entriesLoading, setEntriesLoading] = useState(false);

    const [activeTab, setActiveTab] = useState("accounts");

    // --- dialogs -----------------------------------------------------------
    const [entryDialog, setEntryDialog] = useState<{
        open: boolean; type: EntryType; editing: LedgerEntry | null;
    }>({ open: false, type: "invoice", editing: null });

    const [form, setForm] = useState({
        supplierId: "", amount: "", date: todayStr(),
        reference: "", description: "", accountName: "", postToTreasury: true,
    });
    const [saving, setSaving] = useState(false);

    const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
    const [newSupplier, setNewSupplier] = useState({ name: "", phone: "" });
    const [savingSupplier, setSavingSupplier] = useState(false);

    // --- data --------------------------------------------------------------
    const load = useCallback(async () => {
        if (!activeBusiness) return;
        setLoading(true);
        try {
            const [balRes, supRes, accRes] = await Promise.all([
                supabase.rpc("get_supplier_balances", { p_business_id: activeBusiness.id }),
                supabase.from("suppliers").select("*").eq("business_id", activeBusiness.id).order("name"),
                supabase.from("financial_accounts").select("id, name")
                    .eq("business_id", activeBusiness.id).order("name"),
            ]);
            if (balRes.error) throw balRes.error;
            setBalances((balRes.data as Balance[]) || []);
            setSuppliers(supRes.data || []);
            // Treasuries used to be three names written into the source, which
            // meant every other business on the platform saw them.
            setAccounts(accRes.data?.length ? accRes.data : [{ id: "default", name: "الخزينة الرئيسية" }]);
        } catch (e: any) {
            console.error(e);
            toast.error("Failed to load payables. Run the supplier ledger migration.");
        } finally {
            setLoading(false);
        }
    }, [activeBusiness]);

    useEffect(() => { load(); }, [load]);

    const loadEntries = useCallback(async (supplierId: string) => {
        if (!activeBusiness) return;
        setEntriesLoading(true);
        const { data, error } = await supabase
            .from("supplier_ledger")
            .select("*")
            .eq("business_id", activeBusiness.id)
            .eq("supplier_id", supplierId)
            .order("entry_date", { ascending: false })
            .order("created_at", { ascending: false });
        if (error) toast.error("Failed to load the statement");
        setEntries((data as LedgerEntry[]) || []);
        setEntriesLoading(false);
    }, [activeBusiness]);

    useEffect(() => {
        if (openSupplier) loadEntries(openSupplier.supplier_id);
    }, [openSupplier, loadEntries]);

    // --- derived -----------------------------------------------------------
    const totals = useMemo(() => {
        const owed = balances.reduce((s, b) => s + Number(b.balance || 0), 0);
        return {
            owed,
            invoiced: balances.reduce((s, b) => s + Number(b.invoiced_total || 0), 0),
            paid: balances.reduce((s, b) => s + Number(b.paid_total || 0), 0),
            withBalance: balances.filter(b => Number(b.balance) > 0.005).length,
        };
    }, [balances]);

    // Oldest first, so the running balance reads the way a statement should.
    const statement = useMemo(() => {
        const asc = [...entries].sort((a, b) =>
            a.entry_date === b.entry_date
                ? a.created_at.localeCompare(b.created_at)
                : a.entry_date.localeCompare(b.entry_date));
        let running = 0;
        const withRunning = asc.map(e => {
            running += e.entry_type === "invoice" ? Number(e.amount) : -Number(e.amount);
            return { ...e, running };
        });
        return withRunning.reverse();
    }, [entries]);

    // --- actions -----------------------------------------------------------
    function openEntryDialog(type: EntryType, editing: LedgerEntry | null, supplierId?: string) {
        setForm({
            supplierId: editing?.supplier_id || supplierId || openSupplier?.supplier_id || "",
            amount: editing ? String(editing.amount) : "",
            date: editing?.entry_date || todayStr(),
            reference: editing?.reference || "",
            description: editing?.description || "",
            accountName: editing?.account_name || accounts[0]?.name || "",
            postToTreasury: !editing,
        });
        setEntryDialog({ open: true, type: editing?.entry_type || type, editing });
    }

    async function saveEntry() {
        if (!activeBusiness) return;
        const amount = Number(form.amount);
        if (!form.supplierId) return toast.error("Pick a supplier");
        if (!amount || amount <= 0) return toast.error("Amount must be greater than zero");

        setSaving(true);
        try {
            const isPayment = entryDialog.type === "payment";
            const payload: any = {
                business_id: activeBusiness.id,
                supplier_id: form.supplierId,
                entry_type: entryDialog.type,
                entry_date: form.date,
                amount,
                description: form.description.trim() || null,
                reference: form.reference.trim() || null,
                account_name: isPayment ? (form.accountName || null) : null,
                updated_at: new Date().toISOString(),
            };

            if (entryDialog.editing) {
                // The trigger records the field-level diff, so an amount being
                // corrected shows what it was and what it became.
                const { error } = await supabase
                    .from("supplier_ledger")
                    .update(payload)
                    .eq("id", entryDialog.editing.id)
                    .eq("business_id", activeBusiness.id)
                    .select("id");
                if (error) throw error;
                toast.success("Entry updated");
            } else {
                payload.created_by = currentUser?.email || "Staff";
                const { error } = await supabase.from("supplier_ledger").insert(payload).select("id");
                if (error) throw error;

                // A payment leaves a treasury, so it belongs in the books too.
                // Only on create — editing a ledger row must not silently post
                // a second expense.
                if (isPayment && form.postToTreasury) {
                    const supplierName =
                        balances.find(b => b.supplier_id === form.supplierId)?.supplier_name || "Supplier";
                    const { error: txError } = await supabase.from("transactions").insert({
                        business_id: activeBusiness.id,
                        transaction_date: form.date,
                        amount: -Math.abs(amount),
                        type: "expense",
                        category: "Purchases",
                        sub_category: "Supplier Payment",
                        account_name: form.accountName,
                        description: `Payment to ${supplierName}${form.reference ? ` (#${form.reference})` : ""}`,
                    });
                    if (txError) throw txError;
                }
                toast.success(isPayment ? "Payment recorded" : "Invoice recorded");
            }

            setEntryDialog({ open: false, type: "invoice", editing: null });
            await load();
            if (openSupplier) loadEntries(openSupplier.supplier_id);
        } catch (e: any) {
            toast.error(e.message || "Failed to save");
        } finally {
            setSaving(false);
        }
    }

    async function deleteEntry(entry: LedgerEntry) {
        if (!activeBusiness) return;
        if (!confirm(`Delete this ${entry.entry_type} of ${formatCurrency(Number(entry.amount))}? The balance will change.`)) return;
        const { error } = await supabase
            .from("supplier_ledger").delete()
            .eq("id", entry.id).eq("business_id", activeBusiness.id);
        if (error) return toast.error("Failed to delete");
        toast.success("Entry deleted");
        await load();
        if (openSupplier) loadEntries(openSupplier.supplier_id);
    }

    async function addSupplier() {
        if (!activeBusiness || !newSupplier.name.trim()) return toast.error("Name is required");
        setSavingSupplier(true);
        try {
            const { error } = await supabase.from("suppliers").insert({
                business_id: activeBusiness.id,
                name: newSupplier.name.trim(),
                phone: newSupplier.phone.trim() || null,
            });
            if (error) throw error;
            toast.success("Supplier added");
            setSupplierDialogOpen(false);
            setNewSupplier({ name: "", phone: "" });
            load();
        } catch (e: any) {
            toast.error(e.message || "Failed to add supplier");
        } finally {
            setSavingSupplier(false);
        }
    }

    // --- render ------------------------------------------------------------
    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    }

    const supplierName = (id: string) =>
        balances.find(b => b.supplier_id === id)?.supplier_name || "—";

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Accounts Payable</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Every supplier is an account. Invoices add to what you owe, payments reduce it.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => openEntryDialog("payment", null)}>
                        <TrendingDown className="h-4 w-4 mr-2" /> Record Payment
                    </Button>
                    <Button onClick={() => openEntryDialog("invoice", null)}>
                        <Plus className="h-4 w-4 mr-2" /> New Invoice
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
                <Card className="border-red-500/20 bg-gradient-to-br from-red-500/10 to-transparent">
                    <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                        <CardTitle className="text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-300">
                            Total Owed
                        </CardTitle>
                        <Wallet className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black text-red-700 dark:text-red-300">
                            {formatCurrency(totals.owed)}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                            across {totals.withBalance} supplier{totals.withBalance === 1 ? "" : "s"}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Invoiced</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold">{formatCurrency(totals.invoiced)}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Paid</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold text-emerald-600">{formatCurrency(totals.paid)}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Suppliers</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold">{balances.length}</div></CardContent>
                </Card>
            </div>

            {openSupplier ? (
                <Card>
                    <CardHeader>
                        <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1">
                                <Button variant="ghost" size="sm" className="-ml-2 h-7 text-xs gap-1"
                                        onClick={() => setOpenSupplier(null)}>
                                    <ArrowLeft className="h-3.5 w-3.5" /> All accounts
                                </Button>
                                <CardTitle>{openSupplier.supplier_name}</CardTitle>
                                <CardDescription>
                                    {openSupplier.phone || "No phone"} · statement, oldest first
                                </CardDescription>
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Balance</p>
                                <p className={cn("text-2xl font-black",
                                    Number(openSupplier.balance) > 0.005 ? "text-red-600" : "text-emerald-600")}>
                                    {formatCurrency(Number(openSupplier.balance))}
                                </p>
                                <div className="flex gap-2 mt-2">
                                    <Button size="sm" variant="outline"
                                            onClick={() => openEntryDialog("payment", null, openSupplier.supplier_id)}>
                                        Pay
                                    </Button>
                                    <Button size="sm"
                                            onClick={() => openEntryDialog("invoice", null, openSupplier.supplier_id)}>
                                        Invoice
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {entriesLoading ? (
                            <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead className="hidden md:table-cell">Ref</TableHead>
                                        <TableHead className="hidden lg:table-cell">Description</TableHead>
                                        <TableHead className="text-right">Invoiced</TableHead>
                                        <TableHead className="text-right">Paid</TableHead>
                                        <TableHead className="text-right">Balance</TableHead>
                                        <TableHead className="w-[90px]" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {statement.length === 0 ? (
                                        <TableRow><TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">
                                            No movements on this account yet.
                                        </TableCell></TableRow>
                                    ) : statement.map(e => (
                                        <TableRow key={e.id}>
                                            <TableCell className="whitespace-nowrap">{e.entry_date}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={e.entry_type === "invoice"
                                                    ? "bg-red-500/10 text-red-600 border-red-500/20"
                                                    : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"}>
                                                    {e.entry_type === "invoice" ? "Invoice" : "Payment"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="hidden md:table-cell font-mono text-xs">{e.reference || "—"}</TableCell>
                                            <TableCell className="hidden lg:table-cell max-w-[260px]">
                                                <span className="text-xs text-muted-foreground line-clamp-2">
                                                    {e.description || "—"}
                                                </span>
                                                {e.account_name && (
                                                    <span className="block text-[10px] text-muted-foreground mt-0.5">
                                                        from {e.account_name}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {e.entry_type === "invoice" ? formatCurrency(Number(e.amount)) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right text-emerald-600">
                                                {e.entry_type === "payment" ? formatCurrency(Number(e.amount)) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right font-semibold tabular-nums">
                                                {formatCurrency(e.running)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button size="icon" variant="ghost" className="h-7 w-7"
                                                        onClick={() => openEntryDialog(e.entry_type, e)}>
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500"
                                                        onClick={() => deleteEntry(e)}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                    <TabsList>
                        <TabsTrigger value="accounts">Supplier Accounts</TabsTrigger>
                        <TabsTrigger value="suppliers">Manage Suppliers</TabsTrigger>
                    </TabsList>

                    <TabsContent value="accounts">
                        <Card>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Supplier</TableHead>
                                            <TableHead className="text-right">Invoiced</TableHead>
                                            <TableHead className="text-right">Paid</TableHead>
                                            <TableHead className="text-right">Balance</TableHead>
                                            <TableHead className="hidden md:table-cell text-right">Last movement</TableHead>
                                            <TableHead className="w-[120px]" />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {balances.length === 0 ? (
                                            <TableRow><TableCell colSpan={6} className="text-center py-10 text-sm text-muted-foreground">
                                                No suppliers yet.
                                            </TableCell></TableRow>
                                        ) : balances.map(b => (
                                            <TableRow key={b.supplier_id} className="cursor-pointer hover:bg-muted/40"
                                                      onClick={() => setOpenSupplier(b)}>
                                                <TableCell className="font-medium">
                                                    {b.supplier_name}
                                                    <span className="block text-xs text-muted-foreground">
                                                        {b.entry_count} movement{Number(b.entry_count) === 1 ? "" : "s"}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right">{formatCurrency(Number(b.invoiced_total))}</TableCell>
                                                <TableCell className="text-right text-emerald-600">{formatCurrency(Number(b.paid_total))}</TableCell>
                                                <TableCell className={cn("text-right font-bold tabular-nums",
                                                    Number(b.balance) > 0.005 ? "text-red-600"
                                                        : Number(b.balance) < -0.005 ? "text-amber-600" : "text-muted-foreground")}>
                                                    {formatCurrency(Number(b.balance))}
                                                    {Number(b.balance) < -0.005 && (
                                                        <span className="block text-[10px] font-normal">overpaid</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell text-right text-xs text-muted-foreground">
                                                    {b.last_entry_date || "—"}
                                                </TableCell>
                                                <TableCell className="text-right" onClick={ev => ev.stopPropagation()}>
                                                    <Button size="sm" variant="outline"
                                                            onClick={() => openEntryDialog("payment", null, b.supplier_id)}>
                                                        Pay
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="suppliers" className="space-y-4">
                        <div className="flex justify-end">
                            <Dialog open={supplierDialogOpen} onOpenChange={setSupplierDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="outline"><UserPlus className="h-4 w-4 mr-2" /> Add Supplier</Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader><DialogTitle>Add Supplier</DialogTitle></DialogHeader>
                                    <div className="space-y-4 py-2">
                                        <div className="space-y-2">
                                            <Label>Company / Name</Label>
                                            <Input value={newSupplier.name}
                                                   onChange={e => setNewSupplier({ ...newSupplier, name: e.target.value })}
                                                   placeholder="e.g. Al-Ahram Packaging" />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Phone Number</Label>
                                            <Input value={newSupplier.phone}
                                                   onChange={e => setNewSupplier({ ...newSupplier, phone: e.target.value })}
                                                   placeholder="01..." />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setSupplierDialogOpen(false)}>Cancel</Button>
                                        <Button onClick={addSupplier} disabled={savingSupplier}>
                                            {savingSupplier && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                        <Card>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Name</TableHead>
                                            <TableHead>Phone</TableHead>
                                            <TableHead className="text-right">Balance</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {suppliers.map(s => {
                                            const bal = balances.find(b => b.supplier_id === s.id);
                                            return (
                                                <TableRow key={s.id}>
                                                    <TableCell className="font-medium">{s.name}</TableCell>
                                                    <TableCell>{s.phone || "—"}</TableCell>
                                                    <TableCell className="text-right font-semibold">
                                                        {formatCurrency(Number(bal?.balance || 0))}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            )}

            {/* Invoice / payment dialog — one form, since the two differ only in
                direction and whether a treasury is involved. */}
            <Dialog open={entryDialog.open}
                    onOpenChange={(o) => !o && setEntryDialog({ open: false, type: "invoice", editing: null })}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {entryDialog.editing ? "Edit " : ""}
                            {entryDialog.type === "invoice" ? "Purchase Invoice" : "Payment"}
                        </DialogTitle>
                        <DialogDescription>
                            {entryDialog.type === "invoice"
                                ? "What you bought from this supplier. Adds to what you owe them."
                                : "What you paid this supplier. Reduces what you owe them."}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Supplier</Label>
                            <Select value={form.supplierId}
                                    onValueChange={v => setForm({ ...form, supplierId: v })}
                                    disabled={!!entryDialog.editing}>
                                <SelectTrigger><SelectValue placeholder="Select supplier..." /></SelectTrigger>
                                <SelectContent>
                                    {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Amount (EGP)</Label>
                                <Input type="number" value={form.amount}
                                       onChange={e => setForm({ ...form, amount: e.target.value })}
                                       placeholder="0.00" />
                            </div>
                            <div className="space-y-2">
                                <Label>Date</Label>
                                <Input type="date" value={form.date}
                                       onChange={e => setForm({ ...form, date: e.target.value })} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>{entryDialog.type === "invoice" ? "Invoice Number" : "Reference"} (optional)</Label>
                            <Input value={form.reference}
                                   onChange={e => setForm({ ...form, reference: e.target.value })}
                                   placeholder={entryDialog.type === "invoice" ? "#INV-123" : "transfer ref"} />
                        </div>

                        <div className="space-y-2">
                            <Label>Description (optional)</Label>
                            <Textarea rows={2} value={form.description}
                                      onChange={e => setForm({ ...form, description: e.target.value })}
                                      placeholder="What this covers" />
                        </div>

                        {entryDialog.type === "payment" && (
                            <>
                                <div className="space-y-2">
                                    <Label>From Treasury</Label>
                                    <Select value={form.accountName}
                                            onValueChange={v => setForm({ ...form, accountName: v })}>
                                        <SelectTrigger><SelectValue placeholder="Select treasury" /></SelectTrigger>
                                        <SelectContent>
                                            {accounts.map(a => <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                {!entryDialog.editing && (
                                    <div className="flex items-start space-x-2">
                                        <Checkbox checked={form.postToTreasury}
                                                  onCheckedChange={c => setForm({ ...form, postToTreasury: !!c })} />
                                        <div className="grid gap-1 leading-none">
                                            <Label className="text-sm">Also record it as an expense</Label>
                                            <p className="text-xs text-muted-foreground">
                                                Deducts from the treasury in accounting. Leave off if you
                                                already entered it there.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {entryDialog.editing && (
                            <p className="text-xs text-muted-foreground border-t pt-3">
                                The change is recorded in the actions log with the old and new values.
                                {entryDialog.editing.entry_type === "payment" &&
                                    " Editing here does not change any expense already posted to accounting."}
                            </p>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline"
                                onClick={() => setEntryDialog({ open: false, type: "invoice", editing: null })}>
                            Cancel
                        </Button>
                        <Button onClick={saveEntry} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {entryDialog.editing ? "Save changes" : "Record"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function PayablePage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <PayableContent />
        </Suspense>
    );
}
