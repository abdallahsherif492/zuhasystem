"use client";

import { Fragment, useState } from "react";
import { formatCurrency, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface DuplicateCollection {
    kind: "repeated" | "over_total" | "check";
    match_key: string;
    order_id: string | null;
    reference: string;
    easyorders_id: string | null;
    customer_name: string | null;
    order_status: string | null;
    order_total: number | null;
    booked_total: number;
    suspect: number;
    txn_count: number;
    txns: { id: string; date: string; amount: number; category: string | null; account: string | null; description: string | null; created_at: string }[];
}

/**
 * Order collections that name the same order number in their description —
 * by hand as "EE7DD23D", from Platform Orders under the EasyOrders id — so the
 * same money booked twice is caught even when neither row is linked to the
 * order. Backed by get_duplicate_collections (20261011_duplicate_collections.sql).
 */
const KINDS: Record<DuplicateCollection["kind"], { label: string; note: string; tone: string }> = {
    repeated: {
        label: "نفس المبلغ اتسجل أكتر من مرة",
        note: "غالباً نفس الفلوس اتسجلت مرتين",
        tone: "text-destructive",
    },
    over_total: {
        label: "مجموعهم أكبر من إجمالي الأوردر",
        note: "مبالغ مختلفة بس مجموعها أكتر من الأوردر",
        tone: "text-amber-600",
    },
    check: {
        label: "أكتر من تحصيل على نفس الأوردر",
        note: "غالباً عربون والباقي، بس اتأكد",
        tone: "text-muted-foreground",
    },
};
const ORDER: DuplicateCollection["kind"][] = ["repeated", "over_total", "check"];

export function DuplicateCollections({ rows, missing }: { rows: DuplicateCollection[]; missing: boolean }) {
    const [show, setShow] = useState(false);
    const [open, setOpen] = useState<string | null>(null);

    const groups = ORDER
        .map(k => ({ k, rows: rows.filter(r => r.kind === k) }))
        .filter(g => g.rows.length > 0);

    return (
        <Card dir="rtl">
            <CardHeader>
                <CardTitle>تحصيلات أوردرات متكررة</CardTitle>
                <CardDescription>
                    تحصيلات الأوردرات اللي مكتوب في وصفها نفس رقم الأوردر أكتر من مرة. الرقم
                    بيتقري بأي شكل اتكتب بيه: الـ8 حروف بتوع الأوردر، كابيتال أو سمول، بعلامة #
                    أو من غيرها، أو رقم الأوردر على الموقع اللي بتكتبه شاشة أوردرات الموقع. فلو
                    التحصيل اتسجل من الموقع واتسجل تاني بإيدك، هيظهر هنا.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {missing ? (
                    <p className="text-sm text-muted-foreground">
                        شغّل مايجريشن <code className="text-xs">20261011_duplicate_collections.sql</code> عشان القسم ده يشتغل.
                    </p>
                ) : rows.length === 0 ? (
                    <p className="text-sm font-medium text-emerald-600">
                        مفيش رقم أوردر متكرر في تحصيلات الفترة دي.
                    </p>
                ) : (
                    <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-3">
                            {groups.map(g => (
                                <div key={g.k} className="rounded-lg border bg-muted/20 p-4">
                                    <p className="mb-1 text-xs text-muted-foreground">{KINDS[g.k].label}</p>
                                    <p className={cn("text-2xl font-bold tabular-nums", KINDS[g.k].tone)}>
                                        {g.k === "check"
                                            ? `${g.rows.length} أوردر`
                                            : formatCurrency(g.rows.reduce((a, r) => a + Number(r.suspect || 0), 0))}
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {g.k === "check" ? KINDS[g.k].note : `${g.rows.length} أوردر، ${KINDS[g.k].note}`}
                                    </p>
                                </div>
                            ))}
                        </div>

                        <Button variant="outline" size="sm" onClick={() => setShow(v => !v)}>
                            {show ? "اخفي التفاصيل" : `شوف الـ${rows.length} أوردر`}
                        </Button>

                        {show && (
                            <div className="max-h-[28rem] overflow-x-auto overflow-y-auto rounded-lg border">
                                <table className="w-full min-w-[720px] text-sm">
                                    <thead className="sticky top-0 bg-muted/50">
                                        <tr>
                                            <th className="w-8 p-2.5"></th>
                                            <th className="p-2.5 text-start text-xs font-medium">رقم الأوردر</th>
                                            <th className="p-2.5 text-start text-xs font-medium">العميل</th>
                                            <th className="p-2.5 text-start text-xs font-medium">السبب</th>
                                            <th className="p-2.5 text-end text-xs font-medium">مرات التسجيل</th>
                                            <th className="p-2.5 text-end text-xs font-medium">إجمالي الأوردر</th>
                                            <th className="p-2.5 text-end text-xs font-medium">المتسجّل</th>
                                            <th className="p-2.5 text-end text-xs font-medium">المشكوك فيه</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map(d => {
                                            const isOpen = open === d.match_key;
                                            return (
                                                <Fragment key={d.match_key}>
                                                    <tr className="cursor-pointer border-t hover:bg-muted/30"
                                                        onClick={() => setOpen(isOpen ? null : d.match_key)}>
                                                        <td className="p-2.5 text-xs text-muted-foreground">{isOpen ? "▾" : "▸"}</td>
                                                        <td className="p-2.5 font-mono text-xs font-semibold">
                                                            <span dir="ltr">#{d.reference}</span>
                                                            {!d.order_id && (
                                                                <span className="block font-sans text-[10px] font-normal text-muted-foreground">مش لاقي أوردر بالرقم ده</span>
                                                            )}
                                                        </td>
                                                        <td className="p-2.5">
                                                            {d.customer_name || "—"}
                                                            {d.order_status && <span className="block text-xs text-muted-foreground">{d.order_status}</span>}
                                                        </td>
                                                        <td className={cn("p-2.5 text-xs font-medium", KINDS[d.kind]?.tone)}>{KINDS[d.kind]?.label || d.kind}</td>
                                                        <td className="p-2.5 text-end tabular-nums">{d.txn_count}</td>
                                                        <td className="p-2.5 text-end tabular-nums">
                                                            {d.order_total !== null ? formatCurrency(Number(d.order_total)) : "—"}
                                                        </td>
                                                        <td className="p-2.5 text-end tabular-nums text-muted-foreground">{formatCurrency(Number(d.booked_total))}</td>
                                                        <td className={cn("p-2.5 text-end font-semibold tabular-nums", Number(d.suspect) > 0 ? "text-destructive" : "text-muted-foreground")}>
                                                            {Number(d.suspect) > 0 ? formatCurrency(Number(d.suspect)) : "—"}
                                                        </td>
                                                    </tr>
                                                    {isOpen && (
                                                        <tr className="border-t bg-muted/20">
                                                            <td></td>
                                                            <td colSpan={7} className="p-3">
                                                                <p className="mb-2 text-xs text-muted-foreground">التحصيلات اللي مكتوب فيها رقم الأوردر ده:</p>
                                                                <div className="space-y-1.5">
                                                                    {(d.txns || []).map(x => (
                                                                        <div key={x.id} className="flex flex-wrap items-baseline gap-x-3 text-xs">
                                                                            <span dir="ltr" className="w-20 tabular-nums text-muted-foreground">{String(x.date).slice(0, 10)}</span>
                                                                            <span dir="ltr" className="w-24 font-semibold tabular-nums">{formatCurrency(Number(x.amount))}</span>
                                                                            {/* orders_collection = Platform Orders; Orders Collection = typed by hand. */}
                                                                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{x.category || "—"}</span>
                                                                            <span className="text-muted-foreground">{x.account || "—"}</span>
                                                                            <span dir="auto" className="max-w-[24rem] truncate text-muted-foreground/80">{x.description || "—"}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <p className="mt-2 text-xs text-muted-foreground">
                                                                    عشان تمسح المكرر، ابحث في صفحة الحسابات عن <code dir="ltr" className="font-mono">{d.reference}</code>
                                                                    {d.easyorders_id && <> أو <code dir="ltr" className="font-mono">{d.easyorders_id}</code></>}.
                                                                </p>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
