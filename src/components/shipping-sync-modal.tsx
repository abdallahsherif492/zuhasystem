"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { previewShippingSyncAction, applyShippingUpdatesAction, SyncPreviewItem } from "@/app/(dashboard)/orders/sync-actions";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { Label } from "@/components/ui/label";

interface ShippingSyncModalProps {
    businessId: string;
    onSyncComplete: () => void;
}

export function ShippingSyncModal({ businessId, onSyncComplete }: ShippingSyncModalProps) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [applying, setApplying] = useState(false);
    const [updates, setUpdates] = useState<SyncPreviewItem[]>([]);
    const [fetched, setFetched] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [shippingCompanies, setShippingCompanies] = useState<any[]>([]);
    const [selectedCompanyId, setSelectedCompanyId] = useState("");

    const handleOpen = async (isOpen: boolean) => {
        setOpen(isOpen);
        if (isOpen && !fetched) {
            fetchCompanies();
            await fetchPreview();
        }
    };

    const fetchCompanies = async () => {
        const { data } = await supabase.from('shipping_companies').select('*').eq('business_id', businessId).eq('active', true).order('name');
        if (data) setShippingCompanies(data);
    };

    const fetchPreview = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await previewShippingSyncAction(businessId);
            if (result.error) {
                setError(result.error);
            } else {
                setUpdates(result.updates);
                setFetched(true);
            }
        } catch (err: any) {
            setError(err.message || "Failed to fetch updates");
        } finally {
            setLoading(false);
        }
    };

    const hasShippedUpdate = updates.some(u => u.newStatus === "Shipped");

    const handleApply = async () => {
        if (updates.length === 0) {
            setOpen(false);
            return;
        }

        if (hasShippedUpdate && !selectedCompanyId) {
            toast.error(t("Please select a shipping company for the shipped orders"));
            return;
        }
        
        setApplying(true);
        try {
            const result = await applyShippingUpdatesAction(updates, businessId, selectedCompanyId);
            if (result.success) {
                toast.success(t("Shipping statuses updated successfully"));
                onSyncComplete();
                setOpen(false);
                setFetched(false); // Reset for next time
            } else {
                toast.error(result.error || t("Failed to apply updates"));
            }
        } catch (err: any) {
            toast.error(err.message || t("Failed to apply updates"));
        } finally {
            setApplying(false);
        }
    };

    const resetState = () => {
        setFetched(false);
        setUpdates([]);
        setError(null);
        setSelectedCompanyId("");
    };

    const summaryCounts = updates.reduce((acc, curr) => {
        const key = `${curr.oldStatus} ➡️ ${curr.newStatus}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    return (
        <Dialog open={open} onOpenChange={(val) => {
            if (!val) resetState();
            handleOpen(val);
        }}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <RefreshCw className="h-4 w-4" />
                    {t("Sync Shipping")}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle>{t("Sync Shipping Status")}</DialogTitle>
                    <DialogDescription>
                        {t("Fetching the latest status for active orders from Accurate Express.")}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto py-4">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">{t("Checking for updates...")}</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-4 text-destructive">
                            <AlertCircle className="h-8 w-8" />
                            <p className="text-sm font-medium">{error}</p>
                            <Button variant="outline" onClick={fetchPreview}>{t("Try Again")}</Button>
                        </div>
                    ) : fetched && updates.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                            <p className="text-sm font-medium">{t("All orders are up to date.")}</p>
                        </div>
                    ) : fetched && updates.length > 0 ? (
                        <div className="flex flex-col gap-4">
                            <div className="bg-muted/50 p-3 rounded-md border flex flex-wrap gap-3">
                                {Object.entries(summaryCounts).map(([key, count]) => {
                                    const [oldS, newS] = key.split(' ➡️ ');
                                    return (
                                        <Badge key={key} variant="secondary" className="px-3 py-1 flex gap-2 items-center">
                                            <span className="font-normal opacity-70">{count}x</span>
                                            <span className="text-xs">{t(oldS)} ➡️ {t(newS)}</span>
                                        </Badge>
                                    );
                                })}
                            </div>
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t("Customer")}</TableHead>
                                            <TableHead>{t("Accurate Status")}</TableHead>
                                            <TableHead>{t("Old Status")}</TableHead>
                                            <TableHead>{t("New Status")}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {updates.map((item) => (
                                            <TableRow key={item.orderId}>
                                                <TableCell className="font-medium">
                                                    {item.customerName || t("Unknown")}
                                                    <div className="text-xs text-muted-foreground font-mono">{item.orderId.substring(0,8)}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <span className="text-xs">{item.accurateStatusName}</span>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className="text-xs">{t(item.oldStatus)}</Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-none text-xs">
                                                        {t(item.newStatus)}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            
                            {hasShippedUpdate && (
                                <div className="bg-blue-50 border border-blue-100 p-4 rounded-md space-y-2 mt-2">
                                    <div className="flex items-center gap-2 text-blue-800">
                                        <AlertCircle className="h-4 w-4" />
                                        <h4 className="text-sm font-semibold">{t("Shipping Company Required")}</h4>
                                    </div>
                                    <p className="text-xs text-blue-700">
                                        {t("Some orders are transitioning to Shipped. Please select the shipping company to assign them to.")}
                                    </p>
                                    <div className="pt-2 max-w-sm">
                                        <Label className="text-xs mb-1 block text-blue-900">{t("Shipping Company")}</Label>
                                        <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                                            <SelectTrigger className="bg-white">
                                                <SelectValue placeholder={t("Select a company")} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {shippingCompanies.map(c => (
                                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : null}
                </div>

                <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={applying}>
                        {t("Cancel")}
                    </Button>
                    <Button 
                        onClick={handleApply} 
                        disabled={loading || applying || (!loading && fetched && updates.length === 0)}
                        className="gap-2"
                    >
                        {applying && <RefreshCw className="h-3 w-3 animate-spin" />}
                        {t("Apply Updates")} ({updates.length})
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
