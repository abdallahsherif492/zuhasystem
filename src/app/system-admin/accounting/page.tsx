"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Banknote, CalendarCheck, FileText, CheckCircle, XCircle, Download, ExternalLink, Activity } from "lucide-react";
import Image from "next/image";
import { logAuditAction } from "@/lib/audit";

type Transaction = {
    id: string;
    type: "revenue" | "expense";
    amount: number;
    status: string;
    category: string;
    description: string;
    proof_url: string | null;
    created_at: string;
    business_id: string | null;
    business?: {
        name: string;
    };
};

export default function PlatformAccounting() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState<"all" | "revenue" | "expense">("all");
    
    // Expense form
    const [isExpenseOpen, setIsExpenseOpen] = useState(false);
    const [expAmount, setExpAmount] = useState("");
    const [expCategory, setExpCategory] = useState("Hosting/Servers");
    const [expDesc, setExpDesc] = useState("");
    
    // Revenue form
    const [isRevenueOpen, setIsRevenueOpen] = useState(false);
    const [revAmount, setRevAmount] = useState("");
    const [revCategory, setRevCategory] = useState("Manual Addition");
    const [revDesc, setRevDesc] = useState("");
    
    const [submitting, setSubmitting] = useState(false);

    const fetchTransactions = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("platform_transactions")
            .select(`
                *,
                business:businesses(name)
            `)
            .order("created_at", { ascending: false });

        if (!error && data) {
            setTransactions(data as Transaction[]);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchTransactions();
    }, []);

    const handleAddExpense = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        const { error } = await supabase.from("platform_transactions").insert({
            type: "expense",
            amount: parseFloat(expAmount),
            status: "paid",
            category: expCategory,
            description: expDesc
        });

        setSubmitting(false);
        if (!error) {
            setIsExpenseOpen(false);
            setExpAmount("");
            setExpDesc("");
            fetchTransactions();
        } else {
            alert("Error: " + error.message);
        }
    };

    const handleAddRevenue = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        const { error } = await supabase.from("platform_transactions").insert({
            type: "revenue",
            amount: parseFloat(revAmount),
            status: "approved",
            category: revCategory,
            description: revDesc
        });

        setSubmitting(false);
        if (!error) {
            setIsRevenueOpen(false);
            setRevAmount("");
            setRevDesc("");
            fetchTransactions();
        } else {
            alert("Error: " + error.message);
        }
    };

    const handleApprove = async (tx: Transaction) => {
        const { error } = await supabase
            .from("platform_transactions")
            .update({ status: "approved" })
            .eq("id", tx.id);
            
        if (!error && tx.business_id) {
            // Activate business
            await supabase
                .from("businesses")
                .update({ subscription_status: "active" })
                .eq("id", tx.business_id);
            
            await logAuditAction("PAYMENT_APPROVED", "Business", tx.business_id, {
                transaction_id: tx.id,
                amount: tx.amount
            });
            fetchTransactions();
        }
    };

    const handleReject = async (tx: Transaction) => {
        const { error } = await supabase
            .from("platform_transactions")
            .update({ status: "rejected" })
            .eq("id", tx.id);
        if (!error) {
            await logAuditAction("PAYMENT_REJECTED", "Business", tx.business_id || "unknown", {
                transaction_id: tx.id,
                amount: tx.amount
            });
            fetchTransactions();
        }
    };

    // Calculate metrics
    const totalRevenue = transactions.filter(t => t.type === "revenue" && t.status === "approved").reduce((sum, t) => sum + Number(t.amount), 0);
    const totalExpenses = transactions.filter(t => t.type === "expense").reduce((sum, t) => sum + Number(t.amount), 0);
    const pendingRequests = transactions.filter(t => t.type === "revenue" && t.status === "pending");

    const filteredTransactions = transactions.filter(t => filterType === "all" || t.type === filterType);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Accounting</h1>
                    <p className="text-muted-foreground">Track platform revenue, expenses, and payment requests.</p>
                </div>
                <div className="flex gap-2">
                    <Dialog open={isRevenueOpen} onOpenChange={setIsRevenueOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" className="text-green-600 border-green-200 hover:bg-green-50">
                                Add Revenue
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Log Manual Revenue</DialogTitle>
                                <DialogDescription>Record revenue that came outside the system directly.</DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleAddRevenue} className="space-y-4 pt-4">
                                <div className="grid gap-2">
                                    <Label>Category</Label>
                                    <Input value={revCategory} onChange={e => setRevCategory(e.target.value)} required />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Amount (EGP)</Label>
                                    <Input type="number" step="0.01" value={revAmount} onChange={e => setRevAmount(e.target.value)} required />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Description</Label>
                                    <Input value={revDesc} onChange={e => setRevDesc(e.target.value)} placeholder="e.g. Cash payment from client X" required />
                                </div>
                                <DialogFooter>
                                    <Button type="button" variant="outline" onClick={() => setIsRevenueOpen(false)}>Cancel</Button>
                                    <Button type="submit" disabled={submitting}>
                                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Save Revenue
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>

                    <Dialog open={isExpenseOpen} onOpenChange={setIsExpenseOpen}>
                        <DialogTrigger asChild>
                            <Button variant="destructive">
                                Add Expense
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Log an Expense</DialogTitle>
                                <DialogDescription>Record server costs, payroll, or marketing expenses.</DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleAddExpense} className="space-y-4 pt-4">
                                <div className="grid gap-2">
                                    <Label>Category</Label>
                                    <Select value={expCategory} onValueChange={setExpCategory}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Hosting/Servers">Hosting / Servers</SelectItem>
                                            <SelectItem value="Marketing/Ads">Marketing / Ads</SelectItem>
                                            <SelectItem value="Payroll">Payroll</SelectItem>
                                            <SelectItem value="Software/Tools">Software / Tools</SelectItem>
                                            <SelectItem value="Miscellaneous">Miscellaneous</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label>Amount (EGP)</Label>
                                    <Input type="number" step="0.01" value={expAmount} onChange={e => setExpAmount(e.target.value)} required />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Description</Label>
                                    <Input value={expDesc} onChange={e => setExpDesc(e.target.value)} placeholder="e.g. Vercel Hosting Invoice" required />
                                </div>
                                <DialogFooter>
                                    <Button type="button" variant="outline" onClick={() => setIsExpenseOpen(false)}>Cancel</Button>
                                    <Button type="submit" disabled={submitting}>
                                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Save Expense
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-green-500/10 border-green-500/20">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-green-700">
                            <Banknote className="h-4 w-4" /> Total Revenue
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-green-700">{totalRevenue.toFixed(2)} EGP</div>
                    </CardContent>
                </Card>
                <Card className="bg-red-500/10 border-red-500/20">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-red-700">
                            <FileText className="h-4 w-4" /> Total Expenses
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-red-700">{totalExpenses.toFixed(2)} EGP</div>
                    </CardContent>
                </Card>
                <Card className="bg-blue-500/10 border-blue-500/20">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-blue-700">
                            <Activity className="h-4 w-4" /> Net Profit
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-blue-700">{(totalRevenue - totalExpenses).toFixed(2)} EGP</div>
                    </CardContent>
                </Card>
            </div>

            {pendingRequests.length > 0 && (
                <Card className="border-yellow-500 shadow-sm">
                    <CardHeader className="bg-yellow-500/5 pb-4">
                        <CardTitle className="flex items-center gap-2 text-yellow-700">
                            <CalendarCheck className="h-5 w-5" />
                            Pending Payment Requests
                        </CardTitle>
                        <CardDescription>
                            Tenants have submitted InstaPay receipts. Please verify and approve.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <div className="space-y-4">
                            {pendingRequests.map(req => (
                                <div key={req.id} className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between p-4 border rounded-lg bg-background">
                                    <div>
                                        <h4 className="font-semibold text-lg">{req.business?.name}</h4>
                                        <p className="text-sm text-muted-foreground">{req.description}</p>
                                        <Badge className="mt-2 bg-yellow-500">{req.amount} EGP</Badge>
                                    </div>
                                    <div className="flex gap-2 w-full sm:w-auto">
                                        {req.proof_url && (
                                            <Button variant="outline" size="sm" asChild>
                                                <a href={req.proof_url} target="_blank" rel="noreferrer">
                                                    <ExternalLink className="h-4 w-4 mr-2" /> View Receipt
                                                </a>
                                            </Button>
                                        )}
                                        <Button variant="outline" size="sm" className="text-green-600 hover:bg-green-50" onClick={() => handleApprove(req)}>
                                            <CheckCircle className="h-4 w-4 mr-2" /> Approve
                                        </Button>
                                        <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => handleReject(req)}>
                                            <XCircle className="h-4 w-4 mr-2" /> Reject
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Transactions Ledger</CardTitle>
                        <CardDescription>All historical accounting records.</CardDescription>
                    </div>
                    <Select value={filterType} onValueChange={(v: any) => setFilterType(v)}>
                        <SelectTrigger className="w-[150px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="revenue">Revenue Only</SelectItem>
                            <SelectItem value="expense">Expenses Only</SelectItem>
                        </SelectContent>
                    </Select>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Category</TableHead>
                                        <TableHead>Entity / Desc</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredTransactions.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center p-8 text-muted-foreground">
                                                No transactions found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredTransactions.map((tx) => (
                                            <TableRow key={tx.id}>
                                                <TableCell className="text-sm">
                                                    {new Date(tx.created_at).toLocaleDateString()}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={tx.type === "revenue" ? "default" : "destructive"}>
                                                        {tx.type}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>{tx.category}</TableCell>
                                                <TableCell>
                                                    <div className="font-medium">{tx.business?.name || "Platform"}</div>
                                                    <div className="text-xs text-muted-foreground">{tx.description}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={
                                                        tx.status === "approved" || tx.status === "paid" ? "border-green-500 text-green-600" :
                                                        tx.status === "pending" ? "border-yellow-500 text-yellow-600" : "border-red-500 text-red-600"
                                                    }>
                                                        {tx.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className={`text-right font-bold ${tx.type === "revenue" ? "text-green-600" : "text-red-600"}`}>
                                                    {tx.type === "revenue" ? "+" : "-"}{tx.amount} EGP
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
