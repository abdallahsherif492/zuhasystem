"use client";

import Link from "next/link";
import { AlertTriangle, Repeat } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn, formatCurrency } from "@/lib/utils";
import type { RelatedOrder, RepeatInfo } from "@/lib/orders/repeat-orders";

/** Enough to see the pattern; a number with a dozen attempts says so in the count. */
const SHOWN = 4;

function statusTone(status: string) {
    switch (status.trim().toLowerCase()) {
        case "cancelled":
            return "bg-muted text-muted-foreground";
        case "delivered":
        case "collected":
            return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
        case "returned":
        case "returning":
            return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300";
        default:
            // Still open: the state that can still turn into a second parcel.
            return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
    }
}

/** "3 minutes before", in the reader's language, since the gap is what tells a double submit from a re-order. */
function gapLabel(ms: number, ar: boolean): string {
    const minutes = Math.round(Math.abs(ms) / 60_000);
    const before = ms < 0;
    if (minutes < 1) return ar ? "في نفس الدقيقة" : "same minute";

    let n: number;
    let unit: "m" | "h" | "d";
    if (minutes < 60) { n = minutes; unit = "m"; }
    else if (minutes < 60 * 24) { n = Math.round(minutes / 60); unit = "h"; }
    else { n = Math.round(minutes / 1440); unit = "d"; }

    if (!ar) {
        const word = unit === "m" ? "min" : unit === "h" ? (n === 1 ? "hour" : "hours") : (n === 1 ? "day" : "days");
        return `${n} ${word} ${before ? "before" : "after"}`;
    }
    // One and two take their own forms; three to ten the plural; eleven up the singular.
    const [one, two, few, many] = {
        m: ["دقيقة", "دقيقتين", "دقايق", "دقيقة"],
        h: ["ساعة", "ساعتين", "ساعات", "ساعة"],
        d: ["يوم", "يومين", "أيام", "يوم"],
    }[unit];
    const amount = n === 1 ? `ب${one}` : n === 2 ? `ب${two}` : `بـ ${n} ${n <= 10 ? few : many}`;
    return `${before ? "قبله" : "بعده"} ${amount}`;
}

function RelatedLine({ r, onPage }: { r: RelatedOrder; onPage: boolean }) {
    const { t, language } = useLanguage();
    const ref = `#${r.id.slice(0, 8)}`;
    const items = r.items.map(i => (i.quantity > 1 ? `${i.name} × ${i.quantity}` : i.name)).join("، ");
    const linkClass = "font-mono font-semibold underline underline-offset-2";

    return (
        <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {/* Another card on this screen is a scroll away; anything else opens
                beside the list rather than replacing it. */}
            {onPage ? (
                <a href={`#po-${r.id}`} className={linkClass}>{ref}</a>
            ) : (
                <Link href={`/orders/${r.id}`} target="_blank" className={linkClass}>{ref}</Link>
            )}
            <span className={cn("rounded px-1.5 py-px text-[10px] font-semibold", statusTone(r.status))}>
                {r.status}
            </span>
            <span>{gapLabel(r.gapMs, language === "ar")}</span>
            <span className="tabular-nums">{formatCurrency(r.total_amount)}</span>
            <span className="opacity-70">{r.source}</span>
            {r.sameProduct && (
                <span className="rounded bg-red-600/10 px-1.5 py-px text-[10px] font-semibold text-red-700 dark:text-red-300">
                    {t("Same product")}
                </span>
            )}
            {/* dir="auto": catalogue names are mostly English, and inside the
                Arabic layout they were cut from the front, hiding the one
                word that identifies the product. */}
            {items && <span dir="auto" className="basis-full truncate opacity-80">{items}</span>}
        </li>
    );
}

/**
 * The other orders on this number, as a box on the order itself.
 *
 * Red when this order and another one can both still ship — confirm both and
 * the customer gets two parcels, and one usually comes back. Amber when the
 * others are finished: a cancelled attempt, a delivery or a return a few days
 * ago is context for the call, not a reason to stop.
 */
export function RepeatOrdersAlert({
    info, onPage, className,
}: {
    info: RepeatInfo;
    /** Orders rendered on the same screen, linked by anchor instead of a new tab. */
    onPage?: Set<string>;
    className?: string;
}) {
    const { t } = useLanguage();
    const { related, doubleRisk } = info;
    const more = related.length - SHOWN;

    return (
        <div
            role="alert"
            className={cn(
                "space-y-2 rounded-md border p-2.5 text-xs",
                doubleRisk
                    ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                    : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300",
                className,
            )}
        >
            <div className="flex items-start gap-2 font-semibold">
                {doubleRisk
                    ? <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
                    : <Repeat className="mt-px h-4 w-4 shrink-0" />}
                <span>
                    {doubleRisk
                        ? t("This number has another open order. Make sure it is not the same order before confirming, or it ships twice.")
                        : t("This number placed other orders recently.")}
                </span>
            </div>
            <ul className="space-y-1.5">
                {related.slice(0, SHOWN).map(r => (
                    <RelatedLine key={r.id} r={r} onPage={!!onPage?.has(r.id)} />
                ))}
            </ul>
            {more > 0 && (
                <p className="opacity-80">{t("and {n} more").replace("{n}", String(more))}</p>
            )}
        </div>
    );
}

/** The same warning, folded into a pill for a table row. */
export function RepeatOrdersBadge({ info }: { info: RepeatInfo }) {
    const { t } = useLanguage();
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        "mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                        info.doubleRisk
                            ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                            : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300",
                    )}
                >
                    {info.doubleRisk ? <AlertTriangle className="h-3 w-3" /> : <Repeat className="h-3 w-3" />}
                    <span>{info.doubleRisk ? t("Possible duplicate") : t("Repeat order")}</span>
                    <span className="tabular-nums">×{info.related.length + 1}</span>
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-0" align="start">
                <RepeatOrdersAlert info={info} className="border-0" />
            </PopoverContent>
        </Popover>
    );
}
