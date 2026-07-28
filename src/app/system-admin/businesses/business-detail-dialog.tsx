"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Save, Trash2, AlertTriangle, Wallet, CalendarClock, Users } from "lucide-react";
import { logAuditAction, AuditAction } from "@/lib/audit";
import { toast } from "sonner";

export interface BusinessRow {
    id: string;
    name: string;
    subscription_status: string;
    subscription_end_date: string | null;
    trial_ends_at: string | null;
    wallet_balance: number | null;
    created_at: string;
    logo_url: string | null;
}

interface Member {
    user_email: string;
    role: string;
    allowed_pages: string[] | null;
}

interface Usage {
    orders: number;
    products: number;
    customers: number;
}

const STATUSES = ["active", "trial", "trialing", "suspended", "expired"];

export function BusinessDetailDialog({
    business, open, onOpenChange, onChanged,
}: {
    business: BusinessRow | null;
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onChanged: () => void;
}) {
    const [name, setName] = useState("");
    const [status, setStatus] = useState("");
    const [endDate, setEndDate] = useState("");
    const [walletDelta, setWalletDelta] = useState("");
    const [extendDays, setExtendDays] = useState("30");
    const [saving, setSaving] = useState(false);

    const [members, setMembers] = useState<Member[]>([]);
    const [usage, setUsage] = useState<Usage | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);

    const [deleteConfirm, setDeleteConfirm] = useState("");
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        if (!business) return;
        setName(business.name || "");
        setStatus(business.subscription_status || "");
        setEndDate(business.subscription_end_date ? business.subscription_end_date.slice(0, 10) : "");
        setWalletDelta("");
        setExtendDays("30");
        setDeleteConfirm("");
    }, [business]);

    const loadDetail = useCallback(async () => {
        if (!business) return;
        setLoadingDetail(true);

        const [membersRes, orders, products, customers] = await Promise.all([
            supabase.from("business_users").select("user_email, role, allowed_pages").eq("business_id", business.id),
            supabase.from("orders").select("id", { count: "exact", head: true }).eq("business_id", business.id),
            supabase.from("products").select("id", { count: "exact", head: true }).eq("business_id", business.id),
            supabase.from("customers").select("id", { count: "exact", head: true }).eq("business_id", business.id),
        ]);

        setMembers((membersRes.data || []) as Member[]);
        setUsage({
            orders: orders.count ?? 0,
            products: products.count ?? 0,
            customers: customers.count ?? 0,
        });
        setLoadingDetail(false);
    }, [business]);

    useEffect(() => {
        if (open && business) loadDetail();
    }, [open, business, loadDetail]);

    if (!business) return null;

    const applyUpdate = async (patch: Record<string, any>, action: AuditAction, details: Record<string, any>) => {
        setSaving(true);
        const { error, data } = await supabase
            .from("businesses")
            .update(patch)
            .eq("id", business.id)
            .select();
        setSaving(false);

        if (error) {
            toast.error(`Failed: ${error.message}`);
            return false;
        }
        if (!data || data.length === 0) {
            toast.error("Update blocked — your admin account may lack write access (RLS).");
            return false;
        }

        await logAuditAction(action, "Business", business.id, details);
        toast.success("Saved.");
        onChanged();
        return true;
    };

    const saveProfile = () =>
        applyUpdate({ name: name.trim() }, "BUSINESS_RENAMED", { from: business.name, to: name.trim() });

    const saveSubscription = () =>
        applyUpdate(
            {
                subscription_status: status,
                subscription_end_date: endDate ? new Date(endDate).toISOString() : null,
            },
            "BUSINESS_SUBSCRIPTION_UPDATED",
            { status, subscription_end_date: endDate || null }
        );

    const extendBy = async (days: number) => {
        const base = business.subscription_end_date ? new Date(business.subscription_end_date) : new Date();
        // Never extend from a date already in the past — that would silently
        // grant less time than the admin asked for.
        const from = base.getTime() > Date.now() ? base : new Date();
        const next = new Date(from.getTime() + days * 86_400_000);

        const ok = await applyUpdate(
            { subscription_end_date: next.toISOString() },
            "BUSINESS_SUBSCRIPTION_EXTENDED",
            { days, new_end: next.toISOString() }
        );
        if (ok) setEndDate(next.toISOString().slice(0, 10));
    };

    const adjustWallet = async () => {
        const delta = Number(walletDelta);
        if (!walletDelta || Number.isNaN(delta)) {
            toast.error("Enter an amount (use a negative number to deduct).");
            return;
        }
        const next = Number(business.wallet_balance || 0) + delta;
        const ok = await applyUpdate({ wallet_balance: next }, "BUSINESS_WALLET_ADJUSTED", {
            delta,
            from: business.wallet_balance || 0,
            to: next,
        });
        if (ok) setWalletDelta("");
    };

    const deleteBusiness = async () => {
        setDeleting(true);
        const { error } = await supabase.from("businesses").delete().eq("id", business.id);
        setDeleting(false);

        if (error) {
            toast.error(`Delete failed: ${error.message}`);
            return;
        }
        await logAuditAction("BUSINESS_DELETED", "Business", business.id, { name: business.name });
        toast.success(`"${business.name}" deleted.`);
        onOpenChange(false);
        onChanged();
    };

    const daysLeft = business.subscription_end_date
        ? Math.ceil((new Date(business.subscription_end_date).getTime() - Date.now()) / 86_400_000)
        : null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-3">
                        {business.name}
                        <Badge variant="outline" className="font-mono text-[10px]">{business.id.slice(0, 8)}</Badge>
                    </DialogTitle>
                    <DialogDescription>
                        Joined {new Date(business.created_at).toLocaleDateString()}
                        {daysLeft !== null && (
                            <> · subscription {daysLeft >= 0 ? `ends in ${daysLeft} day(s)` : `expired ${Math.abs(daysLeft)} day(s) ago`}</>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="subscription" className="mt-2">
                    <TabsList>
                        <TabsTrigger value="subscription">Subscription</TabsTrigger>
                        <TabsTrigger value="team">Team &amp; Usage</TabsTrigger>
                        <TabsTrigger value="profile">Profile</TabsTrigger>
                        <TabsTrigger value="danger" className="text-red-600">Danger</TabsTrigger>
                    </TabsList>

                    {/* Subscription */}
                    <TabsContent value="subscription" className="space-y-6 pt-4">
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Status</Label>
                                <Select value={status} onValueChange={setStatus}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Subscription ends</Label>
                                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                            </div>
                        </div>
                        <Button onClick={saveSubscription} disabled={saving}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save subscription
                        </Button>

                        <div className="border-t pt-5 space-y-3">
                            <h4 className="font-semibold text-sm flex items-center gap-2">
                                <CalendarClock className="h-4 w-4 text-primary" /> Quick extend
                            </h4>
                            <p className="text-xs text-muted-foreground">
                                Extends from the current end date, or from today when it has already lapsed.
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                                {[7, 14, 30, 90, 365].map((d) => (
                                    <Button key={d} size="sm" variant="outline" disabled={saving} onClick={() => extendBy(d)}>
                                        +{d}d
                                    </Button>
                                ))}
                                <div className="flex items-center gap-2 ms-2">
                                    <Input
                                        type="number"
                                        value={extendDays}
                                        onChange={(e) => setExtendDays(e.target.value)}
                                        className="w-24 h-9"
                                    />
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={saving || !Number(extendDays)}
                                        onClick={() => extendBy(Number(extendDays))}
                                    >
                                        Extend
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="border-t pt-5 space-y-3">
                            <h4 className="font-semibold text-sm flex items-center gap-2">
                                <Wallet className="h-4 w-4 text-primary" /> Wallet
                            </h4>
                            <p className="text-sm">
                                Current balance:{" "}
                                <span className="font-bold tabular-nums">
                                    {Number(business.wallet_balance || 0).toLocaleString()} EGP
                                </span>
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                                <Input
                                    type="number"
                                    value={walletDelta}
                                    onChange={(e) => setWalletDelta(e.target.value)}
                                    placeholder="e.g. 500 or -200"
                                    className="w-44 h-9"
                                />
                                <Button size="sm" variant="secondary" onClick={adjustWallet} disabled={saving}>
                                    Apply adjustment
                                </Button>
                            </div>
                        </div>
                    </TabsContent>

                    {/* Team & usage */}
                    <TabsContent value="team" className="space-y-6 pt-4">
                        {loadingDetail ? (
                            <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                        ) : (
                            <>
                                <div className="grid grid-cols-3 gap-4">
                                    {[
                                        { label: "Orders", value: usage?.orders ?? 0 },
                                        { label: "Products", value: usage?.products ?? 0 },
                                        { label: "Customers", value: usage?.customers ?? 0 },
                                    ].map((s) => (
                                        <div key={s.label} className="rounded-lg border p-4 text-center">
                                            <div className="text-2xl font-bold tabular-nums">{s.value.toLocaleString()}</div>
                                            <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                                        </div>
                                    ))}
                                </div>

                                <div>
                                    <h4 className="font-semibold text-sm flex items-center gap-2 mb-3">
                                        <Users className="h-4 w-4 text-primary" /> Members ({members.length})
                                    </h4>
                                    <div className="rounded-md border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Email</TableHead>
                                                    <TableHead>Role</TableHead>
                                                    <TableHead>Pages</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {members.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                                                            No members.
                                                        </TableCell>
                                                    </TableRow>
                                                ) : members.map((m) => (
                                                    <TableRow key={m.user_email}>
                                                        <TableCell className="font-medium">{m.user_email}</TableCell>
                                                        <TableCell><Badge variant="secondary">{m.role}</Badge></TableCell>
                                                        <TableCell className="text-xs text-muted-foreground">
                                                            {m.allowed_pages?.length ? `${m.allowed_pages.length} page(s)` : "All"}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            </>
                        )}
                    </TabsContent>

                    {/* Profile */}
                    <TabsContent value="profile" className="space-y-4 pt-4">
                        <div className="space-y-2 max-w-sm">
                            <Label>Business name</Label>
                            <Input value={name} onChange={(e) => setName(e.target.value)} />
                        </div>
                        <Button onClick={saveProfile} disabled={saving || !name.trim() || name.trim() === business.name}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save name
                        </Button>
                    </TabsContent>

                    {/* Danger */}
                    <TabsContent value="danger" className="pt-4">
                        <div className="rounded-lg border-2 border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-5 space-y-4">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="font-bold text-red-800 dark:text-red-300">Delete this business</h4>
                                    <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                                        Permanently removes the tenant and everything cascading from it — orders,
                                        products, customers, transactions and team access. This cannot be undone.
                                    </p>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-red-800 dark:text-red-300 text-xs">
                                    Type <span className="font-mono font-bold">{business.name}</span> to confirm
                                </Label>
                                <Input
                                    value={deleteConfirm}
                                    onChange={(e) => setDeleteConfirm(e.target.value)}
                                    className="bg-white dark:bg-slate-950 max-w-sm"
                                />
                            </div>
                            <Button
                                variant="destructive"
                                disabled={deleteConfirm !== business.name || deleting}
                                onClick={deleteBusiness}
                            >
                                {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                Delete permanently
                            </Button>
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
