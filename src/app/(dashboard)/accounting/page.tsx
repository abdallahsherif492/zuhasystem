"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { cn } from "@/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, normalizeSearchText } from "@/lib/utils";
import { format, startOfMonth } from "date-fns";
import { ar as arLocale } from "date-fns/locale";
import { AddTransactionDialog } from "@/components/accounting/add-transaction-dialog";
import { TransferDialog } from "@/components/accounting/transfer-dialog";
import { ManageAccountsDialog } from "@/components/accounting/manage-accounts-dialog";
import {
    Loader2, Trash2, Search, Plus, Minus, ArrowLeftRight, ArrowDownToLine, ArrowUpFromLine,
    Wallet, Download, X, Landmark,
} from "lucide-react";
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
import { KIND_META, categoryLabel, kindOf, type TxnKind } from "@/lib/accounting/txn-kinds";

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
function txnHaystack(t: any, ar: boolean): string {
    const info = t.orders?.customer_info || {};
    return [
        t.description, t.category, categoryLabel(t.category, ar), t.account_name,
        orderRef(t.orders?.id || t.order_id),
        info.name, info.phone, info.phone2,
    ].filter(Boolean).join(" ");
}

/** Each treasury's colour in the cash bar and beside its name, in order. */
const TREASURY_COLOURS = ["bg-teal-500", "bg-indigo-500", "bg-amber-500", "bg-sky-500", "bg-fuchsia-500", "bg-lime-500", "bg-orange-500"];

const KIND_ICON: Record<TxnKind, typeof Plus> = {
    revenue: ArrowDownToLine,
    expense: ArrowUpFromLine,
    investment: Plus,
    withdrawal: Minus,
    transfer: ArrowLeftRight,
};

/** How many ledger rows render before "show more". */
const PAGE_ROWS = 150;

function AccountingContent() {
    const { activeBusiness, currentUser } = useBusiness();

    const { language } = useLanguage();
    const ar = language === "ar";
    const L = (a: string, e: string) => (ar ? a : e);
    const dateLocale = ar ? { locale: arLocale } : undefined;
    const searchParams = useSearchParams();
    const [transactions, setTransactions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [balances, setBalances] = useState<Record<string, number>>({});

    // Smart Filters
    const [searchQuery, setSearchQuery] = useState("");
    const [filterAccount, setFilterAccount] = useState("all");
    const [filterCategory, setFilterCategory] = useState("all");
    const [filterKind, setFilterKind] = useState<"all" | TxnKind>("all");
    const [shown, setShown] = useState(PAGE_ROWS);

    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    // The page opens on the current month. Only on arrival: a range someone
    // clears afterwards stays cleared (everything since the start).
    const router = useRouter();
    const defaulted = useRef(false);
    const waitingForDefault = !fromDate && !toDate && !defaulted.current;
    useEffect(() => {
        if (waitingForDefault) {
            const params = new URLSearchParams(searchParams.toString());
            const today = new Date();
            params.set("from", format(startOfMonth(today), "yyyy-MM-dd"));
            params.set("to", format(today, "yyyy-MM-dd"));
            router.replace(`?${params.toString()}`, { scroll: false });
        }
        defaulted.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (activeBusiness) {
            // The month is on its way into the URL; loading the whole ledger
            // first would only be thrown away.
            if (!waitingForDefault) fetchData();
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

            setBalances(newBalances);
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
            alert(L("الحركة ماتمسحتش، جرّب تاني.", "Failed to delete transaction"));
        }
    }

    const refresh = () => {
        fetchData();
        fetchBalances();
    };

    // ------------------------------------------------------------------
    // What the page shows, all derived from the two loads above.
    // ------------------------------------------------------------------

    const treasuries = useMemo(
        () => Object.entries(balances).map(([name, amount], i) => ({ name, amount, colour: TREASURY_COLOURS[i % TREASURY_COLOURS.length] })),
        [balances],
    );
    const cash = treasuries.reduce((s, t) => s + t.amount, 0);
    const positive = treasuries.reduce((s, t) => s + Math.max(0, t.amount), 0);

    // The period at a glance (the date range above, or everything).
    const period = useMemo(() => {
        const sum = { revenue: 0, expense: 0, investment: 0, withdrawal: 0 };
        const byCategory = new Map<string, number>();
        for (const t of transactions) {
            const k = kindOf(t.type);
            const amt = Number(t.amount) || 0;
            if (k === "transfer") continue;
            sum[k] += amt;
            if (k === "expense") {
                const key = t.category || "";
                byCategory.set(key, (byCategory.get(key) || 0) + Math.abs(amt));
            }
        }
        const categories = [...byCategory.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
        return { ...sum, categories, net: sum.revenue + sum.expense + sum.investment + sum.withdrawal };
    }, [transactions]);

    const accountsInUse = useMemo(() => [...new Set([...Object.keys(balances), ...transactions.map(t => t.account_name).filter(Boolean)])], [balances, transactions]);
    const categoriesInUse = useMemo(() => [...new Set(transactions.map(t => t.category).filter(Boolean))] as string[], [transactions]);

    const filtered = useMemo(() => {
        // Normalised so an Arabic name types the way it is spelled rather
        // than the way it is stored.
        const needle = normalizeSearchText(searchQuery);
        return transactions.filter(t => {
            if (filterKind !== "all" && kindOf(t.type) !== filterKind) return false;
            if (filterAccount !== "all" && t.account_name !== filterAccount) return false;
            if (filterCategory !== "all" && t.category !== filterCategory) return false;
            if (needle && !normalizeSearchText(txnHaystack(t, ar)).includes(needle)) return false;
            return true;
        });
    }, [transactions, filterKind, filterAccount, filterCategory, searchQuery, ar]);
    const filteredNet = filtered.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const anyFilter = filterKind !== "all" || filterAccount !== "all" || filterCategory !== "all" || !!searchQuery;

    // The ledger, a day at a time.
    const days = useMemo(() => {
        const groups: { day: string; rows: any[]; net: number }[] = [];
        for (const t of filtered.slice(0, shown)) {
            const day = format(new Date(t.transaction_date), "yyyy-MM-dd");
            let g = groups[groups.length - 1];
            if (!g || g.day !== day) { g = { day, rows: [], net: 0 }; groups.push(g); }
            g.rows.push(t);
            g.net += Number(t.amount) || 0;
        }
        return groups;
    }, [filtered, shown]);

    const clearFilters = () => { setFilterKind("all"); setFilterAccount("all"); setFilterCategory("all"); setSearchQuery(""); setShown(PAGE_ROWS); };

    const exportCsv = () => {
        const head = ["date", "type", "category", "description", "order", "customer", "account", "amount"];
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const lines = filtered.map(t => [
            format(new Date(t.transaction_date), "yyyy-MM-dd"), t.type, t.category, t.description,
            orderRef(t.orders?.id || t.order_id), t.orders?.customer_info?.name, t.account_name, t.amount,
        ].map(esc).join(","));
        const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `transactions-${format(new Date(), "yyyy-MM-dd")}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const periodLabel = fromDate || toDate
        ? `${fromDate ? format(new Date(fromDate), "d MMM", dateLocale) : "…"} – ${toDate ? format(new Date(toDate), "d MMM yyyy", dateLocale) : L("النهارده", "today")}`
        : L("من الأول", "All time");

    const strip: { kind: TxnKind; label: string; value: number; hint: string }[] = [
        { kind: "revenue", label: L("دخل", "Income"), value: period.revenue, hint: L("تحصيل وعربون وغيره", "Collections, deposits, other") },
        { kind: "expense", label: L("مصاريف", "Expenses"), value: period.expense, hint: L("بتدخل في صافي الربح", "Counted in net profit") },
        { kind: "investment", label: L("ضخ استثمار", "Capital in"), value: period.investment, hint: L("مش دخل", "Not income") },
        { kind: "withdrawal", label: L("سحب استثمار", "Capital out"), value: period.withdrawal, hint: L("مش مصروف تشغيل", "Not an operating expense") },
    ];
    const topCategories = period.categories.slice(0, 6);
    const topMax = topCategories[0]?.amount || 1;

    return (
        <div className="mx-auto max-w-6xl space-y-8" dir={ar ? "rtl" : "ltr"}>
            {/* Header */}
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{L("الخزنة والحسابات", "Accounting")}</h1>
                    <p className="mt-1 text-sm text-muted-foreground">{L("فلوسك فين، دخل منها إيه، وخرج منها إيه.", "Where your money is, what came in and what went out.")}</p>
                </div>
                <DateRangePicker />
            </div>

            {/* Cash on hand: the one figure everything else explains. */}
            <section id="treasury-list" aria-labelledby="cash-title" className="rounded-2xl border bg-card p-5 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h2 id="cash-title" className="text-sm font-medium text-muted-foreground">{L("معاك دلوقتي في كل الخزن", "Cash across all treasuries")}</h2>
                        <p className={cn("mt-1 text-4xl font-bold tabular-nums tracking-tight sm:text-5xl", cash < 0 && "text-destructive")}>
                            {formatCurrency(cash)}
                        </p>
                    </div>
                    <div id="add-treasury-btn">
                        <ManageAccountsDialog onSuccess={refresh} trigger={
                            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground"><Landmark className="h-4 w-4" />{L("إدارة الخزن", "Manage treasuries")}</Button>
                        } />
                    </div>
                </div>

                {treasuries.length > 0 ? (
                    <>
                        {positive > 0 && (
                            <div className="mt-6 flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img"
                                aria-label={treasuries.map(t => `${t.name} ${formatCurrency(t.amount)}`).join("، ")}>
                                {treasuries.filter(t => t.amount > 0).map(t => (
                                    <div key={t.name} className={cn("h-full first:rounded-s-full last:rounded-e-full", t.colour)} style={{ width: `${(t.amount / positive) * 100}%` }} />
                                ))}
                            </div>
                        )}
                        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {treasuries.map(t => {
                                const active = filterAccount === t.name;
                                const share = positive > 0 && t.amount > 0 ? Math.round((t.amount / positive) * 100) : null;
                                return (
                                    <li key={t.name}>
                                        <button
                                            type="button"
                                            onClick={() => { setFilterAccount(active ? "all" : t.name); setShown(PAGE_ROWS); }}
                                            aria-pressed={active}
                                            title={active ? L("اعرض كل الخزن", "Show all treasuries") : L("اعرض حركات الخزنة دي بس", "Show this treasury's transactions only")}
                                            className={cn(
                                                "relative w-full overflow-hidden rounded-xl border bg-background p-4 ps-5 text-start shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                active ? "border-foreground/40 ring-2 ring-foreground/15" : "hover:border-foreground/25 hover:bg-muted/30",
                                            )}
                                        >
                                            {/* The treasury's colour, as in the bar above. */}
                                            <span className={cn("absolute inset-y-0 start-0 w-1.5", t.colour)} aria-hidden />
                                            <span className="flex items-center justify-between gap-2">
                                                <span className="truncate text-sm font-medium text-muted-foreground">{t.name}</span>
                                                {share !== null && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{share}%</span>}
                                            </span>
                                            <span className={cn("mt-2 block text-2xl font-bold tabular-nums tracking-tight", t.amount < 0 && "text-destructive")} dir="ltr" style={{ textAlign: ar ? "right" : "left" }}>
                                                {formatCurrency(t.amount)}
                                            </span>
                                            {active && <span className="mt-1 block text-[11px] text-muted-foreground">{L("الحركات تحت للخزنة دي بس", "Ledger below shows this treasury only")}</span>}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                ) : (
                    <p className="mt-4 text-sm text-muted-foreground">{L("مفيش خزن لسه. ضيف أول خزنة (كاش، بنك، محفظة) من «إدارة الخزن».", "No treasuries yet. Add your first one (cash, bank, wallet) from Manage treasuries.")}</p>
                )}
            </section>

            {/* Record money moving. */}
            <div id="add-transaction-btn" className="flex flex-wrap items-center gap-2">
                <AddTransactionDialog type="revenue" onSuccess={refresh} trigger={
                    <Button className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"><ArrowDownToLine className="h-4 w-4" />{L("دخل", "Income")}</Button>
                } />
                <AddTransactionDialog type="expense" onSuccess={refresh} trigger={
                    <Button className="gap-1.5 bg-rose-600 text-white hover:bg-rose-700"><ArrowUpFromLine className="h-4 w-4" />{L("مصروف", "Expense")}</Button>
                } />
                <TransferDialog onSuccess={refresh} trigger={
                    <Button variant="outline" className="gap-1.5"><ArrowLeftRight className="h-4 w-4" />{L("تحويل بين الخزن", "Transfer")}</Button>
                } />
                <div className="flex items-center gap-1 rounded-lg border p-1" role="group" aria-label={L("رأس المال", "Capital")}>
                    <span className="px-2 text-xs text-muted-foreground">{L("رأس المال", "Capital")}</span>
                    <AddTransactionDialog type="investment" onSuccess={refresh} trigger={
                        <Button variant="ghost" size="sm" className={cn("gap-1", KIND_META.investment.tone)}><Plus className="h-4 w-4" />{L("ضخ", "Add")}</Button>
                    } />
                    <AddTransactionDialog type="withdrawal" onSuccess={refresh} trigger={
                        <Button variant="ghost" size="sm" className={cn("gap-1", KIND_META.withdrawal.tone)}><Minus className="h-4 w-4" />{L("سحب", "Withdraw")}</Button>
                    } />
                </div>
            </div>

            {/* The period: four figures in one strip, each a filter. */}
            <section aria-labelledby="period-title" className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                    <h2 id="period-title" className="text-lg font-semibold">{L("حركة الفلوس", "Money movement")}</h2>
                    <span className="text-sm text-muted-foreground">{periodLabel}</span>
                </div>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-5">
                    {strip.map(s => {
                        const active = filterKind === s.kind;
                        return (
                            <button
                                key={s.kind}
                                type="button"
                                aria-pressed={active}
                                onClick={() => { setFilterKind(active ? "all" : s.kind); setShown(PAGE_ROWS); }}
                                className={cn("p-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", active ? KIND_META[s.kind].soft : "bg-card hover:bg-muted/50")}
                            >
                                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <span className={cn("h-2 w-2 rounded-full", KIND_META[s.kind].swatch)} aria-hidden />{s.label}
                                </span>
                                <span className={cn("mt-1 block text-base font-semibold tabular-nums sm:text-xl", s.value !== 0 && KIND_META[s.kind].tone)}>
                                    {formatCurrency(Math.abs(s.value))}
                                </span>
                                <span className="text-[11px] text-muted-foreground">{s.hint}</span>
                            </button>
                        );
                    })}
                    <div className="col-span-2 bg-muted p-4 lg:col-span-1">
                        <span className="text-xs text-muted-foreground">{L("صافي حركة الخزن", "Net cash movement")}</span>
                        <span className={cn("mt-1 block text-base font-semibold tabular-nums sm:text-xl", period.net < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>
                            {period.net > 0 ? "+" : ""}{formatCurrency(period.net)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">{L("التحويلات بين الخزن مش محسوبة", "Transfers between treasuries left out")}</span>
                    </div>
                </div>

                {/* Where the expenses went. */}
                {topCategories.length > 0 && (
                    <div className="rounded-xl border p-4">
                        <h3 className="mb-3 text-sm font-medium">{L("المصاريف راحت فين", "Where expenses went")}</h3>
                        <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
                            {topCategories.map(c => {
                                const active = filterCategory === c.category && filterKind === "expense";
                                return (
                                    <li key={c.category}>
                                        <button
                                            type="button"
                                            aria-pressed={active}
                                            onClick={() => {
                                                if (active) { setFilterCategory("all"); setFilterKind("all"); }
                                                else { setFilterCategory(c.category); setFilterKind("expense"); }
                                                setShown(PAGE_ROWS);
                                            }}
                                            className="group block w-full space-y-1 rounded text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            <span className="flex items-baseline justify-between gap-3">
                                                <span className={cn("truncate", active && "font-semibold")}>{categoryLabel(c.category, ar)}</span>
                                                <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                                                    <span className="text-muted-foreground">{formatCurrency(c.amount)}</span>
                                                    <span className="w-9 text-end text-xs font-medium">{Math.round((c.amount / Math.abs(period.expense || 1)) * 100)}%</span>
                                                </span>
                                            </span>
                                            <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
                                                <span className={cn("block h-full rounded-full transition-colors", active ? "bg-rose-600" : "bg-rose-400/70 group-hover:bg-rose-500")} style={{ width: `${(c.amount / topMax) * 100}%` }} />
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </section>

            {/* The ledger */}
            <section aria-labelledby="ledger-title" className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h2 id="ledger-title" className="text-lg font-semibold">{L("كل الحركات", "All transactions")}</h2>
                    {!loading && (
                        <span className="text-sm text-muted-foreground">
                            {L(`${filtered.length} حركة`, `${filtered.length} transactions`)}
                            {anyFilter && <> · {L("صافيها", "net")} <span className={cn("font-medium tabular-nums", filteredNet < 0 ? "text-destructive" : "text-foreground")}>{formatCurrency(filteredNet)}</span></>}
                        </span>
                    )}
                </div>

                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                    <div className="relative flex-1">
                        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder={L("دوّر بملاحظة، تصنيف، رقم أوردر أو اسم عميل…", "Search notes, categories, order number or customer…")}
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setShown(PAGE_ROWS); }}
                            className="ps-9"
                        />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Select value={filterKind} onValueChange={v => { setFilterKind(v as "all" | TxnKind); setShown(PAGE_ROWS); }}>
                            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{L("كل الأنواع", "All types")}</SelectItem>
                                {(Object.keys(KIND_META) as TxnKind[]).map(k => (
                                    <SelectItem key={k} value={k}>{ar ? KIND_META[k].ar : KIND_META[k].en}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={filterAccount} onValueChange={v => { setFilterAccount(v); setShown(PAGE_ROWS); }}>
                            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{L("كل الخزن", "All treasuries")}</SelectItem>
                                {accountsInUse.map(acc => <SelectItem key={acc} value={acc}>{acc}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={filterCategory} onValueChange={v => { setFilterCategory(v); setShown(PAGE_ROWS); }}>
                            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{L("كل التصنيفات", "All categories")}</SelectItem>
                                {categoriesInUse.map(cat => <SelectItem key={cat} value={cat}>{categoryLabel(cat, ar)}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        {anyFilter && (
                            <Button variant="ghost" size="sm" className="h-10 gap-1" onClick={clearFilters}><X className="h-4 w-4" />{L("امسح الفلاتر", "Clear filters")}</Button>
                        )}
                        <Button variant="outline" size="icon" className="h-10 w-10" onClick={exportCsv} disabled={!filtered.length}
                            title={L("نزّل اللي ظاهر Excel (CSV)", "Download what is shown (CSV)")} aria-label={L("نزّل اللي ظاهر", "Download what is shown")}>
                            <Download className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="overflow-hidden rounded-xl border bg-card">
                    {loading ? (
                        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                            <Wallet className="h-8 w-8 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">
                                {anyFilter
                                    ? L("مفيش حركات بالفلاتر دي.", "No transactions match these filters.")
                                    : L("مفيش حركات في الفترة دي. سجّل أول دخل أو مصروف من الزراير اللي فوق.", "No transactions in this period. Record income or an expense with the buttons above.")}
                            </p>
                            {anyFilter && <Button variant="outline" size="sm" onClick={clearFilters}>{L("امسح الفلاتر", "Clear filters")}</Button>}
                        </div>
                    ) : (
                        <>
                            {days.map(g => (
                                <div key={g.day}>
                                    <div className="flex items-center justify-between border-b bg-muted/60 px-4 py-1.5 text-xs">
                                        <span className="font-medium">{format(new Date(g.day + "T12:00:00"), "EEEE d MMMM yyyy", dateLocale)}</span>
                                        <span className={cn("tabular-nums", g.net < 0 ? "text-destructive" : "text-muted-foreground")}>{g.net > 0 ? "+" : ""}{formatCurrency(g.net)}</span>
                                    </div>
                                    <ul className="divide-y">
                                        {g.rows.map(txn => {
                                            const k = kindOf(txn.type);
                                            const meta = KIND_META[k];
                                            const Icon = KIND_ICON[k];
                                            const amount = Number(txn.amount) || 0;
                                            return (
                                                <li key={txn.id} className="group flex items-start gap-3 px-4 py-3 hover:bg-muted/30">
                                                    <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", meta.soft, meta.tone)} title={ar ? meta.ar : meta.en}>
                                                        <Icon className="h-4 w-4" />
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                                            <span className="text-sm font-medium">{categoryLabel(txn.category, ar)}</span>
                                                            {k !== "expense" && k !== "revenue" && (
                                                                <span className={cn("rounded px-1.5 text-[11px]", meta.soft, meta.tone)}>{ar ? meta.ar : meta.en}</span>
                                                            )}
                                                            {txn.orders?.id && (
                                                                <span className="text-xs text-muted-foreground">
                                                                    <span className="font-semibold text-foreground/80" dir="ltr">#{orderRef(txn.orders.id)}</span>
                                                                    {txn.orders.customer_info?.name && <> {txn.orders.customer_info.name}</>}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {txn.description && <p className="mt-0.5 break-words text-xs text-muted-foreground">{txn.description}</p>}
                                                        <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">{txn.account_name}</p>
                                                    </div>
                                                    <span className="hidden w-36 shrink-0 truncate pt-1 text-sm text-muted-foreground sm:block">{txn.account_name}</span>
                                                    <span className={cn("min-w-[7.5rem] shrink-0 whitespace-nowrap pt-1 text-end text-sm font-semibold tabular-nums sm:text-base", meta.tone)} dir="ltr">
                                                        {amount > 0 ? "+" : ""}{formatCurrency(amount)}
                                                    </span>
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive hover:opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                                                                aria-label={L("امسح الحركة", "Delete transaction")}>
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent dir={ar ? "rtl" : "ltr"}>
                                                            <AlertDialogHeader className="text-start">
                                                                <AlertDialogTitle>{L("تمسح الحركة دي؟", "Delete this transaction?")}</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    {L(`${categoryLabel(txn.category, ar)} ${formatCurrency(amount)} من ${txn.account_name}. رصيد الخزنة هيتغير، والمسح مالوش رجوع.`,
                                                                        `${txn.category} ${formatCurrency(amount)} in ${txn.account_name}. The treasury balance changes, and this cannot be undone.`)}
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>{L("رجوع", "Cancel")}</AlertDialogCancel>
                                                                <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => deleteTransaction(txn.id)}>{L("امسح", "Delete")}</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            ))}
                            {filtered.length > shown && (
                                <div className="border-t p-3 text-center">
                                    <Button variant="outline" size="sm" onClick={() => setShown(n => n + PAGE_ROWS * 2)}>
                                        {L(`اعرض أكتر (فاضل ${filtered.length - shown})`, `Show more (${filtered.length - shown} left)`)}
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </section>
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
