"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Loader2, Store, CheckCircle, XCircle, Search, SlidersHorizontal,
    ExternalLink, Wallet, AlertTriangle, Clock,
} from "lucide-react";
import { toast } from "sonner";

import { useBusiness } from "@/contexts/BusinessContext";
import { logAuditAction } from "@/lib/audit";
import { BusinessDetailDialog, BusinessRow } from "./business-detail-dialog";
import { cn } from "@/lib/utils";

type SortKey = "created_at" | "name" | "subscription_end_date" | "wallet_balance";

const daysUntil = (iso: string | null) =>
    iso === null ? null : Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

export default function BusinessesManagement() {
    const { impersonateBusiness } = useBusiness();
    const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
    const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);

    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [sortKey, setSortKey] = useState<SortKey>("created_at");

    const [selected, setSelected] = useState<BusinessRow | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    const fetchBusinesses = useCallback(async () => {
        const { data, error } = await supabase
            .from("businesses")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            toast.error(`Failed to load businesses: ${error.message}`);
        } else {
            setBusinesses((data || []) as BusinessRow[]);

            // One query for all memberships beats one per business.
            const { data: links } = await supabase.from("business_users").select("business_id");
            const counts: Record<string, number> = {};
            (links || []).forEach((l: any) => {
                if (l.business_id) counts[l.business_id] = (counts[l.business_id] || 0) + 1;
            });
            setMemberCounts(counts);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchBusinesses();
    }, [fetchBusinesses]);

    const updateStatus = async (biz: BusinessRow, newStatus: string) => {
        const { error, data } = await supabase
            .from("businesses")
            .update({ subscription_status: newStatus })
            .eq("id", biz.id)
            .select();

        if (error) {
            toast.error(`Failed: ${error.message}`);
            return;
        }
        if (!data || data.length === 0) {
            toast.error("Update blocked — your admin account may lack write access (RLS).");
            return;
        }

        await logAuditAction(
            newStatus === "active" ? "BUSINESS_ACTIVATED" : "BUSINESS_SUSPENDED",
            "Business",
            biz.id,
            { new_status: newStatus }
        );
        toast.success(`${biz.name} is now ${newStatus}.`);
        fetchBusinesses();
    };

    const stats = useMemo(() => {
        const active = businesses.filter((b) => b.subscription_status === "active").length;
        const trial = businesses.filter((b) => ["trial", "trialing"].includes(b.subscription_status)).length;
        const suspended = businesses.filter((b) => b.subscription_status === "suspended").length;
        const expiringSoon = businesses.filter((b) => {
            const d = daysUntil(b.subscription_end_date);
            return d !== null && d >= 0 && d <= 7;
        }).length;
        const expired = businesses.filter((b) => {
            const d = daysUntil(b.subscription_end_date);
            return d !== null && d < 0;
        }).length;
        const wallets = businesses.reduce((sum, b) => sum + Number(b.wallet_balance || 0), 0);
        return { active, trial, suspended, expiringSoon, expired, wallets };
    }, [businesses]);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        let rows = businesses.filter((b) => {
            if (q && !b.name?.toLowerCase().includes(q) && !b.id.includes(q)) return false;
            if (statusFilter === "all") return true;
            if (statusFilter === "expiring") {
                const d = daysUntil(b.subscription_end_date);
                return d !== null && d >= 0 && d <= 7;
            }
            if (statusFilter === "expired") {
                const d = daysUntil(b.subscription_end_date);
                return d !== null && d < 0;
            }
            if (statusFilter === "trial") return ["trial", "trialing"].includes(b.subscription_status);
            return b.subscription_status === statusFilter;
        });

        rows = [...rows].sort((a, b) => {
            if (sortKey === "name") return (a.name || "").localeCompare(b.name || "");
            if (sortKey === "wallet_balance") return Number(b.wallet_balance || 0) - Number(a.wallet_balance || 0);
            if (sortKey === "subscription_end_date") {
                const av = a.subscription_end_date ? new Date(a.subscription_end_date).getTime() : Infinity;
                const bv = b.subscription_end_date ? new Date(b.subscription_end_date).getTime() : Infinity;
                return av - bv;
            }
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        return rows;
    }, [businesses, query, statusFilter, sortKey]);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "active":
                return <Badge className="bg-green-500 hover:bg-green-600">Active</Badge>;
            case "trialing":
            case "trial":
                return <Badge variant="secondary">Trial</Badge>;
            case "suspended":
                return <Badge variant="destructive">Suspended</Badge>;
            default:
                return <Badge variant="outline">{status || "unknown"}</Badge>;
        }
    };

    const openDetail = (biz: BusinessRow) => {
        setSelected(biz);
        setDetailOpen(true);
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Businesses</h1>
                <p className="text-muted-foreground">
                    Full control over every tenant — subscriptions, wallets, team access and removal.
                </p>
            </div>

            {/* Portfolio at a glance */}
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
                <StatCard label="Total" value={businesses.length} icon={<Store className="h-4 w-4 text-muted-foreground" />} />
                <StatCard label="Active" value={stats.active} icon={<CheckCircle className="h-4 w-4 text-green-600" />} tone="text-green-600" />
                <StatCard label="On Trial" value={stats.trial} icon={<Clock className="h-4 w-4 text-blue-600" />} tone="text-blue-600" />
                <StatCard
                    label="Expiring ≤7d"
                    value={stats.expiringSoon}
                    icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
                    tone={stats.expiringSoon > 0 ? "text-amber-600" : undefined}
                    onClick={() => setStatusFilter("expiring")}
                />
                <StatCard
                    label="Wallets"
                    value={`${stats.wallets.toLocaleString()} EGP`}
                    icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
                    small
                />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Store className="h-5 w-5 text-primary" />
                        All Registered Businesses
                    </CardTitle>
                    <CardDescription>
                        Click any row for the full control panel: subscription, wallet, team and danger zone.
                    </CardDescription>

                    <div className="flex flex-col sm:flex-row gap-3 pt-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search by name or id…"
                                className="pl-9"
                            />
                        </div>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-full sm:w-48">
                                <SlidersHorizontal className="h-4 w-4 me-2" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All statuses</SelectItem>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="trial">Trial</SelectItem>
                                <SelectItem value="suspended">Suspended</SelectItem>
                                <SelectItem value="expiring">Expiring ≤ 7 days</SelectItem>
                                <SelectItem value="expired">Expired</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                            <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="created_at">Newest first</SelectItem>
                                <SelectItem value="name">Name A–Z</SelectItem>
                                <SelectItem value="subscription_end_date">Expiring soonest</SelectItem>
                                <SelectItem value="wallet_balance">Largest wallet</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>

                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Business</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Subscription</TableHead>
                                        <TableHead>Wallet</TableHead>
                                        <TableHead>Team</TableHead>
                                        <TableHead>Joined</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {visible.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center p-10 text-muted-foreground">
                                                {businesses.length === 0 ? "No businesses found." : "No businesses match these filters."}
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        visible.map((biz) => {
                                            const left = daysUntil(biz.subscription_end_date);
                                            return (
                                                <TableRow
                                                    key={biz.id}
                                                    className="cursor-pointer"
                                                    onClick={() => openDetail(biz)}
                                                >
                                                    <TableCell>
                                                        <div className="font-medium">{biz.name}</div>
                                                        <div className="text-[10px] text-muted-foreground font-mono">{biz.id.slice(0, 8)}</div>
                                                    </TableCell>
                                                    <TableCell>{getStatusBadge(biz.subscription_status)}</TableCell>
                                                    <TableCell>
                                                        {biz.subscription_end_date ? (
                                                            <div>
                                                                <div className="text-sm">
                                                                    {new Date(biz.subscription_end_date).toLocaleDateString()}
                                                                </div>
                                                                <div className={cn(
                                                                    "text-xs font-medium",
                                                                    left === null ? "text-muted-foreground"
                                                                        : left < 0 ? "text-red-600"
                                                                        : left <= 7 ? "text-amber-600"
                                                                        : "text-muted-foreground"
                                                                )}>
                                                                    {left === null ? "" : left < 0 ? `expired ${Math.abs(left)}d ago` : `${left}d left`}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <span className="text-muted-foreground text-sm">—</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="tabular-nums text-sm">
                                                        {Number(biz.wallet_balance || 0).toLocaleString()} EGP
                                                    </TableCell>
                                                    <TableCell className="tabular-nums text-sm">{memberCounts[biz.id] || 0}</TableCell>
                                                    <TableCell className="text-sm">{new Date(biz.created_at).toLocaleDateString()}</TableCell>
                                                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex justify-end gap-2">
                                                            <Button size="sm" variant="secondary" onClick={() => impersonateBusiness(biz.id)}>
                                                                <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
                                                            </Button>
                                                            {biz.subscription_status !== "active" ? (
                                                                <Button
                                                                    size="sm" variant="outline"
                                                                    className="text-green-600 border-green-200 hover:bg-green-50"
                                                                    onClick={() => updateStatus(biz, "active")}
                                                                >
                                                                    <CheckCircle className="mr-1 h-3.5 w-3.5" /> Activate
                                                                </Button>
                                                            ) : (
                                                                <Button
                                                                    size="sm" variant="outline"
                                                                    className="text-red-600 border-red-200 hover:bg-red-50"
                                                                    onClick={() => updateStatus(biz, "suspended")}
                                                                >
                                                                    <XCircle className="mr-1 h-3.5 w-3.5" /> Suspend
                                                                </Button>
                                                            )}
                                                            <Button size="sm" variant="ghost" onClick={() => openDetail(biz)}>
                                                                Manage
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <BusinessDetailDialog
                business={selected}
                open={detailOpen}
                onOpenChange={setDetailOpen}
                onChanged={fetchBusinesses}
            />
        </div>
    );
}

function StatCard({
    label, value, icon, tone, small, onClick,
}: {
    label: string;
    value: string | number;
    icon: React.ReactNode;
    tone?: string;
    small?: boolean;
    onClick?: () => void;
}) {
    return (
        <Card
            className={cn(onClick && "cursor-pointer hover:border-primary/40 transition-colors")}
            onClick={onClick}
        >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {label}
                </CardTitle>
                {icon}
            </CardHeader>
            <CardContent>
                <div className={cn(small ? "text-lg" : "text-3xl", "font-bold tabular-nums", tone)}>{value}</div>
            </CardContent>
        </Card>
    );
}
