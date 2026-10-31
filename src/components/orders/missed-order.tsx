import { MousePointerClick, ShoppingBasket } from "lucide-react";

/**
 * A missed order on "New from stores": someone filled the store's order form
 * and left without ordering (20261101_missed_orders_in_queue.sql). It is
 * confirmed like any other order; these say what makes it different — the
 * customer has not ordered yet, so the call asks rather than confirms.
 */

export function MissedOrderTag() {
    return (
        <span
            dir="rtl"
            title="العميل كتب بياناته في فورم الطلب في المتجر ومكملش الطلب"
            className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
        >
            طلب ناقص
        </span>
    );
}

interface MissedInfo {
    missed_product?: string | null;
    missed_page?: string | null;
    missed_submitted?: boolean | null;
    missed_touches?: number | null;
}

export function MissedOrderNote({ info }: { info: MissedInfo | null | undefined }) {
    const product = (info?.missed_product || "").replace(/\s*\|\s*متجر.*$/, "").trim();
    return (
        <div dir="rtl" className="flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50/60 p-2.5 text-sm text-violet-950 dark:border-violet-900 dark:bg-violet-950/20 dark:text-violet-200">
            <ShoppingBasket className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-0.5">
                <p>
                    <b>مكملش الطلب في المتجر.</b> كلّمه واسأله لو لسه عايزه، واتأكد من المنتج والعدد قبل ما تأكد.
                </p>
                {product && (
                    <p className="truncate text-xs">
                        كان بيبص على:{" "}
                        {info?.missed_page
                            ? <a href={info.missed_page} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline">{product}</a>
                            : <span className="font-medium">{product}</span>}
                        {(info?.missed_touches ?? 1) > 1 && <span className="text-violet-700/80 dark:text-violet-300/80"> · رجع للمتجر {info?.missed_touches} مرات</span>}
                    </p>
                )}
                {info?.missed_submitted && (
                    <p className="flex items-center gap-1 text-xs font-medium">
                        <MousePointerClick className="h-3.5 w-3.5" />داس على زرار الطلب بس الأوردر ماوصلش
                    </p>
                )}
            </div>
        </div>
    );
}
