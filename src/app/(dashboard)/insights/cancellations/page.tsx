"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { Loader2, X } from "lucide-react";
import { supabase, fetchAll } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { formatCurrency, cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/date-range-picker";
import { cairoDate, cairoDayStart, nextDay } from "@/lib/cairo-day";
import { SuspectedCancellations } from "@/components/insights/suspected-cancellations";
import {
    DIMENSIONS, UNKNOWN_MODERATOR, applyFilters, breakdown, buildRows, dimension, findings, summarize,
    type Dimension, type DimensionKey, type Filters, type Group, type RawOrder, type Row,
} from "@/lib/insights/cancellations";

const plex = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], display: "swap" });

const ORDER_COLUMNS = "id, created_at, status, order_type, channel, tags, total_amount, shipping_cost, discount, paid_amount, customer_info, confirm_attempts, last_attempt_reason, last_attempt_note, closed_by, easyorders_id, shopify_id";
const pct = (v: number) => `${Math.round(v * 100)}%`;
const int = (v: number) => Math.round(v).toLocaleString("en");
const money = (v: number) => formatCurrency(Math.round(v)).replace(/\.00$/, "");
/** Below this many orders a rate is shown but not trusted. */
const FEW = 10;
const ROWS_SHOWN = 8;
const ORDERS_SHOWN = 50;

/** Runs `work` over `list` in chunks, a few chunks at a time. */
async function inChunks<T, R>(list: T[], size: number, parallel: number, work: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
    const chunks: T[][] = [];
    for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
    const out: R[] = [];
    for (let i = 0; i < chunks.length; i += parallel) {
        const parts = await Promise.all(chunks.slice(i, i + parallel).map(work));
        parts.forEach(p => out.push(...p));
    }
    return out;
}

async function loadRows(businessId: string, fromDay: string, toDay: string): Promise<Row[]> {
    const start = cairoDayStart(fromDay);
    const end = cairoDayStart(nextDay(toDay));

    // Who cancelled and why live on the order once 20261107_cancellation_review.sql
    // has run; before that the columns are not there and the log is all there is.
    const readOrders = (cols: string) => fetchAll<RawOrder>((f, t) => supabase.from("orders").select(cols)
        .eq("business_id", businessId).gte("created_at", start).lt("created_at", end).range(f, t) as unknown as PromiseLike<{ data: RawOrder[] | null; error: unknown }>);
    const [orders, variants] = await Promise.all([
        readOrders(`${ORDER_COLUMNS}, cancelled_by, cancel_reason, cancel_note`).catch(() => readOrders(ORDER_COLUMNS)),
        fetchAll<{ id: string; title: string | null; products: { name: string } | { name: string }[] | null }>((f, t) =>
            supabase.from("variants").select("id, title, products(name)").eq("business_id", businessId).range(f, t)),
    ]);

    const productOf = new Map(variants.map(v => [v.id, (Array.isArray(v.products) ? v.products[0]?.name : v.products?.name) || v.title || "منتج"]));
    const lines = await inChunks(orders.map(o => o.id), 150, 4, async ids => {
        const { data, error } = await supabase.from("order_items").select("order_id, quantity, variant_id").in("order_id", ids);
        if (error) throw error;
        return (data || []) as { order_id: string; quantity: number; variant_id: string | null }[];
    });
    const items = new Map<string, { quantity: number; product: string }[]>();
    for (const l of lines) {
        const list = items.get(l.order_id) || [];
        list.push({ quantity: l.quantity, product: l.variant_id ? productOf.get(l.variant_id) || "منتج" : "منتج مش متربط" });
        items.set(l.order_id, list);
    }

    // Who cancelled: only the actions log knows, and it keeps 30 days.
    const cancelledBy = new Map<string, string>();
    for (let from = 0; ; from += 500) {
        const { data, error } = await supabase.from("actions_log")
            .select("entity_id, user_email, changes, metadata")
            .eq("business_id", businessId).eq("action_type", "update_status")
            .gte("created_at", start).order("created_at").range(from, from + 499);
        if (error) { console.error("actions_log:", error); break; }
        for (const l of data || []) {
            if (!JSON.stringify(l.changes || "").includes('"new_value":"Cancelled"') || !l.user_email) continue;
            const ids = [l.entity_id, ...((l.metadata as { orders?: { id: string }[] } | null)?.orders || []).map(x => x.id)];
            for (const id of ids) if (id) cancelledBy.set(id, l.user_email);
        }
        if (!data || data.length < 500) break;
    }

    return buildRows(orders, items, cancelledBy);
}

function CancellationsContent() {
    const { activeBusiness } = useBusiness();
    const params = useSearchParams();
    const router = useRouter();
    const today = cairoDate();
    const fromDay = params.get("from");
    const toDay = params.get("to") || fromDay;

    // The last 30 days to start with: as far back as the log knows who cancelled.
    useEffect(() => {
        if (fromDay) return;
        const d = new Date(`${today}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 29);
        router.replace(`?from=${d.toISOString().slice(0, 10)}&to=${today}`, { scroll: false });
    }, [fromDay, today, router]);

    // What was loaded, and for which business and days: a result for other
    // days than the ones picked is not shown, so the page reads as loading.
    const key = activeBusiness && fromDay && toDay ? `${activeBusiness.id}|${fromDay}|${toDay}` : null;
    const [loaded, setLoaded] = useState<{ key: string; rows: Row[] | null; error: boolean } | null>(null);
    const [filters, setFilters] = useState<Filters>({});

    useEffect(() => {
        if (!key || !activeBusiness || !fromDay || !toDay) return;
        let stale = false;
        loadRows(activeBusiness.id, fromDay, toDay)
            .then(r => { if (!stale) setLoaded({ key, rows: r, error: false }); })
            .catch(e => { console.error("cancellations:", e); if (!stale) setLoaded({ key, rows: null, error: true }); });
        return () => { stale = true; };
    }, [key, activeBusiness, fromDay, toDay]);

    const current = loaded?.key === key ? loaded : null;
    const rows = current?.rows ?? null;
    const error = !!current?.error;

    const toggle = (key: DimensionKey, value: string) => setFilters(f => {
        const now = f[key] || [];
        const next = now.includes(value) ? now.filter(v => v !== value) : [...now, value];
        return { ...f, [key]: next.length ? next : undefined };
    });

    const filtered = useMemo(() => (rows ? applyFilters(rows, filters) : []), [rows, filters]);
    const all = useMemo(() => summarize(rows || []), [rows]);
    const now = useMemo(() => summarize(filtered), [filtered]);
    const withoutRepeats = useMemo(() => summarize(filtered.filter(r => r.facts.duplicate[0] === "لأ")), [filtered]);
    const found = useMemo(() => findings(filtered), [filtered]);
    const unexplained = now.cancelled ? filtered.filter(r => r.cancelled && !r.lastReason).length / now.cancelled : 0;
    const activeFilters = (Object.entries(filters) as [DimensionKey, string[] | undefined][]).filter(([, v]) => v?.length) as [DimensionKey, string[]][];
    const logGap = !!fromDay && fromDay < (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); })();

    return (
        <div className={cn(plex.className, "flex flex-col gap-8 pb-16")} dir="rtl">
            <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">تحليل الإلغاءات</h1>
                    <p className="mt-1 max-w-2xl text-muted-foreground">
                        نسبة الإلغاء من الأوردرات اللي اتأكدت أو اتلغت، مقسومة بكل حاجة نعرفها عن الأوردر. دوس على أي سطر عشان تفلتر بيه الصفحة كلها.
                    </p>
                </div>
                <div dir="ltr"><DateRangePicker /></div>
            </header>

            {error && (
                <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">مقدرتش أحمّل الأوردرات. حدّث الصفحة.</p>
            )}

            {!rows && !error && (
                <div className="flex items-center justify-center gap-3 py-24 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" /> بحمّل الأوردرات وبحسب…
                </div>
            )}

            {rows && (
                <>
                    {/* The headline: how much is cancelled, under the filters applied */}
                    <section aria-label="الأرقام" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-2xl bg-red-700 p-5 text-white dark:bg-red-800 sm:col-span-2 lg:col-span-1">
                            <div className="text-sm font-medium text-red-50">نسبة الإلغاء</div>
                            <div className="mt-1 text-6xl font-bold tabular-nums leading-none" dir="ltr">{pct(now.rate)}</div>
                            <div className="mt-2 text-sm text-red-50">
                                {int(now.cancelled)} من {int(now.orders)} أوردر
                                {activeFilters.length > 0 && <> · المتوسط من غير فلاتر {pct(all.rate)}</>}
                            </div>
                        </div>
                        <Stat label="قيمة الأوردرات الملغية" value={money(now.lost)} note="مبيعات كانت هتدخل لو اتأكدت" />
                        <Stat label="من غير الأوردرات المكررة" value={pct(withoutRepeats.rate)}
                              note={`${int(now.cancelled - withoutRepeats.cancelled)} إلغاء لعميل عامل أوردر تاني خلال 3 أيام`} />
                        <Stat label="اتلغى من غير محاولة فاشلة متسجلة" value={pct(unexplained)}
                              note="من الإلغاءات: محدش سجّل ليه الاتصال فشل قبل ما يلغي" />
                    </section>

                    {logGap && (
                        <p className="-mt-4 text-sm text-amber-800 dark:text-amber-300">
                            الفترة دي بتبدأ قبل 30 يوم: الإلغاءات الأقدم مش معروف مين لغاها، لأن سجل العمليات بيتمسح بعد 30 يوم.
                        </p>
                    )}

                    {activeFilters.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2" aria-label="الفلاتر">
                            {activeFilters.flatMap(([k, vals]) => vals.map(v => (
                                <button key={`${k}:${v}`} type="button" onClick={() => toggle(k, v)}
                                        className="flex items-center gap-1.5 rounded-full border bg-card py-1 pe-2 ps-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    <span className="text-muted-foreground">{dimension(k).label}:</span> {v}
                                    <X className="h-3.5 w-3.5" aria-label="شيل الفلتر" />
                                </button>
                            )))}
                            <button type="button" onClick={() => setFilters({})} className="text-sm text-primary underline-offset-4 hover:underline">شيل كل الفلاتر</button>
                        </div>
                    )}

                    {/* Where the cancellations above average are */}
                    <section aria-labelledby="found-title">
                        <h2 id="found-title" className="text-lg font-semibold">فين الإلغاء أعلى من المتوسط</h2>
                        <p className="mt-0.5 text-sm text-muted-foreground">مرتبة بعدد الإلغاءات الزيادة عن المتوسط ({pct(now.rate)})، يعني اللي لو اتحل هيفرق أكتر.</p>
                        {found.length === 0 ? (
                            <p className="mt-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                                مفيش مجموعة كبيرة كفاية بتتلغى أكتر من المتوسط بشكل واضح{activeFilters.length ? " مع الفلاتر دي" : ""}.
                            </p>
                        ) : (
                            <ol className="mt-3 divide-y rounded-xl border bg-card">
                                {found.map(({ dim, group }) => (
                                    <li key={`${dim.key}:${group.value}`}>
                                        <button type="button" onClick={() => toggle(dim.key, group.value)}
                                                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-start hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none">
                                            <span className="min-w-0 flex-1">
                                                <span className="text-muted-foreground">{dim.label}: </span>
                                                <span className="font-semibold">{group.value}</span>
                                                <span className="text-muted-foreground"> بيتلغى </span>
                                                <span className="font-semibold text-red-700 dark:text-red-400">{pct(group.rate)}</span>
                                                <span className="text-muted-foreground"> ({int(group.cancelled)} من {int(group.orders)})</span>
                                            </span>
                                            <span className="text-sm text-muted-foreground">
                                                {int(group.extra)} إلغاء زيادة · {money(group.lost)}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </section>

                    {/* Every fact, broken down */}
                    <section aria-labelledby="dims-title">
                        <h2 id="dims-title" className="text-lg font-semibold">الإلغاء حسب</h2>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                            الخط الرأسي في كل شريط هو المتوسط. الأرقام الباهتة لمجموعات أقل من {FEW} أوردرات، متتبنيش عليها.
                        </p>
                        <div className="mt-3 grid gap-4 lg:grid-cols-2">
                            {DIMENSIONS.map(dim => (
                                <DimensionCard key={dim.key} dim={dim}
                                               rows={applyFilters(rows, filters, dim.key)}
                                               selected={filters[dim.key] || []}
                                               onPick={v => toggle(dim.key, v)} />
                            ))}
                        </div>
                    </section>

                    {activeBusiness && <SuspectedCancellations businessId={activeBusiness.id} themeConfig={activeBusiness.theme_config} />}

                    <CancelledList rows={filtered.filter(r => r.cancelled)} />
                </>
            )}
        </div>
    );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
    return (
        <div className="rounded-2xl border bg-card p-5">
            <div className="text-sm font-medium text-muted-foreground">{label}</div>
            <div className="mt-1 text-3xl font-bold tabular-nums" dir="ltr">{value}</div>
            <div className="mt-2 text-xs text-muted-foreground">{note}</div>
        </div>
    );
}

function DimensionCard({ dim, rows, selected, onPick }: { dim: Dimension; rows: Row[]; selected: string[]; onPick: (v: string) => void }) {
    const [open, setOpen] = useState(false);
    const avg = summarize(rows).rate;
    const groups = breakdown(rows, dim);
    const shown = open ? groups : groups.slice(0, ROWS_SHOWN);
    const allUnknown = dim.key === "moderator" && groups.length === 1 && groups[0].value === UNKNOWN_MODERATOR;

    return (
        <div className="rounded-xl border bg-card">
            <div className="border-b px-4 py-3">
                <h3 className="font-semibold">{dim.label}</h3>
                {dim.hint && <p className="mt-0.5 text-xs text-muted-foreground">{dim.hint}</p>}
            </div>
            {groups.length === 0 || allUnknown ? (
                <p className="p-4 text-sm text-muted-foreground">{allUnknown ? "مش معروف مين لغى الأوردرات في الفترة دي." : "مفيش أوردرات."}</p>
            ) : (
                <ul className="divide-y">
                    {shown.map(g => <GroupRow key={g.value} g={g} avg={avg} picked={selected.includes(g.value)} onPick={() => onPick(g.value)} />)}
                </ul>
            )}
            {groups.length > ROWS_SHOWN && (
                <button type="button" onClick={() => setOpen(o => !o)}
                        className="w-full border-t px-4 py-2 text-sm text-primary hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {open ? "اعرض أقل" : `اعرض الكل (${groups.length})`}
                </button>
            )}
        </div>
    );
}

function GroupRow({ g, avg, picked, onPick }: { g: Group; avg: number; picked: boolean; onPick: () => void }) {
    const few = g.orders < FEW;
    const high = !few && g.rate >= avg + 0.05;
    const low = !few && g.rate <= avg - 0.05;
    return (
        <li>
            <button type="button" onClick={onPick} aria-pressed={picked}
                    className={cn("grid w-full grid-cols-[minmax(0,1fr)_5.5rem_3rem] items-center gap-3 px-4 py-2 text-start text-sm hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_5.5rem_3rem]",
                        picked && "bg-primary/5 ring-1 ring-inset ring-primary", few && "text-muted-foreground")}>
                <span className="truncate font-medium" dir="auto" title={g.value}>{g.value}</span>
                <span className="relative hidden h-2.5 rounded-full bg-muted sm:block" aria-hidden>
                    <span className={cn("absolute inset-y-0 start-0 rounded-full", few ? "bg-muted-foreground/30" : high ? "bg-red-600" : low ? "bg-emerald-600" : "bg-foreground/40")}
                          style={{ width: `${Math.max(2, g.rate * 100)}%` }} />
                    <span className="absolute -inset-y-1 w-0.5 bg-foreground" style={{ insetInlineStart: `${avg * 100}%` }} />
                </span>
                <span className="text-end text-xs tabular-nums text-muted-foreground">{int(g.cancelled)} من {int(g.orders)}</span>
                <span className={cn("text-end font-semibold tabular-nums", high && "text-red-700 dark:text-red-400", low && "text-emerald-700 dark:text-emerald-400")} dir="ltr">{pct(g.rate)}</span>
            </button>
        </li>
    );
}

const dateFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" });

function CancelledList({ rows }: { rows: Row[] }) {
    const [count, setCount] = useState(ORDERS_SHOWN);
    const list = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return (
        <section aria-labelledby="list-title">
            <h2 id="list-title" className="text-lg font-semibold">الأوردرات الملغية ({int(list.length)})</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">بالفلاتر اللي فوق، الأحدث الأول.</p>
            {list.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">مفيش أوردرات ملغية.</p>
            ) : (
                <div className="mt-3 overflow-x-auto rounded-xl border bg-card">
                    <table className="w-full min-w-[760px] text-sm">
                        <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                            <tr>
                                <th className="px-4 py-2 text-start font-medium">الأوردر</th>
                                <th className="px-4 py-2 text-start font-medium">العميل</th>
                                <th className="px-4 py-2 text-start font-medium">المنتجات</th>
                                <th className="px-4 py-2 text-start font-medium">القيمة</th>
                                <th className="px-4 py-2 text-start font-medium">لغاه وليه</th>
                                <th className="px-4 py-2 text-start font-medium">آخر محاولة اتصال</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {list.slice(0, count).map(r => (
                                <tr key={r.id} className="align-top">
                                    <td className="px-4 py-2">
                                        <Link href={`/orders/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline" dir="ltr">#{r.id.slice(0, 8)}</Link>
                                        <div className="text-xs text-muted-foreground">{dateFmt.format(new Date(r.createdAt))}</div>
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className="font-medium">{r.name || "—"}</div>
                                        <div className="text-xs text-muted-foreground">{r.facts.governorate[0]} · <span dir="ltr">{r.phone}</span></div>
                                    </td>
                                    <td className="max-w-[16rem] px-4 py-2"><div className="line-clamp-2" dir="auto">{r.products.join("، ") || "—"}</div></td>
                                    <td className="px-4 py-2 tabular-nums" dir="ltr">{money(r.value)}</td>
                                    <td className="max-w-[12rem] px-4 py-2">
                                        <div>{r.moderator ? r.moderator.split("@")[0] : <span className="text-muted-foreground">مش معروف</span>}</div>
                                        {r.cancelReason && <div className="text-xs text-muted-foreground">{r.cancelReason}</div>}
                                    </td>
                                    <td className="max-w-[14rem] px-4 py-2">
                                        {r.lastReason ? <><div>{r.lastReason}</div>{r.lastNote && <div className="line-clamp-2 text-xs text-muted-foreground">{r.lastNote}</div>}</> : <span className="text-muted-foreground">—</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {list.length > count && (
                        <button type="button" onClick={() => setCount(c => c + ORDERS_SHOWN)}
                                className="w-full border-t px-4 py-2 text-sm text-primary hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            اعرض كمان ({int(list.length - count)} باقيين)
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}

export default function CancellationsPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <CancellationsContent />
        </Suspense>
    );
}
