"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CANCEL_REASONS, type CancelReason } from "@/lib/orders/cancel-reasons";

/**
 * Cancelling a store order: why must be picked, and for "other", written.
 * The reason stays on the order, so the cancellations page can tell an order
 * the customer refused from one nobody tried hard enough on.
 */
export function CancelOrderDialog({ customerName, open, onOpenChange, onConfirm }: {
    customerName: string;
    open: boolean;
    onOpenChange: (o: boolean) => void;
    onConfirm: (reason: CancelReason, note: string | null) => Promise<void> | void;
}) {
    const [reason, setReason] = useState<CancelReason | null>(null);
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);
    const needsNote = reason === "other";

    const close = (o: boolean) => {
        if (saving) return;
        if (!o) { setReason(null); setNote(""); }
        onOpenChange(o);
    };

    const confirm = async () => {
        if (!reason || (needsNote && !note.trim())) return;
        setSaving(true);
        try {
            await onConfirm(reason, note.trim() || null);
            setReason(null); setNote("");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent dir="rtl" className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>إلغاء أوردر {customerName}</DialogTitle>
                    <DialogDescription>
                        اختار ليه اتلغى. لو اتلغى عشان مابيردش من غير محاولات كفاية، ممكن يرجع تاني للتأكيد.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="سبب الإلغاء">
                    {CANCEL_REASONS.map(r => (
                        <button
                            key={r.key}
                            type="button"
                            role="radio"
                            aria-checked={reason === r.key}
                            onClick={() => setReason(r.key)}
                            className={cn(
                                "rounded-lg border p-2.5 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                reason === r.key ? "border-destructive bg-destructive/5 ring-1 ring-destructive" : "hover:bg-muted/60",
                            )}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
                <Textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={2}
                    placeholder={needsNote ? "اكتب السبب" : "تفاصيل (اختياري)"}
                    className={cn(needsNote && !note.trim() && "border-amber-400")}
                />
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => close(false)} disabled={saving}>رجوع</Button>
                    <Button variant="destructive" onClick={confirm} disabled={saving || !reason || (needsNote && !note.trim())}>
                        {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}الغي الأوردر
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
