"use client";

import { useEffect, useState, Suspense } from "react";
import { cn } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, normalizeSearchText } from "@/lib/utils";
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

import { logBusinessAction } from "@/lib/logs/actions-logger";


/** The short order number shown on the Orders list, the CSV and the waybill. */
const orderRef = (id?: string | null) => (id ? id.slice(0, 8) : "");

/**
 * Everything a transaction can be searched by.
 *
 * The description of a deposit taken on a platform order holds the EasyOrders
 * id, which appears on no other screen, so searching for the order number the
 * rest of the system shows used to return nothing at all. The linked order
 * fills that gap: its number, the customer, and the phone.
 */
function txnHaystack(t: any): string {
    const info = t.orders?.customer_info || {};
    return [
        t.description, t.category, t.account_name,
        orderRef(t.orders?.id || t.order_id),
        info.name, info.phone, info.phone2,
    ].filter(Boolean).join(" ");
}

function AccountingContent() {
    const { activeBusiness, currentUser } = useBusiness();

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
        if (activeBusiness) {
            fetchData();
            fetchBalances();
        }
    }, [activeBusiness?.id, fromDate, toDate]);

    async function fetchBalances() {
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

            // PostgREST caps an unbounded select at 1,000 rows and returns
            // success, so the page used to drop every transaction older than
            // the newest thousand without saying a word — with no date filter
            // that hid two thirds of the ledger. Page through instead.
            const PAGE = 1000;
            // The embedded order is what makes a transaction findable by order
            // number or customer name; the description only ever carried the
            // platform's own id. It needs the foreign key from migration
            // 20260831, so fall back to the plain columns until that has run —
            // a missing search key is a nuisance, an empty ledger is not.
            let columns = "*, orders(id, customer_info)";
            const all: any[] = [];
            for (let from = 0; ; from += PAGE) {
                const page = async () => {
                    let query = supabase
                        .from("transactions")
                        .select(columns)
                        .eq("business_id", activeBusiness.id)
                        .order("transaction_date", { ascending: false })
                        // transaction_date alone is not a total order — 90 rows
                        // share 2026-06-28 — and a page boundary landing inside
                        // a tied group lets the database return some of those
                        // rows on both pages and others on neither. Paging an
                        // unstable sort loses data; the id breaks every tie.
                        .order("id", { ascending: false })
                        .range(from, from + PAGE - 1);
                    if (fromDate) query = query.gte("transaction_date", fromDate);
                    if (toDate) query = query.lte("transaction_date", toDate);
                    return query;
                };

                let { data, error } = await page();
                if (error && error.code === "PGRST200") {
                    console.warn("Accounting: order link missing, run migration 20260831.");
                    columns = "*";
                    ({ data, error } = await page());
                }
                if (error) throw error;
                all.push(...(data || []));
                if (!data || data.length < PAGE) break;
            }

            // Belt and braces. A repeated row would collide on the React key
            // and make the table render entries the filter had excluded, which
            // is how the unstable sort showed up in the first place: three
            // June 28th rows appeared under a treasury they do not belong to.
            const seen = new Set<string>();
            setTransactions(all.filter(r => !seen.has(r.id) && seen.add(r.id)));
        } catch (error) {
            console.error("Error fetching transactions:", error);
        } finally {
            setLoading(false);
        }
    }

    async function deleteTransaction(id: string) {
        if (!activeBusiness) return;
        try {
            const targetTx = transactions.find(t => t.id === id);
            const { error } = await supabase
                .from("transactions")
                .delete()
                .eq("id", id)
                .eq("business_id", activeBusiness.id);
            if (error) throw error;

            if (targetTx) {
                logBusinessAction({
                    businessId: activeBusiness.id,
                    userEmail: currentUser?.email || "Staff",
                    actionType: "delete",
                    entityType: "transaction",
                    entityId: id,
                    entityName: `${targetTx.type ? targetTx.type.toUpperCase() : "TRANSACTION"}: ${targetTx.amount} EGP (${targetTx.category || "General"})`,
                    changes: [
                        { field: "Transaction", old_value: `${targetTx.type} - ${targetTx.amount} EGP (${targetTx.account_name})`, new_value: "Deleted" }
                    ]
                });
            }

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
            <div id="treasury-list" className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                <div id="add-transaction-btn" className="flex gap-2">
                    <AddTransactionDialog type="investment" onSuccess={refresh} />
                    <AddTransactionDialog type="revenue" onSuccess={refresh} />
                    <AddTransactionDialog type="expense" onSuccess={refresh} />
                    <TransferDialog onSuccess={refresh} />
                </div>
                <div id="add-treasury-btn">
                    <ManageAccountsDialog onSuccess={refresh} />
                </div>
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

                                                // Normalised so an Arabic name types the way it is
                                                // spelled rather than the way it is stored.
                                                const needle = normalizeSearchText(searchQuery);
                                                const matchesSearch = !needle ||
                                                    normalizeSearchText(txnHaystack(t)).includes(needle);

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
                                                    <TableCell>
                                                        {txn.orders?.id && (
                                                            <div className="flex items-center gap-2 mb-0.5">
                                                                <span className="font-mono text-xs font-semibold">
                                                                    #{orderRef(txn.orders.id)}
                                                                </span>
                                                                {txn.orders.customer_info?.name && (
                                                                    <span className="text-xs text-muted-foreground">
                                                                        {txn.orders.customer_info.name}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                        <span className={cn(txn.orders?.id && "text-xs text-muted-foreground")}>
                                                            {txn.description}
                                                        </span>
                                                    </TableCell>
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



