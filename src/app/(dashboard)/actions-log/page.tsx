"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, History, Search, Filter, Calendar, ArrowRight, UserCheck, ShoppingBag, Package, DollarSign, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { format, parseISO } from "date-fns";
import { ActionDiff } from "@/lib/logs/actions-logger";

type ActionLogRecord = {
    id: string;
    business_id: string;
    user_email: string;
    // Deliberately widened to string. The database triggers write entity types
    // this page does not enumerate (supplier, invoice, treasury, settings...),
    // and a union here would be a lie that silently mislabels rows.
    action_type: string;
    entity_type: string;
    entity_id: string;
    entity_name: string;
    changes: ActionDiff[];
    metadata: Record<string, any>;
    created_at: string;
};

const PAGE_SIZE = 100;

export default function ActionsLogPage() {
    const { activeBusiness } = useBusiness();
    const { t } = useLanguage();
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [logs, setLogs] = useState<ActionLogRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [breakdown, setBreakdown] = useState<Record<string, number>>({});
    const [facets, setFacets] = useState<{ users: string[]; entities: string[]; actions: string[] }>({
        users: [], entities: [], actions: [],
    });

    const [searchQuery, setSearchQuery] = useState("");
    const [entityFilter, setEntityFilter] = useState("all");
    const [actionFilter, setActionFilter] = useState("all");
    const [userFilter, setUserFilter] = useState("all");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");

    // Debounced so typing does not fire a query per keystroke against 12k rows.
    const [debouncedSearch, setDebouncedSearch] = useState("");
    useEffect(() => {
        const id = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 400);
        return () => clearTimeout(id);
    }, [searchQuery]);

    /**
     * Every filter is applied in SQL.
     *
     * This page used to pull the newest 300 rows and filter them in the
     * browser. There are 12,165 rows and the newest 1,000 cover under two
     * days, so "last 300" was a few hours: filtering by a user or a date
     * earlier than that searched a window that had already scrolled past, and
     * found nothing, which read as "this was never logged".
     */
    const buildQuery = useCallback((forCount: boolean) => {
        let q = supabase
            .from("actions_log")
            .select("*", forCount ? { count: "exact", head: true } : undefined)
            .eq("business_id", activeBusiness!.id);

        if (entityFilter !== "all") q = q.eq("entity_type", entityFilter);
        if (actionFilter !== "all") q = q.eq("action_type", actionFilter);
        if (userFilter !== "all") q = q.eq("user_email", userFilter);
        if (fromDate) q = q.gte("created_at", new Date(fromDate + "T00:00:00").toISOString());
        // Inclusive of the whole end day, which is what picking a date means.
        if (toDate) q = q.lt("created_at", new Date(new Date(toDate + "T00:00:00").getTime() + 86400000).toISOString());
        if (debouncedSearch) {
            const safe = debouncedSearch.replace(/[%,()]/g, " ");
            q = q.or(`entity_name.ilike.%${safe}%,entity_id.ilike.%${safe}%,user_email.ilike.%${safe}%,action_type.ilike.%${safe}%`);
        }
        return q;
    }, [activeBusiness, entityFilter, actionFilter, userFilter, fromDate, toDate, debouncedSearch]);

    const fetchLogs = useCallback(async () => {
        if (!activeBusiness) return;
        setLoading(true);
        try {
            const [rowsRes, countRes] = await Promise.all([
                buildQuery(false).order("created_at", { ascending: false }).range(0, PAGE_SIZE - 1),
                buildQuery(true),
            ]);
            if (rowsRes.error) throw rowsRes.error;
            setLogs((rowsRes.data as ActionLogRecord[]) || []);
            setTotal(countRes.count ?? 0);
        } catch (e) {
            console.error("Error fetching actions log:", e);
            setLogs([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [activeBusiness, buildQuery]);

    async function loadMore() {
        if (!activeBusiness || loadingMore) return;
        setLoadingMore(true);
        try {
            const { data, error } = await buildQuery(false)
                .order("created_at", { ascending: false })
                .range(logs.length, logs.length + PAGE_SIZE - 1);
            if (error) throw error;
            setLogs(prev => [...prev, ...((data as ActionLogRecord[]) || [])]);
        } catch (e) {
            console.error("Error loading more:", e);
        } finally {
            setLoadingMore(false);
        }
    }

    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    // Dropdown options come from what is actually in the log, so a filter can
    // never offer a value that returns nothing, and never hides one it should.
    useEffect(() => {
        if (!activeBusiness) return;
        let cancelled = false;
        (async () => {
            const { data, error } = await supabase.rpc("get_actions_log_facets", {
                p_business_id: activeBusiness.id,
            });
            if (cancelled || error || !data) return;
            const pick = (k: string) => (data as any[]).filter(r => r.kind === k).map(r => r.value).sort();
            setFacets({ users: pick("user"), entities: pick("entity"), actions: pick("action") });
        })();
        return () => { cancelled = true; };
    }, [activeBusiness]);

    // Headline counts are per-entity totals across the whole log, not across
    // the page of rows on screen — counting the loaded rows made the cards
    // change every time someone pressed "load more".
    useEffect(() => {
        if (!activeBusiness) return;
        let cancelled = false;
        (async () => {
            const entities = ["order", "product", "inventory", "transaction", "customer", "team"];
            const counts = await Promise.all(entities.map(async e => {
                const { count } = await supabase
                    .from("actions_log")
                    .select("id", { count: "exact", head: true })
                    .eq("business_id", activeBusiness.id)
                    .eq("entity_type", e);
                return [e, count ?? 0] as const;
            }));
            if (!cancelled) setBreakdown(Object.fromEntries(counts));
        })();
        return () => { cancelled = true; };
    }, [activeBusiness]);

    const filteredLogs = logs;
    const totalCount = total;
    const orderLogsCount = breakdown.order ?? 0;
    const productStockLogsCount = (breakdown.product ?? 0) + (breakdown.inventory ?? 0);
    const financialLogsCount = breakdown.transaction ?? 0;

    const activeFilters =
        (entityFilter !== "all" ? 1 : 0) + (actionFilter !== "all" ? 1 : 0) +
        (userFilter !== "all" ? 1 : 0) + (fromDate ? 1 : 0) + (toDate ? 1 : 0) +
        (debouncedSearch ? 1 : 0);

    function clearFilters() {
        setSearchQuery(""); setEntityFilter("all"); setActionFilter("all");
        setUserFilter("all"); setFromDate(""); setToDate("");
    }

    const LABELS: Record<string, string> = {
        create: "Creation", update_status: "Status Change", edit: "Edit Details",
        stock_adjust: "Stock Adjust", delete: "Deletion",
        order: "Orders", product: "Products", inventory: "Inventory",
        transaction: "Transactions", customer: "Customers", team: "Team",
        supplier: "Suppliers", invoice: "Supplier Invoices", shipping: "Couriers",
        treasury: "Treasuries", settings: "Settings", target: "Targets",
        payable: "Supplier Ledger",
    };

    // Helper Badge Generators
    const getActionBadge = (type: string) => {
        switch (type) {
            case "create":
                return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-bold">{t("Creation")}</Badge>;
            case "update_status":
                return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 font-bold">{t("Status Change")}</Badge>;
            case "edit":
                return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 font-bold">{t("Edit Details")}</Badge>;
            case "stock_adjust":
                return <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20 font-bold">{t("Stock Adjust")}</Badge>;
            case "delete":
                return <Badge className="bg-red-500/10 text-red-600 border-red-500/20 font-bold">{t("Deletion")}</Badge>;
            default:
                return <Badge variant="outline">{type}</Badge>;
        }
    };

    const getEntityBadge = (entity: string) => {
        switch (entity) {
            case "order":
                return <Badge variant="outline" className="text-[10px] gap-1 font-mono"><ShoppingBag className="h-3 w-3 text-primary" /> {t("Orders")}</Badge>;
            case "product":
                return <Badge variant="outline" className="text-[10px] gap-1 font-mono"><Package className="h-3 w-3 text-blue-500" /> {t("Products")}</Badge>;
            case "inventory":
                return <Badge variant="outline" className="text-[10px] gap-1 font-mono"><Package className="h-3 w-3 text-purple-500" /> {t("Inventory")}</Badge>;
            case "transaction":
                return <Badge variant="outline" className="text-[10px] gap-1 font-mono"><DollarSign className="h-3 w-3 text-emerald-500" /> {t("Transactions")}</Badge>;
            case "customer":
                return <Badge variant="outline" className="text-[10px] gap-1 font-mono"><UserCheck className="h-3 w-3 text-cyan-500" /> {t("Customers")}</Badge>;
            case "team":
                return <Badge variant="outline" className="text-[10px] gap-1 font-mono"><UserCheck className="h-3 w-3 text-orange-500" /> {t("Team")}</Badge>;
            default:
                return <Badge variant="outline" className="text-[10px] font-mono">{t(LABELS[entity] || entity)}</Badge>;
        }
    };

    return (
        <div className="space-y-6 max-w-6xl mx-auto font-sans">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-4">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
                        <History className="h-7 w-7 text-primary" />
                        {t("Actions Log")}
                    </h1>
                    <p className="text-xs text-muted-foreground mt-1">{t("Audit every action across orders, products, inventory, and transactions.")}</p>
                </div>

                <Button variant="outline" size="sm" onClick={fetchLogs} className="gap-2 text-xs">
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                    {t("Refresh")}
                </Button>
            </div>

            {/* Summary Metrics */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/20 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold text-primary uppercase tracking-wider">{t("Total Actions")}</CardTitle>
                        <History className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black text-foreground">{totalCount}</div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent border-blue-500/20 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">{t("Order Actions")}</CardTitle>
                        <ShoppingBag className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black text-blue-900 dark:text-blue-100">{orderLogsCount}</div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent border-purple-500/20 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider">{t("Product & Stock")}</CardTitle>
                        <Package className="h-4 w-4 text-purple-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black text-purple-900 dark:text-purple-100">{productStockLogsCount}</div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-500/20 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">{t("Financial Log")}</CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black text-emerald-900 dark:text-emerald-100">{financialLogsCount}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Filter Bar — every control below narrows the query in SQL, not
                a page of already-fetched rows. */}
            <div className="space-y-3 bg-muted/20 p-3 rounded-xl border border-border/50">
                <div className="grid gap-3 md:grid-cols-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder={t("Search by user, entity, ID...")}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 text-xs h-9"
                        />
                    </div>

                    <Select value={entityFilter} onValueChange={setEntityFilter}>
                        <SelectTrigger className="h-9 text-xs bg-background">
                            <SelectValue placeholder={t("Filter by Entity")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t("All Entities")}</SelectItem>
                            {facets.entities.map(v => (
                                <SelectItem key={v} value={v}>{t(LABELS[v] || v)}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={actionFilter} onValueChange={setActionFilter}>
                        <SelectTrigger className="h-9 text-xs bg-background">
                            <SelectValue placeholder={t("Filter by Action")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t("All Actions")}</SelectItem>
                            {facets.actions.map(v => (
                                <SelectItem key={v} value={v}>{t(LABELS[v] || v)}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={userFilter} onValueChange={setUserFilter}>
                        <SelectTrigger className="h-9 text-xs bg-background">
                            <SelectValue placeholder={t("Filter by User")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t("All Users")}</SelectItem>
                            {facets.users.map(v => (
                                <SelectItem key={v} value={v}>{v}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="grid gap-3 md:grid-cols-4 items-center">
                    <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{t("From")}</label>
                        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="text-xs h-9 bg-background" />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{t("To")}</label>
                        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="text-xs h-9 bg-background" />
                    </div>
                    <div className="md:col-span-2 flex items-end justify-between gap-2 h-full pb-0.5">
                        <p className="text-xs text-muted-foreground">
                            {loading ? t("Searching...") : (
                                <>
                                    <span className="font-bold text-foreground">{total.toLocaleString()}</span>{" "}
                                    {activeFilters > 0 ? t("matching actions") : t("actions logged")}
                                    {logs.length < total && <> — {t("showing")} {logs.length.toLocaleString()}</>}
                                </>
                            )}
                        </p>
                        {activeFilters > 0 && (
                            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs gap-1.5">
                                <Filter className="h-3.5 w-3.5" />
                                {t("Clear")} ({activeFilters})
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* Logs Table */}
            <Card className="shadow-sm border border-border/60">
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/40 text-xs">
                                    <TableHead>{t("Performed By")}</TableHead>
                                    <TableHead>{t("Action")}</TableHead>
                                    <TableHead>{t("Entity")}</TableHead>
                                    <TableHead>{t("Details & Changes")}</TableHead>
                                    <TableHead className="text-right">{t("Timestamp")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody className="divide-y">
                                {filteredLogs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center p-8 text-xs text-muted-foreground">
                                            {t("No actions logged yet.")}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredLogs.map((log) => {
                                        const emailPrefix = (log.user_email || "SYS").substring(0, 2).toUpperCase();

                                        return (
                                            <TableRow key={log.id} className="hover:bg-muted/20 text-xs">
                                                <TableCell className="w-[180px]">
                                                    <div className="flex items-center gap-2.5">
                                                        <Avatar className="h-7 w-7 bg-primary/10 text-primary border border-primary/20">
                                                            <AvatarFallback className="font-bold text-[10px]">{emailPrefix}</AvatarFallback>
                                                        </Avatar>
                                                        <span className="font-medium text-xs truncate max-w-[120px]" title={log.user_email}>
                                                            {log.user_email}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="w-[130px]">
                                                    {getActionBadge(log.action_type)}
                                                </TableCell>
                                                <TableCell className="w-[180px]">
                                                    <div className="space-y-1">
                                                        {getEntityBadge(log.entity_type)}
                                                        <p className="font-semibold text-xs text-foreground truncate max-w-[160px]" title={log.entity_name}>
                                                            {log.entity_name}
                                                        </p>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="max-w-[350px]">
                                                    {log.changes && log.changes.length > 0 ? (
                                                        <div className="space-y-1">
                                                            {log.changes.map((c, idx) => (
                                                                <div key={idx} className="flex items-center gap-1.5 text-[11px] bg-muted/40 px-2 py-0.5 rounded border border-border/40 w-fit">
                                                                    <span className="font-bold text-muted-foreground">{c.field}:</span>
                                                                    <span className="line-through text-red-500/80">{String(c.old_value ?? "none")}</span>
                                                                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                                                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{String(c.new_value ?? "none")}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : log.metadata?.note ? (
                                                        <span className="text-xs text-muted-foreground italic">{log.metadata.note}</span>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">—</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-[11px] text-muted-foreground w-[150px]">
                                                    {log.created_at ? format(parseISO(log.created_at), "dd/MM/yyyy hh:mm a") : "—"}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    )}
                    {!loading && logs.length < total && (
                        <div className="p-4 border-t flex justify-center">
                            <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore} className="text-xs gap-2">
                                {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                {t("Load older")} ({(total - logs.length).toLocaleString()} {t("remaining")})
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
