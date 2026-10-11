"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { ago } from "@/components/orders/confirmation-attempts";

/**
 * The dashboard's overview: how the period went, and what work is waiting
 * for the moderators. One call to dashboard_overview()
 * (20261009_dashboard_overview.sql) feeds all of it.
 */

export interface Figures {
    orders?: number; waiting?: number; cancelled?: number; confirmed?: number;
    delivered?: number; returned?: number; sales?: number;
}
export interface Overview {
    period: Figures;
    previous: Figures;
    platform: { waiting: number; value: number; new: number; retry: number; due: number; oldest_new_at: string | null; oldest_at: string | null };
    platform_moderators: { email: string; confirmed: number; failed_attempts: number; orders_tried: number }[];
    shipping: { stuck: number; value: number; untouched: number; retry: number; reached: number; due_today: number };
    shipping_moderators: { email: string; followups: number; orders: number; reached: number; failed: number }[];
    me: string;
}

const n = (v: unknown) => Number(v) || 0;
const int = (v: number) => Math.round(v).toLocaleString("en");
const who = (email: string) => email.split("@")[0];
/** Whole pounds: piastres on a figure this size are noise. */
const money = (v: number) => formatCurrency(Math.round(v)).replace(/\.00$/, "");

/** JSON numbers can arrive as strings; make every figure a number once. */
export function normalizeOverview(raw: Overview): Overview {
    const f = (x: Figures = {}): Figures => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, n(v)]));
    const p = raw.platform || ({} as Overview["platform"]);
    const s = raw.shipping || ({} as Overview["shipping"]);
    return {
        period: f(raw.period),
        previous: f(raw.previous),
        platform: { waiting: n(p.waiting), value: n(p.value), new: n(p.new), retry: n(p.retry), due: n(p.due), oldest_new_at: p.oldest_new_at ?? null, oldest_at: p.oldest_at ?? null },
        platform_moderators: (raw.platform_moderators || []).map(m => ({ email: m.email, confirmed: n(m.confirmed), failed_attempts: n(m.failed_attempts), orders_tried: n(m.orders_tried) })),
        shipping: { stuck: n(s.stuck), value: n(s.value), untouched: n(s.untouched), retry: n(s.retry), reached: n(s.reached), due_today: n(s.due_today) },
        shipping_moderators: (raw.shipping_moderators || []).map(m => ({ email: m.email, followups: n(m.followups), orders: n(m.orders), reached: n(m.reached), failed: n(m.failed) })),
        me: (raw.me || "").toLowerCase(),
    };
}

// ---------------------------------------------------------------------------
// Section frame
// ---------------------------------------------------------------------------

/** A titled band of the dashboard: what it answers, and where to go for more. */
export function Section({ id, title, description, aside, children }: {
    id: string; title: string; description?: string; aside?: React.ReactNode; children: React.ReactNode;
}) {
    return (
        <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
            <header className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                    <h2 id={`${id}-title`} className="text-lg font-semibold leading-tight">{title}</h2>
                    {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
                </div>
                {aside}
            </header>
            {children}
        </section>
    );
}

const readStored = (key: string) => { try { return localStorage.getItem(key) === "1"; } catch { return false; } };
const subscribeStorage = (cb: () => void) => { window.addEventListener("storage", cb); return () => window.removeEventListener("storage", cb); };

/** Detail kept one click away, remembered per browser. Closed on the server and until read. */
export function Disclosure({ storageKey, label, children }: { storageKey: string; label: string; children: React.ReactNode }) {
    const stored = useSyncExternalStore(subscribeStorage, () => readStored(storageKey), () => false);
    const [override, setOverride] = useState<boolean | null>(null);
    const open = override ?? stored;
    const toggle = () => {
        try { localStorage.setItem(storageKey, open ? "0" : "1"); } catch { /* storage unavailable */ }
        setOverride(!open);
    };
    return (
        <div className="mt-4">
            <button type="button" onClick={toggle} aria-expanded={open}
                    className="flex w-full items-center justify-between rounded-lg border border-dashed px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span>{label}</span>
                <ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
            </button>
            {open && <div className="mt-4">{children}</div>}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Period performance
// ---------------------------------------------------------------------------

const rate = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

function Delta({ now, before, kind, ar }: { now: number | null; before: number | null; kind: "percent" | "points"; ar: boolean }) {
    if (now === null || before === null) return null;
    const diff = kind === "points" ? now - before : before ? ((now - before) / Math.abs(before)) * 100 : null;
    if (diff === null || !isFinite(diff)) return null;
    const flat = Math.abs(diff) < 0.5;
    const up = diff > 0;
    return (
        <span className={cn("text-xs font-medium tabular-nums", flat ? "text-muted-foreground" : up ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}
              title={ar ? "مقارنة بالفترة اللي قبلها" : "Against the period before"}>
            <span aria-hidden>{flat ? "=" : up ? "▲" : "▼"}</span>{" "}
            <span dir="ltr">{flat ? "0" : Math.abs(diff).toFixed(kind === "points" ? 1 : 0)}{kind === "points" ? (ar ? " نقطة" : " pts") : "%"}</span>
        </span>
    );
}

export function PerformanceStrip({ o, ar }: { o: Overview; ar: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const p = o.period, q = o.previous;
    const decided = n(p.confirmed) + n(p.cancelled), decidedBefore = n(q.confirmed) + n(q.cancelled);
    const closed = n(p.delivered) + n(p.returned), closedBefore = n(q.delivered) + n(q.returned);
    const confirmRate = rate(n(p.confirmed), decided), confirmBefore = rate(n(q.confirmed), decidedBefore);
    const deliveryRate = rate(n(p.delivered), closed), deliveryBefore = rate(n(q.delivered), closedBefore);
    const aov = n(p.confirmed) ? n(p.sales) / n(p.confirmed) : null;
    const aovBefore = n(q.confirmed) ? n(q.sales) / n(q.confirmed) : null;

    const cells: { label: string; value: string; delta: React.ReactNode; note: string }[] = [
        {
            label: t("المبيعات المؤكدة", "Confirmed sales"),
            value: money(n(p.sales)),
            delta: <Delta now={n(p.sales)} before={n(q.sales)} kind="percent" ar={ar} />,
            note: t(`${int(n(p.confirmed))} أوردر اتأكد`, `${int(n(p.confirmed))} orders confirmed`),
        },
        {
            label: t("الأوردرات", "Orders"),
            value: int(n(p.orders)),
            delta: <Delta now={n(p.orders)} before={n(q.orders)} kind="percent" ar={ar} />,
            note: n(p.waiting) ? t(`${int(n(p.waiting))} لسه مستني تأكيد`, `${int(n(p.waiting))} still waiting`) : t("كلهم اتراجعوا", "All reviewed"),
        },
        {
            label: t("نسبة التأكيد", "Confirmation rate"),
            value: confirmRate === null ? "—" : `${confirmRate.toFixed(0)}%`,
            delta: <Delta now={confirmRate} before={confirmBefore} kind="points" ar={ar} />,
            note: decided ? t(`اتلغى ${int(n(p.cancelled))} من ${int(decided)}`, `${int(n(p.cancelled))} of ${int(decided)} cancelled`) : t("لسه مفيش قرارات", "Nothing decided yet"),
        },
        {
            label: t("نسبة التسليم", "Delivery rate"),
            value: deliveryRate === null ? "—" : `${deliveryRate.toFixed(0)}%`,
            delta: <Delta now={deliveryRate} before={deliveryBefore} kind="points" ar={ar} />,
            note: closed ? t(`${int(n(p.delivered))} اتسلم و${int(n(p.returned))} مرتجع`, `${int(n(p.delivered))} delivered, ${int(n(p.returned))} returned`) : t("لسه محدش وصله أوردر", "None delivered yet"),
        },
        {
            label: t("متوسط الأوردر", "Average order"),
            value: aov === null ? "—" : money(aov),
            delta: <Delta now={aov} before={aovBefore} kind="percent" ar={ar} />,
            note: t("المبيعات المؤكدة ÷ عدد الأوردرات المؤكدة", "Confirmed sales ÷ confirmed orders"),
        },
    ];

    return (
        <div className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card md:grid-cols-5">
            {cells.map((c, i) => (
                <div key={c.label} className={cn("min-w-0 p-4 sm:p-5", i > 0 && "border-s", i === 2 && "max-md:border-s-0", i >= 2 && "max-md:border-t", i === 4 && "col-span-2 md:col-span-1 max-md:border-s-0")}>
                    <div className="text-sm text-muted-foreground">{c.label}</div>
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-2xl font-semibold tabular-nums tracking-tight sm:text-[1.7rem]" dir="ltr">{c.value}</span>
                        {c.delta}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground" title={c.note}>{c.note}</div>
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Work queues
// ---------------------------------------------------------------------------

/** A proportional bar of how the queue splits, with its key. */
function SplitBar({ parts, label }: { parts: { value: number; className: string; name: string }[]; label: string }) {
    const total = parts.reduce((s, p) => s + p.value, 0);
    if (!total) return null;
    return (
        <div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={label}>
                {parts.filter(p => p.value > 0).map(p => (
                    <div key={p.name} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} />
                ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {parts.map(p => (
                    <span key={p.name} className="inline-flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 rounded-full", p.className)} aria-hidden />
                        <span className="text-muted-foreground">{p.name}</span>
                        <span className="font-semibold tabular-nums">{int(p.value)}</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

function Panel({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col rounded-xl border bg-card">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
                <h3 className="font-semibold">{title}</h3>
                <Link href={href} className="text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                    {linkLabel}
                </Link>
            </div>
            {children}
        </div>
    );
}

/** "Right now": the one big figure and the sentence that says how urgent it is. */
function Now({ count, unit, value, urgency, tone }: { count: number; unit: string; value?: string; urgency?: string; tone: "calm" | "attention" | "risk" }) {
    return (
        <div>
            <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={cn("text-4xl font-bold tabular-nums tracking-tight",
                    tone === "calm" ? "text-foreground" : tone === "attention" ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400")}>
                    {int(count)}
                </span>
                <span className="text-sm">{unit}</span>
                {value && <span className="text-sm text-muted-foreground">{value}</span>}
            </div>
            {urgency && <p className="mt-1 text-sm text-muted-foreground">{urgency}</p>}
        </div>
    );
}

function MiniTable({ head, rows, empty, me }: {
    head: string[];
    rows: { email: string; cells: React.ReactNode[]; share: number }[];
    empty: string;
    me: string;
}) {
    if (!rows.length) return <p className="px-4 pb-4 pt-1 text-sm text-muted-foreground sm:px-5">{empty}</p>;
    return (
        <table className="w-full text-sm">
            <thead>
                <tr className="text-xs text-muted-foreground [&>th]:px-2 [&>th]:pb-1.5 [&>th]:text-start [&>th]:font-normal [&>th:first-child]:ps-4 sm:[&>th:first-child]:ps-5 [&>th:last-child]:pe-4 sm:[&>th:last-child]:pe-5">
                    {head.map(h => <th key={h}>{h}</th>)}
                </tr>
            </thead>
            <tbody>
                {rows.map(r => (
                    <tr key={r.email} className={cn("border-t [&>td]:px-2 [&>td]:py-2 [&>td:first-child]:ps-4 sm:[&>td:first-child]:ps-5 [&>td:last-child]:pe-4 sm:[&>td:last-child]:pe-5", r.email === me && "bg-primary/[0.05]")}>
                        <td className="w-[38%]">
                            <div className="truncate font-medium" title={r.email}>{who(r.email)}</div>
                            <div className="mt-1 h-1 rounded-full bg-muted">
                                <div className="h-1 rounded-full bg-primary/70" style={{ width: `${Math.max(4, r.share * 100)}%` }} />
                            </div>
                        </td>
                        {r.cells.map((c, i) => <td key={i} className="tabular-nums">{c}</td>)}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function PlatformQueue({ o, ar, periodLabel }: { o: Overview; ar: boolean; periodLabel: string }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const q = o.platform;
    const notDue = q.retry - q.due;
    const urgency = !q.waiting
        ? t("مفيش أوردرات مستنية تأكيد.", "Nothing is waiting to be confirmed.")
        : q.oldest_new_at
            ? t(`أقدم أوردر جديد مستني ${ago(q.oldest_new_at)}.`, `The oldest new order has waited since ${new Date(q.oldest_new_at).toLocaleString()}.`)
            : t("كل الجديد اتكلّم، الباقي إعادة محاولة.", "Every new order has been called; the rest are retries.");
    const top = Math.max(1, ...o.platform_moderators.map(m => m.confirmed));
    return (
        <Panel title={t("تأكيد طلبات المنصات", "Confirming store orders")} href="/platform-orders" linkLabel={t("افتح طلبات المنصات", "Open store orders")}>
            <div className="space-y-4 px-4 py-4 sm:px-5">
                <Now count={q.waiting} unit={t("أوردر مستني تأكيد", "orders to confirm")} value={q.waiting ? t(`بقيمة ${money(q.value)}`, `worth ${money(q.value)}`) : undefined}
                     urgency={urgency} tone={!q.waiting ? "calm" : q.new ? "attention" : "calm"} />
                <SplitBar label={t("تقسيم الأوردرات المستنية", "Waiting orders by stage")} parts={[
                    { name: t("جديدة", "New"), value: q.new, className: "bg-amber-500" },
                    { name: t("جاهزة تتصل تاني", "Ready to call again"), value: q.due, className: "bg-orange-600" },
                    { name: t("اتكلمت من شوية", "Called recently"), value: notDue, className: "bg-orange-300 dark:bg-orange-800" },
                ]} />
            </div>
            <div className="mt-auto border-t pt-3">
                <div className="px-4 pb-2 text-xs text-muted-foreground sm:px-5">{t(`اللي أكّده كل مودريتور ${periodLabel}`, `Confirmed by each moderator ${periodLabel}`)}</div>
                <MiniTable
                    me={o.me}
                    head={[t("المودريتور", "Moderator"), t("أكّد", "Confirmed"), t("محاولات ماتأكدتش", "Failed attempts")]}
                    empty={t("محدش أكّد أوردرات من المنصات في الفترة دي.", "No store orders confirmed in this period.")}
                    rows={o.platform_moderators.map(m => ({
                        email: m.email,
                        share: m.confirmed / top,
                        cells: [<span key="c" className="font-semibold">{int(m.confirmed)}</span>, <span key="f" className={m.failed_attempts ? "" : "text-muted-foreground"}>{int(m.failed_attempts)}</span>],
                    }))}
                />
            </div>
        </Panel>
    );
}

export function ShippingQueue({ o, ar, periodLabel }: { o: Overview; ar: boolean; periodLabel: string }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const s = o.shipping;
    const urgency = !s.stuck
        ? t("مفيش أوردرات عالقة عند شركات الشحن.", "No orders are stuck with couriers.")
        : s.untouched
            ? t(`${int(s.untouched)} منهم محدش اتصل بيهم خالص${s.due_today ? `، و${int(s.due_today)} ميعاد متابعتهم النهارده` : ""}.`,
                `${int(s.untouched)} have had no follow-up at all${s.due_today ? `, and ${int(s.due_today)} are due today` : ""}.`)
            : s.due_today
                ? t(`${int(s.due_today)} ميعاد متابعتهم النهارده.`, `${int(s.due_today)} are due a follow-up today.`)
                : t("كلهم اتتابعوا.", "All have been followed up.");
    const top = Math.max(1, ...o.shipping_moderators.map(m => m.followups));
    return (
        <Panel title={t("متابعة مشاكل الشحن", "Following up shipping problems")} href="/logistics/issues" linkLabel={t("افتح مشاكل الشحن", "Open shipping problems")}>
            <div className="space-y-4 px-4 py-4 sm:px-5">
                <Now count={s.stuck} unit={t("أوردر عالق عند الشحن", "orders stuck with couriers")} value={s.stuck ? t(`بقيمة ${money(s.value)}`, `worth ${money(s.value)}`) : undefined}
                     urgency={urgency} tone={!s.stuck ? "calm" : s.untouched ? "risk" : "attention"} />
                <SplitBar label={t("تقسيم الأوردرات العالقة", "Stuck orders by follow-up")} parts={[
                    { name: t("محدش تابعها", "Not followed up"), value: s.untouched, className: "bg-red-600" },
                    { name: t("إعادة محاولة", "Try again"), value: s.retry, className: "bg-amber-500" },
                    { name: t("اتوصلنا", "Reached"), value: s.reached, className: "bg-emerald-600" },
                ]} />
            </div>
            <div className="mt-auto border-t pt-3">
                <div className="px-4 pb-2 text-xs text-muted-foreground sm:px-5">{t(`متابعات كل مودريتور ${periodLabel}`, `Follow-ups by each moderator ${periodLabel}`)}</div>
                <MiniTable
                    me={o.me}
                    head={[t("المودريتور", "Moderator"), t("متابعات", "Follow-ups"), t("اتوصلنا", "Reached"), t("ماوصلناش", "Not reached")]}
                    empty={t("محدش سجّل متابعات شحن في الفترة دي.", "No shipping follow-ups in this period.")}
                    rows={o.shipping_moderators.map(m => ({
                        email: m.email,
                        share: m.followups / top,
                        cells: [
                            <span key="f" className="font-semibold">{int(m.followups)}</span>,
                            <span key="r" className={m.reached ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{int(m.reached)}</span>,
                            <span key="x" className={m.failed ? "" : "text-muted-foreground"}>{int(m.failed)}</span>,
                        ],
                    }))}
                />
            </div>
        </Panel>
    );
}
