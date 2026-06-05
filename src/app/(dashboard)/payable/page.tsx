"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, UserPlus, FileText, CheckCircle, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { DateRangePicker } from "@/components/date-range-picker";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function PayableContent() {
    const searchParams = useSearchParams();
    const [activeTab, setActiveTab] = useState("invoices");
    const [loading, setLoading] = useState(true);

    const [suppliers, setSuppliers] = useState<any[]>([]);
    const [invoices, setInvoices] = useState<any[]>([]);

    // New Supplier State
    const [newSupplierName, setNewSupplierName] = useState("");
    const [newSupplierPhone, setNewSupplierPhone] = useState("");
    const [isSubmittingSupplier, setIsSubmittingSupplier] = useState(false);
    const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);

    // New Invoice State
    const [invoiceSupplierId, setInvoiceSupplierId] = useState("");
    const [invoiceNumber, setInvoiceNumber] = useState("");
    const [invoiceAmount, setInvoiceAmount] = useState("");
    const [isSubmittingInvoice, setIsSubmittingInvoice] = useState(false);
    const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);

    // Payment Dialog State
    const [paymentInvoice, setPaymentInvoice] = useState<any>(null); // The invoice being paid
    const [paymentStatus, setPaymentStatus] = useState<"Partially Paid" | "Fully Paid">("Partially Paid");
    const [paymentAmount, setPaymentAmount] = useState("");
    const [paymentTreasury, setPaymentTreasury] = useState("Abdallah Sherif");
    const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    async function fetchData() {
        setLoading(true);
        try {
            const [supRes, invRes] = await Promise.all([
                supabase.from("suppliers").select("*").order("name"),
                supabase.from("supplier_invoices").select("*, suppliers(name)").order("created_at", { ascending: false })
            ]);

            if (supRes.error) throw supRes.error;
            if (invRes.error) throw invRes.error;

            setSuppliers(supRes.data || []);
            setInvoices(invRes.data || []);
        } catch (error: any) {
            toast.error("Failed to load accounts payable: Make sure to run SQL migration script!");
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    // --- Actions ---

    async function handleAddSupplier() {
        if (!newSupplierName) return toast.error("Supplier name is required");

        setIsSubmittingSupplier(true);
        try {
            const { error } = await supabase.from("suppliers").insert([
                { name: newSupplierName, phone: newSupplierPhone }
            ]);
            if (error) throw error;
            toast.success("Supplier added successfully");
            setSupplierDialogOpen(false);
            setNewSupplierName("");
            setNewSupplierPhone("");
            fetchData();
        } catch (error: any) {
            toast.error(error.message || "Failed to add supplier");
        } finally {
            setIsSubmittingSupplier(false);
        }
    }

    async function handleAddInvoice() {
        if (!invoiceSupplierId || !invoiceAmount) return toast.error("Supplier and Amount are required");

        setIsSubmittingInvoice(true);
        try {
            const { error } = await supabase.from("supplier_invoices").insert([
                {
                    supplier_id: invoiceSupplierId,
                    invoice_number: invoiceNumber,
                    total_amount: Number(invoiceAmount),
                    paid_amount: 0,
                    status: "Not Paid"
                }
            ]);
            if (error) throw error;
            toast.success("Invoice created successfully");
            setInvoiceDialogOpen(false);
            setInvoiceSupplierId("");
            setInvoiceNumber("");
            setInvoiceAmount("");
            fetchData();
        } catch (error: any) {
            toast.error(error.message || "Failed to add invoice");
        } finally {
            setIsSubmittingInvoice(false);
        }
    }

    async function handlePayInvoice() {
        if (!paymentInvoice || !paymentTreasury) return toast.error("Treasury is required");
        let amountToPay = 0;
        let newPaidAmount = Number(paymentInvoice.paid_amount);

        if (paymentStatus === "Partially Paid") {
            if (!paymentAmount) return toast.error("Amount is required for partial payment");
            amountToPay = Number(paymentAmount);
            newPaidAmount += amountToPay;

            if (newPaidAmount > paymentInvoice.total_amount) {
                return toast.error("Total paid cannot exceed total invoice amount");
            }
        } else if (paymentStatus === "Fully Paid") {
            amountToPay = paymentInvoice.total_amount - paymentInvoice.paid_amount;
            newPaidAmount = paymentInvoice.total_amount;
        }

        if (amountToPay <= 0) return toast.error("No amount left to pay");

        setIsSubmittingPayment(true);
        try {
            // Determine final status
            const finalStatus = newPaidAmount >= paymentInvoice.total_amount ? "Fully Paid" : "Partially Paid";

            // 1. Update Invoice
            const { error: invError } = await supabase
                .from("supplier_invoices")
                .update({
                    paid_amount: newPaidAmount,
                    status: finalStatus
                })
                .eq("id", paymentInvoice.id);
            if (invError) throw invError;

            // 2. Create Transaction
            const supplierName = paymentInvoice.suppliers?.name || "Supplier";
            const { error: transError } = await supabase
                .from("transactions")
                .insert([
                    {
                        transaction_date: format(new Date(), "yyyy-MM-dd"),
                        amount: -Math.abs(amountToPay), // Negative for expense
                        type: "expense",
                        category: "Purchases",
                        sub_category: "Supplier Invoice",
                        account_name: paymentTreasury,
                        description: `Payment for Invoice #${paymentInvoice.invoice_number || paymentInvoice.id.slice(0, 8)} to ${supplierName}`
                    }
                ]);

            if (transError) throw transError;

            toast.success(`Payment registered and deducted from ${paymentTreasury}`);
            setPaymentInvoice(null);
            fetchData();
        } catch (error: any) {
            toast.error("Failed to process payment");
            console.error(error);
        } finally {
            setIsSubmittingPayment(false);
        }
    }

    // --- Renderers ---

    const totalDebts = invoices.reduce((sum, inv) => sum + (inv.total_amount - inv.paid_amount), 0);
    const paidDebts = invoices.reduce((sum, inv) => sum + inv.paid_amount, 0);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <h1 className="text-3xl font-bold tracking-tight">Accounts Payable</h1>
                <div className="flex gap-2">
                    {/* Placeholder for DateRangePicker if needed later, matching Insights */}
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Total Active Debts</CardTitle>
                        <FileText className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-500">{formatCurrency(totalDebts)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Outstanding unpaid amounts</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Total Paid</CardTitle>
                        <CheckCircle className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-500">{formatCurrency(paidDebts)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Amounts already settled</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Total Suppliers</CardTitle>
                        <UserPlus className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{suppliers.length}</div>
                    </CardContent>
                </Card>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="invoices">Supplier Invoices</TabsTrigger>
                    <TabsTrigger value="suppliers">Suppliers List</TabsTrigger>
                </TabsList>

                <TabsContent value="invoices" className="space-y-4">
                    <div className="flex justify-end">
                        <Dialog open={invoiceDialogOpen} onOpenChange={setInvoiceDialogOpen}>
                            <DialogTrigger asChild>
                                <Button>
                                    <Plus className="mr-2 h-4 w-4" /> Add Invoice
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Add Supplier Invoice</DialogTitle>
                                    <DialogDescription>Record a new debt from a supplier.</DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 pt-4">
                                    <div className="space-y-2">
                                        <Label>Supplier</Label>
                                        <Select value={invoiceSupplierId} onValueChange={setInvoiceSupplierId}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select supplier..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {suppliers.map(s => (
                                                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Invoice Number (Optional)</Label>
                                            <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="#INV-123" />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Total Amount (EGP)</Label>
                                            <Input type="number" value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} placeholder="0.00" />
                                        </div>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setInvoiceDialogOpen(false)}>Cancel</Button>
                                    <Button onClick={handleAddInvoice} disabled={isSubmittingInvoice}>
                                        {isSubmittingInvoice && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Save Invoice
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Invoice Records</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Supplier</TableHead>
                                        <TableHead>Inv #</TableHead>
                                        <TableHead>Total</TableHead>
                                        <TableHead>Paid</TableHead>
                                        <TableHead>Remaining</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></TableCell>
                                        </TableRow>
                                    ) : invoices.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No invoices recorded yet.</TableCell>
                                        </TableRow>
                                    ) : invoices.map(inv => {
                                        const remaining = inv.total_amount - inv.paid_amount;
                                        return (
                                            <TableRow key={inv.id}>
                                                <TableCell>{format(new Date(inv.created_at), "yyyy-MM-dd")}</TableCell>
                                                <TableCell className="font-medium">{inv.suppliers?.name}</TableCell>
                                                <TableCell>{inv.invoice_number || "-"}</TableCell>
                                                <TableCell>{formatCurrency(inv.total_amount)}</TableCell>
                                                <TableCell className="text-green-600">{formatCurrency(inv.paid_amount)}</TableCell>
                                                <TableCell className="text-red-500 font-medium">{formatCurrency(remaining)}</TableCell>
                                                <TableCell>
                                                    <Badge variant={inv.status === "Fully Paid" ? "default" : inv.status === "Partially Paid" ? "secondary" : "destructive"}>
                                                        {inv.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {inv.status !== "Fully Paid" && (
                                                        <Button size="sm" variant="outline" onClick={() => setPaymentInvoice(inv)}>
                                                            Register Payment
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="suppliers" className="space-y-4">
                    <div className="flex justify-end">
                        <Dialog open={supplierDialogOpen} onOpenChange={setSupplierDialogOpen}>
                            <DialogTrigger asChild>
                                <Button>
                                    <UserPlus className="mr-2 h-4 w-4" /> Add Supplier
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Add Supplier</DialogTitle>
                                    <DialogDescription>Add a new supplier to your directory.</DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 pt-4">
                                    <div className="space-y-2">
                                        <Label>Company / Name</Label>
                                        <Input value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)} placeholder="e.g. Al-Ahram Packaging" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Phone Number</Label>
                                        <Input value={newSupplierPhone} onChange={e => setNewSupplierPhone(e.target.value)} placeholder="01..." />
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setSupplierDialogOpen(false)}>Cancel</Button>
                                    <Button onClick={handleAddSupplier} disabled={isSubmittingSupplier}>
                                        {isSubmittingSupplier && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Save Supplier
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Suppliers Directory</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Phone</TableHead>
                                        <TableHead>Added On</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={3} className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></TableCell>
                                        </TableRow>
                                    ) : suppliers.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No suppliers created yet.</TableCell>
                                        </TableRow>
                                    ) : suppliers.map(s => (
                                        <TableRow key={s.id}>
                                            <TableCell className="font-bold">{s.name}</TableCell>
                                            <TableCell>{s.phone}</TableCell>
                                            <TableCell>{format(new Date(s.created_at), "yyyy-MM-dd")}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Payment Dialog */}
            <Dialog open={!!paymentInvoice} onOpenChange={(open) => !open && setPaymentInvoice(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Register Payment</DialogTitle>
                        <DialogDescription>
                            Paying {paymentInvoice?.suppliers?.name} for Invoice #{paymentInvoice?.invoice_number || "-"}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                        <div className="flex bg-muted p-3 rounded-md justify-between font-medium">
                            <span>Remaining Balance:</span>
                            <span className="text-red-500">{formatCurrency(paymentInvoice ? paymentInvoice.total_amount - paymentInvoice.paid_amount : 0)}</span>
                        </div>

                        <div className="space-y-2">
                            <Label>Action Type</Label>
                            <Select value={paymentStatus} onValueChange={(val: any) => setPaymentStatus(val)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Partially Paid">Pay Partial Amount</SelectItem>
                                    <SelectItem value="Fully Paid">Pay Remaining Unpaid (Close Invoice)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {paymentStatus === "Partially Paid" && (
                            <div className="space-y-2 relative">
                                <Label>Amount Paid Now</Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        value={paymentAmount}
                                        onChange={e => setPaymentAmount(e.target.value)}
                                        placeholder="0"
                                    />
                                    <span className="text-muted-foreground text-sm font-medium">EGP</span>
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>From Treasury</Label>
                            <Select value={paymentTreasury} onValueChange={setPaymentTreasury}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Abdallah Sherif">Abdallah Sherif</SelectItem>
                                    <SelectItem value="Mohamed Adel">Mohamed Adel</SelectItem>
                                    <SelectItem value="Safe">Safe</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPaymentInvoice(null)}>Cancel</Button>
                        <Button onClick={handlePayInvoice} disabled={isSubmittingPayment}>
                            {isSubmittingPayment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Process Transaction
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
