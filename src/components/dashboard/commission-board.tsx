"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { endOfMonth, format, startOfMonth, subDays, subMonths } from "date-fns";
import { BadgePercent, Settings2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { formatCurrency, cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface BoardRow {
    email: string;
    is_me: boolean;
    confirmed_orders: number | null;   // every order they confirmed (20261010)
    confirmed_sales: number | null;    // without shipping
    eligible_orders: number;           // delivered, from the minimum up
    eligible_sales: number;            // without shipping
    below_min: number;
    awaiting_orders: number;           // qualify, still on their way
    awaiting_total: number | null;     // with shipping (20261010)
    returned: number;
    cancelled: number;
    min_total: number;
    rate: number | null;
    commission: number | null;
    awaiting_commission: number | null;
}
interface Board { configured: boolean; is_manager: boolean; rows: BoardRow[] }

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const PERIODS = [
    { key: "this", label: "الشهر ده", range: () => ({ from: ymd(startOfMonth(new Date())), to: ymd(new Date()) }) },
    { key: "last", label: "الشهر اللي فات", range: () => { const d = subMonths(new Date(), 1); return { from: ymd(startOfMonth(d)), to: ymd(endOfMonth(d)) }; } },
    { key: "30", label: "آخر 30 يوم", range: () => ({ from: ymd(subDays(new Date(), 29)), to: ymd(new Date()) }) },
] as const;
const MEDALS = ["🥇", "🥈", "🥉"];
const n = (v: unknown) => Number(v) || 0;
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v) || 0);
const int = (v: number) => Math.round(v).toLocaleString("en");
const money = (v: number) => formatCurrency(Math.round(v)).replace(/\.00$/, "");

/**
 * Moderator commission on the main page, open to the whole sales team.
 * For each moderator, three things side by side: the orders they confirmed,
 * the delivered ones that earned commission, and the ones that qualify but
 * have not been delivered yet — whose commission is not earned until they
 * are. Ranked by orders that earned commission (commission_board in
 * 20261008/20261010).
 */
export function CommissionBoard() {
    const { activeBusiness } = useBusiness();
    const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("this");
    const [board, setBoard] = useState<Board | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!activeBusiness) return;
        let cancelled = false;
        const { from, to } = PERIODS.find(p => p.key === period)!.range();
        supabase.rpc("commission_board", { p_business_id: activeBusiness.id, p_from: from, p_to: to }).then(({ data, error }) => {
            if (cancelled) return;
            if (error) { setFailed(true); return; }
            const b = data as Board;
            setFailed(false);
            setBoard({
                ...b,
                rows: (b.rows || []).map(r => ({
                    ...r,
                    confirmed_orders: nn(r.confirmed_orders), confirmed_sales: nn(r.confirmed_sales),
                    eligible_orders: n(r.eligible_orders), eligible_sales: n(r.eligible_sales),
                    below_min: n(r.below_min), awaiting_orders: n(r.awaiting_orders), awaiting_total: nn(r.awaiting_total),
                    returned: n(r.returned), cancelled: n(r.cancelled), min_total: n(r.min_total),
                    rate: nn(r.rate), commission: nn(r.commission), awaiting_commission: nn(r.awaiting_commission),
                })),
            });
        });
        return () => { cancelled = true; };
    }, [activeBusiness, period]);

    if (failed || !board) return null;
    if (!board.configured) {
        if (!board.is_manager) return null;
        return (
            <Card className="border-dashed" dir="rtl">
                <CardContent className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2"><BadgePercent className="h-4 w-4 text-primary" />حدّد كوميشن المودريتورز عشان يظهرلهم الترتيب والكوميشن هنا.</div>
                    <Link href="/settings?tab=commission" className="inline-flex items-center gap-1 text-primary underline"><Settings2 className="h-3.5 w-3.5" />إعدادات الكوميشن</Link>
                </CardContent>
            </Card>
        );
    }

    const rows = [...board.rows].sort((a, b) =>
        b.eligible_orders - a.eligible_orders || b.awaiting_orders - a.awaiting_orders || n(b.confirmed_orders) - n(a.confirmed_orders));
    const sum = (f: (r: BoardRow) => number | null) => rows.reduce((s, r) => s + n(f(r)), 0);
    const hasConfirmed = rows.some(r => r.confirmed_orders !== null);
    const minTotal = rows[0]?.min_total ?? 0;
    const sameMin = rows.every(r => r.min_total === minTotal);

    return (
        <Card dir="rtl">
            <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <CardTitle className="flex items-center gap-2 text-lg"><BadgePercent className="h-5 w-5 text-primary" />كوميشن المودريتورز</CardTitle>
                    <CardDescription>
                        الكوميشن بيتحسب على الأوردر لما يتسلم للعميل{sameMin ? ` ويكون إجماليه بالشحن ${int(minTotal)} ج أو أكتر` : ""}، على المبلغ من غير الشحن.
                    </CardDescription>
                </div>
                <div className="inline-flex shrink-0 rounded-lg border bg-muted p-1">
                    {PERIODS.map(p => (
                        <button key={p.key} onClick={() => setPeriod(p.key)}
                                className={cn("rounded-md px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", period === p.key ? "bg-background shadow-sm" : "text-muted-foreground")}>
                            {p.label}
                        </button>
                    ))}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    {hasConfirmed && (
                        <Stat label="الأوردرات المؤكدة" value={int(sum(r => r.confirmed_orders))} hint={`مبيعاتها ${money(sum(r => r.confirmed_sales))} من غير شحن`} />
                    )}
                    <Stat label="اتسلمت وليها كوميشن" value={int(sum(r => r.eligible_orders))} hint={`مبيعاتها ${money(sum(r => r.eligible_sales))}`} />
                    <Stat label="الكوميشن المستحق" value={money(sum(r => r.commission))} hint="على الأوردرات اللي اتسلمت" tone="good" />
                    <Stat label="كوميشن مستني التسليم" value={money(sum(r => r.awaiting_commission))}
                          hint={`${int(sum(r => r.awaiting_orders))} أوردر لسه في الشحن${hasConfirmed ? ` بإجمالي ${money(sum(r => r.awaiting_total))}` : ""}`} tone="pending" />
                </div>

                <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[720px] text-sm">
                        <thead className="bg-muted/40 text-xs text-muted-foreground">
                            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                                <th>المودريتور</th>
                                {hasConfirmed && <th>أكّد</th>}
                                <th>اتسلم وليه كوميشن</th>
                                <th>مستني التسليم</th>
                                <th className="text-end">الكوميشن</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {rows.map((r, i) => (
                                <tr key={r.email} className={cn("align-top [&>td]:px-3 [&>td]:py-2.5", r.is_me && "bg-primary/[0.05]")}>
                                    <td>
                                        <div className="flex items-center gap-2">
                                            <span className="w-6 shrink-0 text-center">{MEDALS[i] ?? <span className="text-xs font-semibold text-muted-foreground">{i + 1}</span>}</span>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5 truncate font-semibold" title={r.email}>
                                                    {r.email.split("@")[0]}
                                                    {r.is_me && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">إنت</span>}
                                                </div>
                                                <div className="text-[11px] text-muted-foreground">{r.rate !== null ? `${r.rate}%` : ""}{!sameMin ? ` من ${int(r.min_total)} ج` : ""}</div>
                                            </div>
                                        </div>
                                    </td>
                                    {hasConfirmed && (
                                        <td>
                                            <div className="font-medium tabular-nums">{int(n(r.confirmed_orders))} أوردر</div>
                                            <div className="text-xs text-muted-foreground"><span dir="ltr">{money(n(r.confirmed_sales))}</span></div>
                                            {n(r.confirmed_orders) > 0 && <div className="text-[11px] text-muted-foreground">متوسط <span dir="ltr">{money(n(r.confirmed_sales) / n(r.confirmed_orders))}</span></div>}
                                        </td>
                                    )}
                                    <td>
                                        <div className="font-medium tabular-nums">{int(r.eligible_orders)} أوردر</div>
                                        <div className="text-xs text-muted-foreground"><span dir="ltr">{money(r.eligible_sales)}</span></div>
                                        {r.below_min > 0 && <div className="text-[11px] text-muted-foreground">{int(r.below_min)} اتسلموا تحت الحد</div>}
                                    </td>
                                    <td>
                                        <div className="font-medium tabular-nums">{int(r.awaiting_orders)} أوردر</div>
                                        {r.awaiting_total !== null && r.awaiting_orders > 0 && <div className="text-xs text-muted-foreground">إجمالي <span dir="ltr">{money(r.awaiting_total)}</span></div>}
                                        {r.awaiting_commission ? <div className="text-xs text-amber-700 dark:text-amber-400">كوميشنهم <span dir="ltr">{money(r.awaiting_commission)}</span></div> : null}
                                    </td>
                                    <td className="text-end">
                                        <div className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400"><span dir="ltr">{money(n(r.commission))}</span></div>
                                        {r.awaiting_commission ? <div className="text-[11px] text-muted-foreground">+ <span dir="ltr">{money(r.awaiting_commission)}</span> لو اتسلموا</div> : null}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {board.is_manager && (
                    <div className="text-end">
                        <Link href="/settings?tab=commission" className="text-xs text-muted-foreground underline">تعديل النسب والحد الأدنى</Link>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "pending" }) {
    return (
        <div className={cn("rounded-lg border p-3",
            tone === "good" && "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20",
            tone === "pending" && "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20")}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={cn("mt-0.5 text-lg font-bold tabular-nums", tone === "good" && "text-emerald-700 dark:text-emerald-400", tone === "pending" && "text-amber-800 dark:text-amber-300")}>
                <span dir="ltr">{value}</span>
            </div>
            {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
        </div>
    );
}
