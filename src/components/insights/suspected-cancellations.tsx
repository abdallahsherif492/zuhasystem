"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency, cn } from "@/lib/utils";
import { governorateArabic } from "@/lib/governorates";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CANCELLATION_REVIEW_MIGRATION, cancelReasonLabel, cancellationReviewOf } from "@/lib/orders/cancel-reasons";

/**
 * Cancellations the system suspects were given up on too soon
 * (cancellation_suspects(), 20261107_cancellation_review.sql), a way to put
 * them back in Waiting, and what became of the ones already put back.
 */

interface Suspect {
    order_id: string; score: number; reasons: string[]; cancelled_at: string; cancelled_by: string | null;
    cancel_reason: string | null; cancel_note: string | null; attempts: number; minutes_to_cancel: number;
}
interface Detail { id: string; created_at: string; total_amount: number | null; customer_info: { name?: string; phone?: string; governorate?: string } | null; products: string[] }
interface Reopen { order_id: string; source: "auto" | "manual"; reopened_at: string; orders: { status: string | null; total_amount: number | null } | { status: string | null; total_amount: number | null }[] | null }

const PERIODS = [
    { days: 3, label: "آخر 3 أيام" },
    { days: 7, label: "آخر 7 أيام" },
    { days: 30, label: "آخر 30 يوم" },
    { days: 90, label: "آخر 3 شهور" },
];

const int = (v: number) => Math.round(v).toLocaleString("en");
const money = (v: number) => formatCurrency(Math.round(v)).replace(/\.00$/, "");
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const when = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" });

function after(mins: number) {
    if (mins < 60) return `بعد ${Math.max(1, mins)} دقيقة`;
    if (mins < 1440) return `بعد ${Math.round(mins / 60)} ساعة`;
    return `بعد ${Math.round(mins / 1440)} يوم`;
}

/** Where a reopened order stands now. */
function outcome(status: string | null | undefined): "confirmed" | "cancelled" | "waiting" {
    const s = String(status || "").trim().toLowerCase();
    if (s === "waiting") return "waiting";
    if (s === "cancelled" || s === "canceled") return "cancelled";
    return "confirmed";
}

async function loadSuspects(businessId: string, days: number) {
    const to = new Date();
    const from = new Date(to.getTime() - days * 864e5);
    const [s, r] = await Promise.all([
        supabase.rpc("cancellation_suspects", { p_business_id: businessId, p_from: from.toISOString(), p_to: to.toISOString() }),
        supabase.from("cancellation_reopens").select("order_id, source, reopened_at, orders(status, total_amount)")
            .eq("business_id", businessId).gte("reopened_at", from.toISOString()).order("reopened_at", { ascending: false }).limit(5000),
    ]);
    if (s.error) {
        if (s.error.code === "PGRST202" || /could not find|does not exist/i.test(s.error.message)) {
            return { missing: true as const, suspects: [], details: new Map<string, Detail>(), reopens: [] };
        }
        throw s.error;
    }
    const suspects = (s.data || []) as Suspect[];

    // What the orders are, for the list.
    const details = new Map<string, Detail>();
    const ids = suspects.map(x => x.order_id);
    for (let i = 0; i < ids.length; i += 100) {
        const { data } = await supabase.from("orders")
            .select("id, created_at, total_amount, customer_info, order_items(quantity, variants(title, products(name)))")
            .in("id", ids.slice(i, i + 100));
        for (const o of (data || []) as unknown as (Omit<Detail, "products"> & { order_items: { variants: { title: string | null; products: { name: string } | null } | null }[] })[]) {
            details.set(o.id, { ...o, products: [...new Set((o.order_items || []).map(it => it.variants?.products?.name || it.variants?.title || "منتج"))] });
        }
    }
    return { missing: false as const, suspects, details, reopens: r.error ? [] : (r.data || []) as unknown as Reopen[] };
}

export function SuspectedCancellations({ businessId, themeConfig }: { businessId: string; themeConfig: unknown }) {
    const [days, setDays] = useState(7);
    const [suspects, setSuspects] = useState<Suspect[] | null>(null);
    const [details, setDetails] = useState<Map<string, Detail>>(new Map());
    const [reopens, setReopens] = useState<Reopen[] | null>(null);
    const [missing, setMissing] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [confirming, setConfirming] = useState(false);
    const [working, setWorking] = useState(false);
    const [version, setVersion] = useState(0);
    const auto = cancellationReviewOf(themeConfig as { cancellation_review?: { auto?: boolean } }).auto;

    useEffect(() => {
        let stale = false;
        loadSuspects(businessId, days)
            .then(res => {
                if (stale) return;
                if (res.missing) { setMissing(true); return; }
                setReopens(res.reopens);
                setDetails(res.details);
                setSuspects(res.suspects);
                setPicked(new Set());
            })
            .catch(e => { console.error(e); if (!stale) toast.error("مقدرتش أحمّل الإلغاءات المشكوك فيها."); });
        return () => { stale = true; };
    }, [businessId, days, version]);

    const results = useMemo(() => {
        const rows = (reopens || []).map(r => {
            const o = Array.isArray(r.orders) ? r.orders[0] : r.orders;
            return { source: r.source, outcome: outcome(o?.status), value: Number(o?.total_amount) || 0 };
        });
        const of = (k: string) => rows.filter(x => x.outcome === k);
        return {
            total: rows.length,
            auto: rows.filter(x => x.source === "auto").length,
            confirmed: of("confirmed").length,
            confirmedValue: of("confirmed").reduce((s, x) => s + x.value, 0),
            cancelled: of("cancelled").length,
            waiting: of("waiting").length,
        };
    }, [reopens]);

    const reopen = async () => {
        if (!picked.size) return;
        setWorking(true);
        const { data, error } = await supabase.rpc("reopen_cancelled_orders", { p_business_id: businessId, p_order_ids: [...picked] });
        setWorking(false);
        setConfirming(false);
        if (error) {
            console.error("reopen_cancelled_orders:", error);
            toast.error(/[؀-ۿ]/.test(error.message) ? error.message : "مارجعوش، جرّب تاني.");
            return;
        }
        const n = Number(data) || 0;
        toast.success(n ? `رجع ${n} أوردر لـ Waiting، والسيلز هيلاقوهم عليهم علامة «محاولة تانية بعد الإلغاء».` : "مفيش أوردر رجع: يمكن اتأكدوا أو رجعوا قبل كده.");
        setVersion(v => v + 1);
    };

    if (missing) {
        return (
            <Frame auto={auto}>
                <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                    الجزء ده محتاج migration يتشغّل في Supabase: <code className="rounded bg-muted px-1" dir="ltr">{CANCELLATION_REVIEW_MIGRATION}</code>
                </p>
            </Frame>
        );
    }

    const allPicked = !!suspects?.length && picked.size === suspects.length;

    return (
        <Frame auto={auto} aside={
            <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
                <SelectTrigger className="h-9 w-40" aria-label="الفترة"><SelectValue /></SelectTrigger>
                <SelectContent>{PERIODS.map(p => <SelectItem key={p.days} value={String(p.days)}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
        }>
            {/* Did suspecting pay off? */}
            <div className="rounded-xl border bg-card p-4 sm:p-5">
                <h3 className="font-semibold">النظام نجح ولا تعب عالفاضي؟</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">الأوردرات اللي رجعت Waiting في الفترة دي بعد ما اتشك فيها، وحصلها إيه بعد كده.</p>
                {reopens === null ? (
                    <div className="mt-4 h-16 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none" />
                ) : results.total === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">لسه مفيش أوردرات رجعت في الفترة دي.</p>
                ) : (
                    <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <Figure label="رجعت Waiting" value={int(results.total)} note={`${int(results.auto)} أوتوماتيك، ${int(results.total - results.auto)} بإيدك`} />
                        <Figure label="اتأكدت" value={int(results.confirmed)} note={`${pct(results.confirmed, results.total - results.waiting)} من اللي اتحسم أمرها · ${money(results.confirmedValue)}`} strong />
                        <Figure label="اتلغت تاني" value={int(results.cancelled)} note={pct(results.cancelled, results.total - results.waiting)} />
                        <Figure label="لسه مستنية" value={int(results.waiting)} note="محدش خلّصها لسه" />
                    </dl>
                )}
            </div>

            {/* The suspects */}
            <div className="mt-4 rounded-xl border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                    <div>
                        <h3 className="font-semibold">مشكوك فيهم دلوقتي {suspects && `(${int(suspects.length)})`}</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">اتلغوا في الفترة دي ولسه ملغيين. الأعلى في الشك الأول.</p>
                    </div>
                    {!!suspects?.length && (
                        confirming ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm">{int(picked.size)} أوردر هيرجعوا Waiting للسيلز. متأكد؟</span>
                                <Button size="sm" onClick={reopen} disabled={working}>
                                    {working && <Loader2 className="me-2 h-4 w-4 animate-spin" />}أيوه رجّعهم
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={working}>لأ</Button>
                            </div>
                        ) : (
                            <Button size="sm" onClick={() => setConfirming(true)} disabled={!picked.size} className="gap-1.5">
                                <RotateCcw className="h-4 w-4" />
                                رجّع {picked.size ? int(picked.size) : ""} لـ Waiting
                            </Button>
                        )
                    )}
                </div>

                {suspects === null ? (
                    <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />بدوّر…</div>
                ) : suspects.length === 0 ? (
                    <p className="p-5 text-sm text-muted-foreground">مفيش إلغاء مشكوك فيه في الفترة دي.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[860px] text-sm">
                            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                                <tr>
                                    <th className="w-10 px-4 py-2 text-start">
                                        <Checkbox checked={allPicked} onCheckedChange={c => setPicked(c ? new Set(suspects.map(s => s.order_id)) : new Set())} aria-label="اختار الكل" />
                                    </th>
                                    <th className="px-3 py-2 text-start font-medium">الأوردر</th>
                                    <th className="px-3 py-2 text-start font-medium">العميل</th>
                                    <th className="px-3 py-2 text-start font-medium">القيمة</th>
                                    <th className="px-3 py-2 text-start font-medium">الإلغاء</th>
                                    <th className="px-3 py-2 text-start font-medium">ليه شاكك</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {suspects.map(s => {
                                    const d = details.get(s.order_id);
                                    const on = picked.has(s.order_id);
                                    return (
                                        <tr key={s.order_id} className={cn("align-top", on && "bg-primary/5")}>
                                            <td className="px-4 py-2.5">
                                                <Checkbox checked={on} aria-label="اختار الأوردر"
                                                          onCheckedChange={c => setPicked(prev => { const n = new Set(prev); if (c) n.add(s.order_id); else n.delete(s.order_id); return n; })} />
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <Link href={`/orders/${s.order_id}`} className="font-medium text-primary underline-offset-4 hover:underline" dir="ltr">#{s.order_id.slice(0, 8)}</Link>
                                                {d && <div className="text-xs text-muted-foreground">{when.format(new Date(d.created_at))}</div>}
                                                {d && <div className="mt-0.5 line-clamp-2 max-w-[14rem] text-xs" dir="auto">{d.products.join("، ")}</div>}
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <div className="font-medium">{d?.customer_info?.name || "—"}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {governorateArabic(d?.customer_info?.governorate) || d?.customer_info?.governorate} · <span dir="ltr">{d?.customer_info?.phone}</span>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2.5 tabular-nums" dir="ltr">{money(Number(d?.total_amount) || 0)}</td>
                                            <td className="px-3 py-2.5">
                                                <div>{s.cancelled_by ? s.cancelled_by.split("@")[0] : <span className="text-muted-foreground">مش معروف مين</span>}</div>
                                                <div className="text-xs text-muted-foreground">{after(s.minutes_to_cancel)} من وصوله · {int(s.attempts)} محاولة</div>
                                                {(s.cancel_reason || s.cancel_note) && (
                                                    <div className="mt-0.5 max-w-[12rem] text-xs">{[cancelReasonLabel(s.cancel_reason), s.cancel_note].filter(Boolean).join(" — ")}</div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <div className="flex items-start gap-2">
                                                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                                                        s.score >= 80 ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200")}
                                                          title="نقط الشك، 50 أو أكتر يبقى مشكوك فيه">{s.score}</span>
                                                    <ul className="space-y-0.5 text-xs">
                                                        {s.reasons.map(r => <li key={r}>{r}</li>)}
                                                    </ul>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </Frame>
    );
}

function Frame({ auto, aside, children }: { auto: boolean; aside?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section aria-labelledby="suspects-title">
            <header className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                    <h2 id="suspects-title" className="text-lg font-semibold">الإلغاءات المشكوك فيها</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                        أوردرات اتلغت بسرعة، أو من غير محاولات اتصال كفاية، أو من غير سبب.{" "}
                        <span className={cn("font-medium", auto ? "text-emerald-700 dark:text-emerald-400" : "text-foreground")}>
                            {auto ? "الإرجاع التلقائي شغال: كل يوم 9 الصبح." : "الإرجاع التلقائي واقف."}
                        </span>{" "}
                        <Link href="/settings?tab=cancellations" className="text-primary underline-offset-4 hover:underline">الإعدادات والقواعد</Link>
                    </p>
                </div>
                {aside}
            </header>
            {children}
        </section>
    );
}

function Figure({ label, value, note, strong }: { label: string; value: string; note: string; strong?: boolean }) {
    return (
        <div>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className={cn("mt-0.5 text-3xl font-bold tabular-nums", strong && "text-emerald-700 dark:text-emerald-400")} dir="ltr">{value}</dd>
            <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>
        </div>
    );
}
