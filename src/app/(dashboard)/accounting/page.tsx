"use client";

import { useEffect, useState, Suspense } from "react";
import { cn } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddTransactionDialog } from "@/components/accounting/add-transaction-dialog";
import { TransferDialog } from "@/components/accounting/transfer-dialog";
import { ManageAccountsDialog } from "@/components/accounting/manage-accounts-dialog";
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
    const { activeBusiness } = useBusiness();
    const { t } = useLanguage();
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
        if (!activeBusiness) return;
        if (!activeBusiness) return;
        
        try {
            // Fetch the accounts list for this business
            const { data: accountsData } = await supabase
                .from("financial_accounts")
                .select("name")
                .eq("business_id", activeBusiness.id);

            // Fetch aggregated balances
            const { data: balancesData } = await supabase
                .rpc("get_treasury_balances", { p_business_id: activeBusiness.id });

            const newBalances: Record<string, number> = {};
            
            // Initialize all accounts to 0
            if (accountsData) {
                accountsData.forEach((acc: any) => {
                    newBalances[acc.name] = 0;
                });
            }

            // Populate actual balances
            if (balancesData) {
                balancesData.forEach((t: any) => {
                    if (!t.account_name) return;
                    newBalances[t.account_name] = Number(t.balance) || 0;
                });
            }
            
            setBalances(newBalances as any);
        } catch (error) {
            console.error("Error fetching balances:", error);
        }
    }

    async function fetchData() {
        if (!activeBusiness) return;
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
                <h1 className="text-3xl font-bold tracking-tight">{t("Accounting")}</h1>
                <DateRangePicker />
            </div>

            {/* Balances */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(balances).map(([name, amount]) => (
                    <Card key={name}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                {name} {t("Account")}
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
                <ManageAccountsDialog onSuccess={refresh} />
            </div>

            {/* Filtering & Search */}
            <div className="flex flex-col sm:flex-row gap-4 bg-muted/50 p-4 rounded-lg border">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t("Search descriptions, categories, or accounts...")}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 bg-background"
                    />
                </div>
                <div className="flex flex-wrap gap-4">
                    <Select value={filterAccount} onValueChange={setFilterAccount}>
                        <SelectTrigger className="w-[180px] bg-background">
                            <SelectValue placeholder={t("All Accounts")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t("All Accounts")}</SelectItem>
                            {uniqueAccounts.map(acc => typeof acc === 'string' && (
                                <SelectItem key={acc} value={acc}>{acc}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={filterCategory} onValueChange={setFilterCategory}>
                        <SelectTrigger className="w-[180px] bg-background">
                            <SelectValue placeholder={t("All Categories")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t("All Categories")}</SelectItem>
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
                    <TabsTrigger value="all">{t("All")}</TabsTrigger>
                    <TabsTrigger value="investment">{t("Investments")}</TabsTrigger>
                    <TabsTrigger value="revenue">{t("Revenues")}</TabsTrigger>
                    <TabsTrigger value="expense">{t("Expenses")}</TabsTrigger>
                </TabsList>

                {["all", "investment", "revenue", "expense"].map((tab) => (
                    <TabsContent key={tab} value={tab} className="space-y-4">
                        <div className="rounded-md border bg-card">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t("Date")}</TableHead>
                                        <TableHead>{t("Type")}</TableHead>
                                        <TableHead>{t("Category")}</TableHead>
                                        <TableHead>{t("Description")}</TableHead>
                                        <TableHead>{t("Account")}</TableHead>
                                        <TableHead className="text-right">{t("Amount")}</TableHead>
                                        <TableHead className="text-right">{t("Actions")}</TableHead>
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
                                                            {t("No transactions found matching your filters.")}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            }

                                            return filteredTransactions.map((txn) => (
                                                <TableRow key={txn.id}>
                                                    <TableCell>{format(new Date(txn.transaction_date), "PPP")}</TableCell>
                                                    <TableCell>
                                                        <Badge variant={
                                                            txn.type === 'expense' ? 'destructive' :
                                                                txn.type === 'revenue' ? 'default' :
                                                                    txn.type.includes('transfer') ? 'outline' :
                                                                        'secondary'
                                                        }>
                                                            {t(txn.type.replace('_', ' '))}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>{txn.category}</TableCell>
                                                    <TableCell>{txn.description}</TableCell>
                                                    <TableCell>{txn.account_name}</TableCell>
                                                    <TableCell className={cn("text-right font-medium", txn.amount > 0 ? "text-green-600" : "text-destructive")}>
                                                        {formatCurrency(txn.amount)}
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
                                                                    <AlertDialogTitle>{t("Delete Transaction?")}</AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                        {t("This action cannot be undone. This will permanently remove this transaction from the database.")}
                                                                    </AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                                                                    <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => deleteTransaction(txn.id)}>{t("Delete")}</AlertDialogAction>
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



export default function AccountingPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <AccountingContent />
        </Suspense>
    );
}



