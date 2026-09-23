"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { importEasyOrdersProducts } from "@/app/(dashboard)/settings/easyorders-actions";

/** One tap: bring the store's EasyOrders products in, without typing them again. */
export function EasyOrdersImportButton({ businessId, className, onDone }: {
    businessId: string;
    className?: string;
    onDone?: () => void;
}) {
    const [busy, setBusy] = useState(false);

    async function run() {
        setBusy(true);
        try {
            const r = await importEasyOrdersProducts(businessId);
            if (!r.ok) {
                toast.error(r.error || "حصلت مشكلة في الاستيراد.");
                return;
            }
            if (!r.found) {
                toast.info("مالقيناش منتجات ظاهرة على متجرك في EasyOrders.");
            } else if (!r.imported) {
                toast.info(`كل منتجاتك (${r.found}) موجودة هنا بالفعل.`);
            } else {
                toast.success(`اتضاف ${r.imported} منتج من EasyOrders${r.skipped ? ` (${r.skipped} كانوا موجودين قبل كده)` : ""}.`);
                if (r.withoutCode) {
                    toast.warning(`${r.withoutCode} منتج مالهمش كود (SKU) على EasyOrders، فأوردراتهم هتحتاج تختار المنتج بإيدك أول مرة.`);
                }
            }
            if (r.failed) toast.error(`${r.failed} منتج ماتضافوش. جرّب تاني أو كلّمنا.`);
            onDone?.();
        } catch {
            toast.error("حصلت مشكلة في الاستيراد. جرّب تاني.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Button type="button" variant="outline" onClick={run} disabled={busy} className={className}>
            {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Download className="me-2 h-4 w-4" />}
            {busy ? "بنستورد منتجاتك..." : "استورد منتجاتي من EasyOrders"}
        </Button>
    );
}
