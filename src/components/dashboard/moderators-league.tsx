"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Trophy, Target, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface LeagueRow {
    closed_by: string;
    orders_count: number;
    items_count: number;
    items_per_order: number;
    sales_value: number;
    delivered_count: number;
    returned_count: number;
    delivery_rate: number | null;
}

interface Targets {
    orders_target: number;
    delivery_rate_target: number;
    items_per_order_target: number;
}

const DEFAULT_TARGETS: Targets = {
    orders_target: 2000,
    delivery_rate_target: 86,
    items_per_order_target: 1.5,
};

/** First instant of the current month, and of the next one. */
function monthBounds() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { from, to, monthKey: format(from, "yyyy-MM-dd") };
}

/**
 * Moderator standings for the current month.
 *
 * Two things at once, deliberately: progress against the month's target, and a
 * ranking that rewards cross-selling. Ranking on order count alone would tell
 * moderators to take as many orders as possible and say nothing about whether
 * they offered the customer a second product, so items per order is shown as
 * its own column with its own leader.
 */
export function ModeratorsLeague() {
    const { activeBusiness } = useBusiness();
    const { t } = useLanguage();

    const [rows, setRows] = useState<LeagueRow[]>([]);
    const [targets, setTargets] = useState<Targets>(DEFAULT_TARGETS);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [draft, setDraft] = useState<Targets>(DEFAULT_TARGETS);
    const [saving, setSaving] = useState(false);

    const { from, to, monthKey } = useMemo(monthBounds, []);

    const load = useCallback(async () => {
        if (!activeBusiness) return;
        setLoading(true);
        try {
            const [leagueRes, targetRes] = await Promise.all([
                supabase.rpc("get_moderator_league", {
                    p_business_id: activeBusiness.id,
                    p_from: from.toISOString(),
                    p_to: to.toISOString(),
                }),
                supabase
                    .from("moderator_targets")
                    .select("orders_target, delivery_rate_target, items_per_order_target")
                    .eq("business_id", activeBusiness.id)
                    .eq("month", monthKey)
                    .maybeSingle(),
            ]);

            if (leagueRes.error) throw leagueRes.error;
            setRows((leagueRes.data || []) as LeagueRow[]);
            if (targetRes.data) setTargets(targetRes.data as Targets);
        } catch (e: any) {
            console.error("Moderators league failed to load:", e);
            toast.error(t("Failed to load the moderators league"));
        } finally {
            setLoading(false);
        }
    }, [activeBusiness, from, to, monthKey, t]);

    useEffect(() => { load(); }, [load]);

    // Totals come from the same rows the table shows, so the progress bar can
    // never disagree with the standings underneath it.
    const totals = useMemo(() => {
        const orders = rows.reduce((s, r) => s + Number(r.orders_count || 0), 0);
        const items = rows.reduce((s, r) => s + Number(r.items_count || 0), 0);
        const sales = rows.reduce((s, r) => s + Number(r.sales_value || 0), 0);
        const delivered = rows.reduce((s, r) => s + Number(r.delivered_count || 0), 0);
        const returned = rows.reduce((s, r) => s + Number(r.returned_count || 0), 0);
        const resolved = delivered + returned;
        return {
            orders, items, sales, delivered, returned,
            deliveryRate: resolved ? (100 * delivered) / resolved : null,
            itemsPerOrder: orders ? items / orders : 0,
        };
    }, [rows]);

    // Only rows with enough orders to mean something can win the cross-sell
    // prize — one order with three items is not a track record.
    const CROSS_SELL_MIN_ORDERS = 10;
    const crossSellLeader = useMemo(() => {
        const eligible = rows.filter(r => Number(r.orders_count) >= CROSS_SELL_MIN_ORDERS);
        if (!eligible.length) return null;
        return eligible.reduce((best, r) =>
            Number(r.items_per_order) > Number(best.items_per_order) ? r : best);
    }, [rows]);

    async function saveTargets() {
        if (!activeBusiness) return;
        setSaving(true);
        try {
            const { error } = await supabase
                .from("moderator_targets")
                .upsert({
                    business_id: activeBusiness.id,
                    month: monthKey,
                    orders_target: Math.max(0, Math.round(draft.orders_target)),
                    delivery_rate_target: Math.min(100, Math.max(0, draft.delivery_rate_target)),
                    items_per_order_target: Math.max(0, draft.items_per_order_target),
                    updated_at: new Date().toISOString(),
                }, { onConflict: "business_id,month" });
            if (error) throw error;
            toast.success(t("Targets saved"));
            setDialogOpen(false);
            load();
        } catch (e: any) {
            toast.error(e.message || t("Failed to save targets"));
        } finally {
            setSaving(false);
        }
    }

    const ordersPct = targets.orders_target
        ? Math.min(100, (totals.orders / targets.orders_target) * 100) : 0;
    const ratePct = targets.delivery_rate_target && totals.deliveryRate !== null
        ? Math.min(100, (totals.deliveryRate / targets.delivery_rate_target) * 100) : 0;

    return (
        <Card id="moderators-league">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <Trophy className="h-5 w-5 text-amber-500" />
                        {t("Moderators League")}
                    </CardTitle>
                    <CardDescription>
                        {format(from, "MMMM yyyy")} — {t("orders confirmed with customers this month")}
                    </CardDescription>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setDraft(targets); setDialogOpen(true); }}
                >
                    <Settings2 className="h-4 w-4 mr-2" />
                    {t("Targets")}
                </Button>
            </CardHeader>

            <CardContent className="space-y-6">
                {/* Progress against the month */}
                <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                        <div className="flex items-baseline justify-between text-sm">
                            <span className="text-muted-foreground">{t("Orders")}</span>
                            <span className="font-semibold">
                                {totals.orders.toLocaleString()} / {targets.orders_target.toLocaleString()}
                            </span>
                        </div>
                        <Progress value={ordersPct} />
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-baseline justify-between text-sm">
                            <span className="text-muted-foreground">{t("Delivery rate")}</span>
                            <span className={cn(
                                "font-semibold",
                                totals.deliveryRate !== null && totals.deliveryRate >= targets.delivery_rate_target
                                    ? "text-emerald-600" : "text-amber-600"
                            )}>
                                {totals.deliveryRate === null ? "—" : `${totals.deliveryRate.toFixed(1)}%`}
                                {" / "}{targets.delivery_rate_target}%
                            </span>
                        </div>
                        <Progress value={ratePct} />
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-baseline justify-between text-sm">
                            <span className="text-muted-foreground">{t("Items per order")}</span>
                            <span className={cn(
                                "font-semibold",
                                totals.itemsPerOrder >= targets.items_per_order_target
                                    ? "text-emerald-600" : "text-amber-600"
                            )}>
                                {totals.itemsPerOrder.toFixed(2)} / {targets.items_per_order_target}
                            </span>
                        </div>
                        <Progress value={targets.items_per_order_target
                            ? Math.min(100, (totals.itemsPerOrder / targets.items_per_order_target) * 100) : 0} />
                    </div>
                </div>

                {/* Standings */}
                {loading ? (
                    <div className="py-10 flex justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : rows.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground space-y-1">
                        <p>{t("No orders have been attributed to a moderator yet this month.")}</p>
                        <p className="text-xs">
                            {t("Pick who closed the order in Platform Orders, or when creating and editing an order.")}
                        </p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[40px]">#</TableHead>
                                <TableHead>{t("Moderator")}</TableHead>
                                <TableHead className="text-right">{t("Orders")}</TableHead>
                                <TableHead className="text-right hidden sm:table-cell">{t("Items")}</TableHead>
                                <TableHead className="text-right">{t("Items / order")}</TableHead>
                                <TableHead className="text-right hidden lg:table-cell">{t("Delivery rate")}</TableHead>
                                <TableHead className="text-right">{t("Sales")}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((r, i) => {
                                const isCrossSellLeader = crossSellLeader?.closed_by === r.closed_by;
                                return (
                                    <TableRow key={r.closed_by}>
                                        <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate max-w-[220px]">{r.closed_by}</span>
                                                {isCrossSellLeader && (
                                                    <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 shrink-0">
                                                        <Target className="h-3 w-3 mr-1" />
                                                        {t("Cross-sell")}
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="sm:hidden text-xs text-muted-foreground">
                                                {Number(r.items_count).toLocaleString()} {t("items")}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-semibold">
                                            {Number(r.orders_count).toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right hidden sm:table-cell">
                                            {Number(r.items_count).toLocaleString()}
                                        </TableCell>
                                        <TableCell className={cn(
                                            "text-right font-semibold",
                                            Number(r.items_per_order) >= targets.items_per_order_target
                                                ? "text-emerald-600" : "text-muted-foreground"
                                        )}>
                                            {Number(r.items_per_order).toFixed(2)}
                                        </TableCell>
                                        <TableCell className="text-right hidden lg:table-cell">
                                            {r.delivery_rate === null ? (
                                                <span className="text-muted-foreground">—</span>
                                            ) : (
                                                <span className={cn(
                                                    Number(r.delivery_rate) >= targets.delivery_rate_target
                                                        ? "text-emerald-600" : "text-amber-600"
                                                )}>
                                                    {Number(r.delivery_rate).toFixed(1)}%
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">{formatCurrency(Number(r.sales_value))}</TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}

                {rows.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                        {t("Delivery rate counts delivered against returned. Cancelled orders are left out — the parcel never shipped, so it is not a failed delivery. Orders with nobody assigned do not appear here.")}
                    </p>
                )}
            </CardContent>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("Targets for")} {format(from, "MMMM yyyy")}</DialogTitle>
                        <DialogDescription>
                            {t("Team-wide for the month. Each month keeps its own targets, so changing these does not rewrite past months.")}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>{t("Total orders")}</Label>
                            <Input
                                type="number"
                                value={draft.orders_target}
                                onChange={e => setDraft({ ...draft, orders_target: Number(e.target.value) })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{t("Delivery rate (%)")}</Label>
                            <Input
                                type="number" step="0.1"
                                value={draft.delivery_rate_target}
                                onChange={e => setDraft({ ...draft, delivery_rate_target: Number(e.target.value) })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{t("Items per order")}</Label>
                            <Input
                                type="number" step="0.1"
                                value={draft.items_per_order_target}
                                onChange={e => setDraft({ ...draft, items_per_order_target: Number(e.target.value) })}
                            />
                            <p className="text-xs text-muted-foreground">
                                {t("The cross-sell goal. A rate rather than a count, so it cannot be won by simply taking more orders.")}
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("Cancel")}</Button>
                        <Button onClick={saveTargets} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {t("Save")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
