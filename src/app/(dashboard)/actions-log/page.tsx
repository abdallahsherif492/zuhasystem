"use client";

import { useEffect, useState } from "react";
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
    action_type: "create" | "update_status" | "edit" | "delete" | "stock_adjust";
    entity_type: "order" | "product" | "inventory" | "transaction" | "customer" | "team";
    entity_id: string;
    entity_name: string;
    changes: ActionDiff[];
    metadata: Record<string, any>;
    created_at: string;
};

export default function ActionsLogPage() {
    const { activeBusiness } = useBusiness();
    const { t } = useLanguage();
    const [loading, setLoading] = useState(true);
    const [logs, setLogs] = useState<ActionLogRecord[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [entityFilter, setEntityFilter] = useState("all");
    const [actionFilter, setActionFilter] = useState("all");
    const [dateFilter, setDateFilter] = useState("");

    useEffect(() => {
        if (activeBusiness) {
            fetchLogs();
        }
    }, [activeBusiness]);

    async function fetchLogs() {
        if (!activeBusiness) return;
        setLoading(true);

        const { data, error } = await supabase
            .from("actions_log")
            .select("*")
            .eq("business_id", activeBusiness.id)
            .order("created_at", { ascending: false })
            .limit(300);

        if (error) {
            console.error("Error fetching actions log:", error);
            // If table doesn't exist yet, gracefully set empty list
            setLogs([]);
        } else {
            setLogs((data as ActionLogRecord[]) || []);
        }
        setLoading(false);
    }

    // Filtering logic
    const filteredLogs = logs.filter(log => {
        // Search Query
        const matchesQuery = 
            !searchQuery.trim() ||
            (log.user_email || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (log.entity_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (log.entity_id || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (log.action_type || "").toLowerCase().includes(searchQuery.toLowerCase());

        // Entity Filter
        const matchesEntity = entityFilter === "all" || log.entity_type === entityFilter;

        // Action Filter
        const matchesAction = actionFilter === "all" || log.action_type === actionFilter;

        // Date Filter
        const matchesDate = !dateFilter || log.created_at.startsWith(dateFilter);

        return matchesQuery && matchesEntity && matchesAction && matchesDate;
    });

    // Summary Metric Calculations
    const totalCount = logs.length;
    const orderLogsCount = logs.filter(l => l.entity_type === "order").length;
    const productStockLogsCount = logs.filter(l => l.entity_type === "product" || l.entity_type === "inventory").length;
    const financialLogsCount = logs.filter(l => l.entity_type === "transaction").length;

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
            default:
                return <Badge variant="outline" className="text-[10px] font-mono">{entity}</Badge>;
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

            {/* Filter Bar */}
            <div className="grid gap-3 md:grid-cols-4 bg-muted/20 p-3 rounded-xl border border-border/50">
                {/* Search Bar */}
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t("Search by user, entity, ID...")}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 text-xs h-9"
                    />
                </div>

                {/* Entity Filter */}
                <Select value={entityFilter} onValueChange={setEntityFilter}>
                    <SelectTrigger className="h-9 text-xs bg-background">
                        <SelectValue placeholder={t("Filter by Entity")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t("All Entities")}</SelectItem>
                        <SelectItem value="order">{t("Orders")}</SelectItem>
                        <SelectItem value="product">{t("Products")}</SelectItem>
                        <SelectItem value="inventory">{t("Inventory")}</SelectItem>
                        <SelectItem value="transaction">{t("Transactions")}</SelectItem>
                    </SelectContent>
                </Select>

                {/* Action Filter */}
                <Select value={actionFilter} onValueChange={setActionFilter}>
                    <SelectTrigger className="h-9 text-xs bg-background">
                        <SelectValue placeholder={t("Filter by Action")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t("All Actions")}</SelectItem>
                        <SelectItem value="create">{t("Creation")}</SelectItem>
                        <SelectItem value="update_status">{t("Status Change")}</SelectItem>
                        <SelectItem value="edit">{t("Edit Details")}</SelectItem>
                        <SelectItem value="stock_adjust">{t("Stock Adjust")}</SelectItem>
                        <SelectItem value="delete">{t("Deletion")}</SelectItem>
                    </SelectContent>
                </Select>

                {/* Date Picker */}
                <div className="relative">
                    <Input
                        type="date"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="text-xs h-9 bg-background"
                    />
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
                </CardContent>
            </Card>
        </div>
    );
}
