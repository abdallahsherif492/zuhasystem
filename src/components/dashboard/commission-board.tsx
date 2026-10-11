"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { endOfMonth, format, startOfMonth, subDays, subMonths } from "date-fns";
import { BadgePercent, Clock, Settings2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { formatCurrency, cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface BoardRow {
    email: string;
    is_me: boolean;
    eligible_orders: number;
    eligible_sales: number;   // without shipping
    eligible_total: number;   // with shipping
    aov: number | null;
    below_min: number;
    awaiting_orders: number;
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

/**
 * Moderator commission on the main page: a ranking by orders that earn
 * commission, with their average value and total. A commission figure shows
 * only to its own moderator and to managers — the database decides, not this
 * component (commission_board in 20261008_moderator_commission.sql).
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
                    eligible_orders: n(r.eligible_orders), eligible_sales: n(r.eligible_sales), eligible_total: n(r.eligible_total),
                    below_min: n(r.below_min), awaiting_orders: n(r.awaiting_orders), min_total: n(r.min_total),
                    aov: r.aov === null ? null : n(r.aov),
                    commission: r.commission === null ? null : n(r.commission),
                    awaiting_commission: r.awaiting_commission === null ? null : n(r.awaiting_commission),
                })),
            });
        });
        return () => { cancelled = true; };
    }, [activeBusiness, period]);

    // Nothing to show until commission is set up — and nothing at all for
    // staff then, or before the migration has been run.
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

    const rows = board.rows;
    const totalOrders = rows.reduce((s, r) => s + r.eligible_orders, 0);
    const totalSales = rows.reduce((s, r) => s + r.eligible_sales, 0);
    const me = rows.find(r => r.is_me);
    const commissionTotal = board.is_manager ? rows.reduce((s, r) => s + (r.commission ?? 0), 0) : me?.commission ?? null;
    const awaitingTotal = board.is_manager ? rows.reduce((s, r) => s + (r.awaiting_commission ?? 0), 0) : me?.awaiting_commission ?? null;
    const top = Math.max(1, ...rows.map(r => r.eligible_orders));

    return (
        <Card dir="rtl">
            <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <CardTitle className="flex items-center gap-2 text-lg"><BadgePercent className="h-5 w-5 text-primary" />كوميشن المودريتورز</CardTitle>
                    <CardDescription>
                        على الأوردرات اللي اتسلمت للعميل · المبيعات والكوميشن من غير الشحن · الترتيب بعدد الأوردرات
                    </CardDescription>
                </div>
                <div className="inline-flex rounded-lg border bg-muted p-1">
                    {PERIODS.map(p => (
                        <button key={p.key} onClick={() => setPeriod(p.key)}
                                className={cn("rounded-md px-2.5 py-1 text-xs font-medium", period === p.key ? "bg-background shadow-sm" : "text-muted-foreground")}>
                            {p.label}
                        </button>
                    ))}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <Stat label="أوردرات ليها كوميشن" value={totalOrders.toLocaleString("en")} />
                    <Stat label="المبيعات (من غير شحن)" value={formatCurrency(totalSales)} />
                    <Stat label="متوسط الأوردر" value={totalOrders ? formatCurrency(totalSales / totalOrders) : "—"} />
                    {commissionTotal !== null && (
                        <Stat
                            label={board.is_manager ? "إجمالي الكوميشن" : "الكوميشن بتاعك"}
                            value={formatCurrency(commissionTotal)}
                            hint={awaitingTotal ? `+ ${formatCurrency(awaitingTotal)} مستني التسليم` : undefined}
                            strong
                        />
                    )}
                </div>

                <div className="divide-y rounded-lg border">
                    {rows.map((r, i) => (
                        <div key={r.email} className={cn("flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4", r.is_me && "bg-primary/[0.04]")}>
                            <div className="flex min-w-0 items-center gap-3 sm:w-56">
                                <span className="w-7 shrink-0 text-center text-lg">{MEDALS[i] ?? <span className="text-sm font-bold text-muted-foreground">#{i + 1}</span>}</span>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 truncate font-semibold" title={r.email}>
                                        {r.email.split("@")[0]}
                                        {r.is_me && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">إنت</span>}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground">
                                        {r.rate !== null ? `${r.rate}% · ` : ""}من {r.min_total.toLocaleString("en")} ج
                                    </div>
                                </div>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-baseline justify-between text-sm">
                                    <span><b className="text-base">{r.eligible_orders}</b> <span className="text-muted-foreground">أوردر</span></span>
                                    <span className="text-xs text-muted-foreground">متوسط <span dir="ltr">{r.aov !== null ? formatCurrency(r.aov) : "—"}</span></span>
                                </div>
                                <div className="mt-1 h-2 rounded-full bg-muted">
                                    <div className="h-2 rounded-full bg-primary" style={{ width: `${(r.eligible_orders / top) * 100}%` }} />
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                                    {r.awaiting_orders > 0 && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{r.awaiting_orders} مستني التسليم</span>}
                                    {r.below_min > 0 && <span>{r.below_min} اتسلموا بس أقل من {r.min_total.toLocaleString("en")} ج</span>}
                                    {r.returned > 0 && <span>{r.returned} مرتجع</span>}
                                </div>
                            </div>
                            <div className="flex items-center justify-between gap-4 sm:w-56 sm:justify-end">
                                <div className="text-end">
                                    <div className="text-[11px] text-muted-foreground">المبيعات</div>
                                    <div className="text-sm font-medium"><span dir="ltr">{formatCurrency(r.eligible_sales)}</span></div>
                                </div>
                                {r.commission !== null && (
                                    <div className="text-end">
                                        <div className="text-[11px] text-muted-foreground">الكوميشن</div>
                                        <div className="font-bold text-emerald-600 dark:text-emerald-400"><span dir="ltr">{formatCurrency(r.commission)}</span></div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
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

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
    return (
        <div className={cn("rounded-lg border p-3", strong && "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20")}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={cn("mt-0.5 text-lg font-bold", strong && "text-emerald-700 dark:text-emerald-400")}><span dir="ltr">{value}</span></div>
            {hint && <div className="text-[11px] text-muted-foreground" dir="rtl">{hint}</div>}
        </div>
    );
}
