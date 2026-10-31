import { HandCoins, PackageCheck, PackageX, PackageSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeliveryRate } from "@/lib/easyorders-delivery-rate";

/**
 * EasyOrders' rating of how likely the customer is to accept the parcel, next
 * to their name on a waiting order, and what the caller should do about it.
 *
 * Measured on Zuha's orders from 15 Sep – 20 Oct 2026 (300 sampled from
 * 1,000 closed, weighted back to the whole): about 1 in 5 of "high" and
 * "unknown" came back, against about 1 in 3 of "low" and nearly 2 in 5 of
 * "moderate". So both low and moderate are worth a deposit; low is the one to
 * insist on.
 */

const LOOK: Record<DeliveryRate, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
    high: {
        label: "احتمال الاستلام عالي",
        icon: PackageCheck,
        className: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
    },
    moderate: {
        label: "احتمال الاستلام متوسط",
        icon: PackageSearch,
        className: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
    },
    low: {
        label: "احتمال الاستلام ضعيف",
        icon: PackageX,
        className: "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
    },
    unknown: {
        label: "احتمال الاستلام غير معروف",
        icon: PackageSearch,
        className: "border-border bg-muted/50 text-muted-foreground",
    },
};

export function DeliveryRateBadge({ rate }: { rate: DeliveryRate | null }) {
    if (!rate) return null;
    const { label, icon: Icon, className } = LOOK[rate];
    return (
        <span
            dir="rtl"
            title="تقييم إيزي أوردرز للعميل من تاريخ استلامه في كل المتاجر"
            className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", className)}
        >
            <Icon className="h-3.5 w-3.5" />
            {label}
        </span>
    );
}

/** For low and moderate only: the deposit, said plainly before the call. */
export function DeliveryRateAdvice({ rate }: { rate: DeliveryRate | null }) {
    if (rate !== "low" && rate !== "moderate") return null;
    const low = rate === "low";
    return (
        <div
            dir="rtl"
            className={cn(
                "flex items-start gap-2 rounded-md border p-2.5 text-sm",
                low ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                    : "border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300",
            )}
        >
            <HandCoins className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
                {low ? (
                    <><b>العميل ده احتمال استلامه ضعيف.</b> الأفضل تاخد منه عربون (ديبوزت) قبل ما تأكد الأوردر — ولو رفض، اتأكد من العنوان والميعاد كويس قبل الشحن.</>
                ) : (
                    <><b>احتمال استلامه متوسط.</b> يفضّل تطلب عربون (ديبوزت)، خصوصًا لو الأوردر كبير أو العميل متردد.</>
                )}
            </span>
        </div>
    );
}
