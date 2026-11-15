"use client";

import { ChevronUp, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** "425 ج.م": whole pounds, as said on the phone. */
export const egp = (n: number | null | undefined) => `${Math.round(Number(n) || 0).toLocaleString("en-US")} ج.م`;

export interface SummaryItem {
    id: string;
    variant_id: string | null;
    quantity: number;
    price_at_sale: number;
    unmapped_name?: string | null;
    variants?: { title?: string | null; products?: { name?: string | null } | null } | null;
}

const nameOf = (i: SummaryItem) => i.variant_id
    ? [i.variants?.products?.name, i.variants?.title && !/^default/i.test(i.variants.title.trim()) ? i.variants.title : null].filter(Boolean).join(" · ")
    : i.unmapped_name || "منتج مش متربط";

/**
 * The order as the moderator reads it out to the customer: what, how many,
 * how much, and where to. The fields to change any of it open on «تعديل».
 */
export function OrderSummary({ items, shipping, paid, place, note, internalNote, editing, onToggle }: {
    items: SummaryItem[];
    shipping: number;
    paid?: number | null;
    place?: string;
    note?: string | null;
    internalNote?: string | null;
    editing: boolean;
    onToggle: () => void;
}) {
    const pieces = items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);
    return (
        <section dir="rtl" aria-label="الأوردر" className="mt-5 space-y-2.5 border-t px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-2">
                <h4 className="text-base font-bold">الأوردر <span className="font-medium text-muted-foreground">({pieces} {pieces === 1 ? "قطعة" : "قطع"})</span></h4>
                <Button variant="outline" size="sm" onClick={onToggle} aria-expanded={editing} className="h-10 gap-1.5 text-sm font-semibold">
                    {editing ? <><ChevronUp className="h-4 w-4" />اقفل التعديل</> : <><Pencil className="h-4 w-4" />تعديل الأوردر</>}
                </Button>
            </div>
            <ul className="space-y-1.5 text-[15px]">
                {items.map(i => (
                    <li key={i.id} className={cn("flex items-start justify-between gap-4", !i.variant_id && "font-semibold text-red-700 dark:text-red-400")}>
                        <span className="flex min-w-0 items-start gap-2">
                            <span className="mt-px shrink-0 rounded-md bg-muted px-1.5 text-sm font-bold tabular-nums" dir="ltr">{i.quantity}×</span>
                            <span className="min-w-0">{nameOf(i)}</span>
                        </span>
                        <span className="shrink-0 font-medium tabular-nums">{egp((Number(i.price_at_sale) || 0) * (Number(i.quantity) || 0))}</span>
                    </li>
                ))}
                <li className="flex justify-between gap-4 text-muted-foreground">
                    <span>الشحن</span><span className="tabular-nums">{egp(shipping)}</span>
                </li>
                {Number(paid) > 0 && (
                    <li className="flex justify-between gap-4 font-medium text-emerald-700 dark:text-emerald-400">
                        <span>مدفوع مقدّم</span><span className="tabular-nums">{egp(paid)}</span>
                    </li>
                )}
            </ul>
            {place && <p className="text-[15px]"><span className="text-muted-foreground">العنوان: </span>{place}</p>}
            {note && <p className="text-[15px]"><span className="text-muted-foreground">ملاحظة على الأوردر: </span>{note}</p>}
            {internalNote && <p className="text-[15px]"><span className="text-muted-foreground">ملاحظة داخلية: </span>{internalNote}</p>}
        </section>
    );
}
