"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddTransactionDialog } from "@/components/accounting/add-transaction-dialog";
import { TransferDialog } from "@/components/accounting/transfer-dialog";
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
import { Loader2, ArrowUpCircle, ArrowDownCircle, Wallet, Trash2, Search, Filter } from "lucide-react";
import { DateRangePicker } from "@/components/date-range-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function AccountingContent() {
    const searchParams = useSearchParams();
    const [transactions, setTransactions] = useState<any[]>([]);
    const [allTransactions, setAllTransactions] = useState<any[]>([]); // For balance calc if we want total history, but usually query
    const [loading, setLoading] = useState(true);
    const [balances, setBalances] = useState({
        "Mohamed Adel": 0,
        "Abdallah Sherif": 0,
    });

    // Smart Filters
    const [searchQuery, setSearchQuery] = useState("");
    const [filterAccount, setFilterAccount] = useState("all");
    const [filterCategory, setFilterCategory] = useState("all");

    const uniqueAccounts = Array.from(new Set(transactions.map(t => t.account_name).filter(Boolean)));
    const uniqueCategories = Array.from(new Set(transactions.map(t => t.category).filter(Boolean)));

    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    useEffect(() => {
        fetchData();
        fetchBalances(); // Balance usually tracked across ALL time, but let's check user intent. "Account Balances" suggests total current money. Date filter applies to the TABLE list.
    }, [fromDate, toDate]);

    async function fetchBalances() {
        // Fetch aggregated balances directly from Postgres via RPC
        const { data, error } = await supabase.rpc("get_treasury_balances");
        if (data) {
            const newBalances: Record<string, number> = { "Mohamed Adel": 0, "Abdallah Sherif": 0, "Safe": 0 };
            data.forEach((t: any) => {
                if (!t.account_name) return;
                newBalances[t.account_name] = Number(t.balance) || 0;
            });
            setBalances(newBalances as any);
        }
    }

    async function fetchData() {
        try {
            setLoading(true);
            let query = supabase
                .from("transactions")
                .select("*")
                .order("transaction_date", { ascending: false });

            if (fromDate) query = query.gte("transaction_date", fromDate);
            if (toDate) query = query.lte("transaction_date", toDate);

            const { data, error } = await query;
            if (error) throw error;
            setTransactions(data || []);
        } catch (error) {
            console.error("Error fetching transactions:", error);
        } finally {
            setLoading(false);
        }
    }

    async function deleteTransaction(id: string) {
        try {
            const { error } = await supabase.from("transactions").delete().eq("id", id);
            if (error) throw error;
            refresh();
        } catch (error) {
            console.error("Error deleting transaction:", error);
            alert("Failed to delete transaction");
        }
    }

    const refresh = () => {
        fetchData();
        fetchBalances();
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <h1 className="text-3xl font-bold tracking-tight">Accounting</h1>
                <DateRangePicker />
            </div>

            {/* Balances */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(balances).map(([name, amount]) => (
                    <Card key={name}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                {name} Account
                            </CardTitle>
                            <Wallet className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className={cn("text-2xl font-bold", amount < 0 ? "text-destructive" : "text-green-600")}>
                                {formatCurrency(amount)}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
                <AddTransactionDialog type="investment" onSuccess={refresh} />
                <AddTransactionDialog type="revenue" onSuccess={refresh} />
                <AddTransactionDialog type="expense" onSuccess={refresh} />
                <TransferDialog onSuccess={refresh} />
            </div>

            {/* Filtering & Search */}
            <div className="flex flex-col sm:flex-row gap-4 bg-muted/50 p-4 rounded-lg border">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search descriptions, categories, or accounts..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 bg-background"
                    />
                </div>
                <div className="flex flex-wrap gap-4">
                    <Select value={filterAccount} onValueChange={setFilterAccount}>
                        <SelectTrigger className="w-[180px] bg-background">
                            <SelectValue placeholder="All Accounts" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Accounts</SelectItem>
                            {uniqueAccounts.map(acc => typeof acc === 'string' && (
                                <SelectItem key={acc} value={acc}>{acc}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={filterCategory} onValueChange={setFilterCategory}>
                        <SelectTrigger className="w-[180px] bg-background">
                            <SelectValue placeholder="All Categories" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Categories</SelectItem>
                            {uniqueCategories.map(cat => typeof cat === 'string' && (
                                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Lists */}
            <Tabs defaultValue="all" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="investment">Investments</TabsTrigger>
                    <TabsTrigger value="revenue">Revenues</TabsTrigger>
                    <TabsTrigger value="expense">Expenses</TabsTrigger>
                </TabsList>

                {["all", "investment", "revenue", "expense"].map((tab) => (
                    <TabsContent key={tab} value={tab} className="space-y-4">
                        <div className="rounded-md border bg-card">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Category</TableHead>
                                        <TableHead>Description</TableHead>
                                        <TableHead>Account</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-24 text-center">
                                                <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        (() => {
                                            const filteredTransactions = transactions.filter(t => {
                                                if (tab !== 'all' && t.type !== tab) return false;

                                                const matchesSearch = !searchQuery ||
                                                    t.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                                    t.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                                    t.account_name?.toLowerCase().includes(searchQuery.toLowerCase());

                                                if (!matchesSearch) return false;
                                                if (filterAccount !== 'all' && t.account_name !== filterAccount) return false;
                                                if (filterCategory !== 'all' && t.category !== filterCategory) return false;

                                                return true;
                                            });

                                            if (filteredTransactions.length === 0) {
                                                return (
                                                    <TableRow>
                                                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                                            No transactions found matching your filters.
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            }

                                            return filteredTransactions.map((t) => (
                                                <TableRow key={t.id}>
                                                    <TableCell>{format(new Date(t.transaction_date), "PPP")}</TableCell>
                                                    <TableCell>
                                                        <Badge variant={
                                                            t.type === 'expense' ? 'destructive' :
                                                                t.type === 'revenue' ? 'default' :
                                                                    t.type.includes('transfer') ? 'outline' :
                                                                        'secondary'
                                                        }>
                                                            {t.type.replace('_', ' ')}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>{t.category}</TableCell>
                                                    <TableCell>{t.description}</TableCell>
                                                    <TableCell>{t.account_name}</TableCell>
                                                    <TableCell className={cn("text-right font-medium", t.amount > 0 ? "text-green-600" : "text-destructive")}>
                                                        {formatCurrency(t.amount)}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-70 hover:opacity-100 hover:bg-destructive/10">
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>Delete Transaction?</AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                        This action cannot be undone. This will permanently remove this transaction from the database.
                                                                    </AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                    <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => deleteTransaction(t.id)}>Delete</AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    </TableCell>
                                                </TableRow>
                                            ));
                                        })()
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
}

import { Suspense } from "react";

export default function AccountingPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <AccountingContent />
        </Suspense>
    );
}

// Helper for cn (copying plain classnames without library if utility not imported, but we have it)
import { cn } from "@/lib/utils";
