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
    /** What each count is worth (20261014_dashboard_order_values.sql); absent until it is run. */
    orders_value?: number; waiting_value?: number; cancelled_value?: number;
    delivered_value?: number; returned_value?: number;
}
export interface Overview {
    period: Figures;
    previous: Figures;
    platform: { waiting: number; value: number; new: number; retry: number; due: number; oldest_new_at: string | null; oldest_at: string | null };
    platform_moderators: { email: string; confirmed: number; failed_attempts: number; orders_tried: number }[];
    shipping: { stuck: number; value: number; untouched: number; retry: number; reached: number; due_today: number };
    shipping_moderators: { email: string; followups: number; orders: number; reached: number; failed: number }[];
    /** From 20261010_dashboard_owner.sql; absent until it is run. */
    fulfilment: { pending: number; processing: number; prepared: number; aged: number; value: number; oldest_at: string | null; shipped_today: number } | null;
    flags: { unmapped: number; mismatch: number } | null;
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
        fulfilment: raw.fulfilment ? {
            pending: n(raw.fulfilment.pending), processing: n(raw.fulfilment.processing), prepared: n(raw.fulfilment.prepared),
            aged: n(raw.fulfilment.aged), value: n(raw.fulfilment.value), oldest_at: raw.fulfilment.oldest_at ?? null, shipped_today: n(raw.fulfilment.shipped_today),
        } : null,
        flags: raw.flags ? { unmapped: n(raw.flags.unmapped), mismatch: n(raw.flags.mismatch) } : null,
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

/**
 * The first thing on the dashboard: how many orders came in, how many were
 * confirmed, and what each is worth — large enough to read across the room.
 * Confirmed sales is the figure the business runs on, so it gets the one
 * solid colour on the page; everything else stays quiet around it.
 */
export function Scoreboard({ o, ar, compareLabel }: { o: Overview; ar: boolean; compareLabel: string }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const p = o.period, q = o.previous;
    const has = (v: number | undefined) => v !== undefined;
    const decided = n(p.confirmed) + n(p.cancelled), decidedBefore = n(q.confirmed) + n(q.cancelled);
    const closed = n(p.delivered) + n(p.returned), closedBefore = n(q.delivered) + n(q.returned);
    const confirmRate = rate(n(p.confirmed), decided), confirmBefore = rate(n(q.confirmed), decidedBefore);
    const deliveryRate = rate(n(p.delivered), closed), deliveryBefore = rate(n(q.delivered), closedBefore);
    const aov = n(p.confirmed) ? n(p.sales) / n(p.confirmed) : null;
    const aovBefore = n(q.confirmed) ? n(q.sales) / n(q.confirmed) : null;
    const total = n(p.orders);

    const split = [
        { key: "confirmed", label: t("اتأكد", "Confirmed"), count: n(p.confirmed), value: n(p.sales), bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
        { key: "waiting", label: t("مستني تأكيد", "Waiting"), count: n(p.waiting), value: has(p.waiting_value) ? n(p.waiting_value) : null, bar: "bg-amber-400", text: "text-amber-700 dark:text-amber-400" },
        { key: "cancelled", label: t("اتلغى", "Cancelled"), count: n(p.cancelled), value: has(p.cancelled_value) ? n(p.cancelled_value) : null, bar: "bg-red-400", text: "text-red-700 dark:text-red-400" },
    ];

    return (
        <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
                {/* All orders */}
                <div className="rounded-2xl border-2 bg-card p-5 sm:p-6">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-base font-semibold text-muted-foreground">{t("كل الأوردرات", "All orders")}</span>
                        <DeltaPill now={total} before={n(q.orders)} label={compareLabel} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
                        <span className="text-6xl font-bold tabular-nums leading-none tracking-tight" dir="ltr">{int(total)}</span>
                        <span className="text-lg text-muted-foreground">{t("أوردر", "orders")}</span>
                    </div>
                    {has(p.orders_value) && (
                        <div className="mt-3 text-3xl font-semibold tabular-nums sm:text-4xl"><span dir="ltr">{money(n(p.orders_value))}</span></div>
                    )}
                </div>

                {/* Confirmed orders and what they are worth */}
                <div className="rounded-2xl bg-emerald-600 p-5 text-white shadow-sm sm:p-6 dark:bg-emerald-700">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-base font-semibold text-emerald-50">{t("الأوردرات المتأكدة", "Confirmed orders")}</span>
                        <DeltaPill now={n(p.sales)} before={n(q.sales)} label={compareLabel} onColour />
                    </div>
                    <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
                        <span className="text-6xl font-bold tabular-nums leading-none tracking-tight" dir="ltr">{int(n(p.confirmed))}</span>
                        <span className="text-lg text-emerald-50">{t("أوردر", "orders")}</span>
                        {confirmRate !== null && (
                            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-sm font-semibold tabular-nums">
                                {t(`${confirmRate.toFixed(0)}% اتأكد`, `${confirmRate.toFixed(0)}% confirmed`)}
                            </span>
                        )}
                    </div>
                    <div className="mt-3 text-3xl font-bold tabular-nums sm:text-4xl"><span dir="ltr">{money(n(p.sales))}</span></div>
                </div>
            </div>

            {/* Where every order of the period stands */}
            <div className="rounded-2xl border bg-card p-4 sm:p-5">
                {total > 0 && (
                    <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-muted" role="img"
                         aria-label={split.map(x => `${x.label} ${x.count}`).join("، ")}>
                        {split.filter(x => x.count > 0).map(x => (
                            <div key={x.key} className={x.bar} style={{ width: `${(x.count / total) * 100}%` }} />
                        ))}
                    </div>
                )}
                <div className="grid grid-cols-3 gap-3 border-b pb-4">
                    {split.map(x => (
                        <div key={x.key} className="min-w-0">
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", x.bar)} aria-hidden />{x.label}
                            </div>
                            <div className={cn("mt-1 text-3xl font-bold tabular-nums leading-tight", x.text)}>{int(x.count)}</div>
                            {x.value !== null && <div className="truncate text-base font-semibold tabular-nums text-foreground/80"><span dir="ltr">{money(x.value)}</span></div>}
                        </div>
                    ))}
                </div>
                <div className="grid grid-cols-3 gap-3 pt-4">
                    <SmallFigure label={t("متوسط الأوردر", "Average order")} value={aov === null ? "—" : money(aov)}
                                 delta={<Delta now={aov} before={aovBefore} kind="percent" ar={ar} />} />
                    <SmallFigure label={t("نسبة التسليم", "Delivery rate")} value={deliveryRate === null ? "—" : `${deliveryRate.toFixed(0)}%`}
                                 delta={<Delta now={deliveryRate} before={deliveryBefore} kind="points" ar={ar} />}
                                 note={closed ? t(`${int(n(p.delivered))} اتسلم، ${int(n(p.returned))} مرتجع`, `${int(n(p.delivered))} delivered, ${int(n(p.returned))} returned`) : undefined} />
                    <SmallFigure label={t("نسبة التأكيد", "Confirmation rate")} value={confirmRate === null ? "—" : `${confirmRate.toFixed(0)}%`}
                                 delta={<Delta now={confirmRate} before={confirmBefore} kind="points" ar={ar} />} />
                </div>
            </div>
        </div>
    );
}

/** The change against the period before, as a pill beside a headline figure. */
function DeltaPill({ now, before, label, onColour }: { now: number; before: number; label: string; onColour?: boolean }) {
    if (!before) return null;
    const diff = ((now - before) / Math.abs(before)) * 100;
    if (!isFinite(diff)) return null;
    const flat = Math.abs(diff) < 0.5, up = diff > 0;
    return (
        <span title={label} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums",
            onColour ? "bg-white/20 text-white"
                : flat ? "bg-muted text-muted-foreground"
                : up ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300")}>
            <span aria-hidden>{flat ? "=" : up ? "▲" : "▼"}</span>
            <span dir="ltr">{flat ? "0" : Math.abs(diff).toFixed(0)}%</span>
            <span className="font-normal opacity-80">{label}</span>
        </span>
    );
}

function SmallFigure({ label, value, delta, note }: { label: string; value: string; delta?: React.ReactNode; note?: string }) {
    return (
        <div className="min-w-0">
            <div className="truncate text-sm text-muted-foreground">{label}</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="text-xl font-semibold tabular-nums" dir="ltr">{value}</span>
                {delta}
            </div>
            {note && <div className="truncate text-xs text-muted-foreground" title={note}>{note}</div>}
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

// ---------------------------------------------------------------------------
// Fulfilment: confirmed orders on their way out
// ---------------------------------------------------------------------------

/** One line from confirmed to shipped, with what has stalled. */
export function FulfilmentStrip({ o, ar }: { o: Overview; ar: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const f = o.fulfilment;
    if (!f) return null;
    const steps = [
        { label: t("مستني التجهيز", "Waiting to prepare"), value: f.pending },
        { label: t("بيتجهز", "Being prepared"), value: f.processing },
        { label: t("جاهز للشحن", "Ready to ship"), value: f.prepared },
        { label: t("اتشحن النهارده", "Shipped today"), value: f.shipped_today, done: true },
    ];
    return (
        <div className="mt-4 rounded-xl border bg-card">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
                <h3 className="font-semibold">{t("التجهيز والشحن", "Preparing and shipping")}</h3>
                <Link href="/logistics" className="rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t("افتح اللوجستيكس", "Open logistics")}
                </Link>
            </div>
            <ol className="grid grid-cols-2 sm:grid-cols-4">
                {steps.map((st, i) => (
                    <li key={st.label} className={cn("px-4 py-3 sm:px-5", i > 0 && "border-s", i >= 2 && "max-sm:border-t", i === 2 && "max-sm:border-s-0")}>
                        <div className="text-xs text-muted-foreground">{st.label}</div>
                        <div className={cn("mt-0.5 text-2xl font-semibold tabular-nums", st.done && "text-emerald-700 dark:text-emerald-400")}>{int(st.value)}</div>
                    </li>
                ))}
            </ol>
            <p className={cn("border-t px-4 py-2.5 text-sm sm:px-5", f.aged ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>
                {f.aged
                    ? t(`${int(f.aged)} أوردر مؤكد بقاله أكتر من يوم ومااتشحنش.`, `${int(f.aged)} confirmed orders have waited more than a day to ship.`)
                    : f.pending + f.processing + f.prepared
                        ? t("مفيش أوردر مؤكد متأخر في التجهيز.", "No confirmed order is late leaving.")
                        : t("مفيش أوردرات مستنية تجهيز.", "Nothing is waiting to be prepared.")}
            </p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

export interface AttentionItem { key: string; tone: "risk" | "attention" | "info"; text: string; href: string; action: string }

/** Everything on the dashboard that needs someone to act, most urgent first. Empty means nothing does. */
export function AttentionList({ items, ar, loading }: { items: AttentionItem[]; ar: boolean; loading?: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const order = { risk: 0, attention: 1, info: 2 } as const;
    const sorted = [...items].sort((a, b) => order[a.tone] - order[b.tone]);
    if (loading) return <div className="h-16 animate-pulse rounded-xl border bg-muted/30 motion-reduce:animate-none" />;
    if (!sorted.length) {
        return (
            <div className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground sm:px-5">
                {t("مفيش حاجة مستعجلة دلوقتي. كل الطوابير ماشية.", "Nothing urgent right now. Every queue is moving.")}
            </div>
        );
    }
    return (
        <ul className="divide-y rounded-xl border bg-card">
            {sorted.map(it => (
                <li key={it.key} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                    <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full",
                        it.tone === "risk" ? "bg-red-600" : it.tone === "attention" ? "bg-amber-500" : "bg-sky-500")} />
                    <span className="min-w-0 flex-1 text-sm">{it.text}</span>
                    <Link href={it.href} className="shrink-0 rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {it.action}
                    </Link>
                </li>
            ))}
        </ul>
    );
}

/** The attention items the overview can tell on its own. */
export function overviewAttention(o: Overview, ar: boolean): AttentionItem[] {
    const t = (a: string, e: string) => (ar ? a : e);
    const items: AttentionItem[] = [];
    const p = o.platform, s = o.shipping;
    const newAgeHours = p.oldest_new_at ? (Date.now() - new Date(p.oldest_new_at).getTime()) / 36e5 : 0;
    if (p.new > 0 && newAgeHours >= 2) {
        items.push({ key: "platform-new", tone: newAgeHours >= 12 ? "risk" : "attention", href: "/platform-orders",
            action: t("كلّمهم", "Call them"),
            text: t(`${int(p.new)} أوردر جديد من المنصات محدش كلّمه، أقدمهم مستني ${ago(p.oldest_new_at)}.`, `${int(p.new)} new store orders nobody has called; the oldest has waited since ${ago(p.oldest_new_at)}.`) });
    }
    if (p.due > 0) {
        items.push({ key: "platform-due", tone: "attention", href: "/platform-orders", action: t("إعادة المحاولة", "Retry"),
            text: t(`${int(p.due)} أوردر جاهزين تتصل بيهم تاني.`, `${int(p.due)} store orders are ready to be called again.`) });
    }
    if (o.flags?.unmapped) {
        items.push({ key: "unmapped", tone: "risk", href: "/platform-orders", action: t("اربط المنتج", "Link product"),
            text: t(`${int(o.flags.unmapped)} أوردر فيه منتج مش متربط بالمخزون، ومش هيتأكد غير لما يتربط.`, `${int(o.flags.unmapped)} store orders have an item not linked to a product and cannot be confirmed.`) });
    }
    if (o.flags?.mismatch) {
        items.push({ key: "mismatch", tone: "attention", href: "/platform-orders", action: t("راجعه", "Review"),
            text: t(`${int(o.flags.mismatch)} أوردر إجماليه مختلف عن اللي المتجر بعته.`, `${int(o.flags.mismatch)} store orders disagree with the store's total.`) });
    }
    if (s.untouched > 0) {
        items.push({ key: "ship-untouched", tone: "risk", href: "/logistics/issues", action: t("تابعهم", "Follow up"),
            text: t(`${int(s.untouched)} أوردر عالق عند الشحن محدش تابعه، بقيمة ${money(s.value)}.`, `${int(s.untouched)} orders stuck with couriers have had no follow-up (worth ${money(s.value)}).`) });
    }
    if (s.due_today > 0) {
        items.push({ key: "ship-due", tone: "attention", href: "/logistics/issues", action: t("افتحهم", "Open"),
            text: t(`${int(s.due_today)} متابعة شحن ميعادها النهارده.`, `${int(s.due_today)} shipping follow-ups are due today.`) });
    }
    if (o.fulfilment?.aged) {
        items.push({ key: "fulfil-aged", tone: "attention", href: "/logistics", action: t("جهّزهم", "Prepare"),
            text: t(`${int(o.fulfilment.aged)} أوردر مؤكد بقاله أكتر من يوم ومااتشحنش.`, `${int(o.fulfilment.aged)} confirmed orders have waited more than a day to ship.`) });
    }
    return items;
}

// ---------------------------------------------------------------------------
// Money (managers)
// ---------------------------------------------------------------------------

export interface Money {
    allowed: boolean;
    delivered_orders: number; delivered_sales: number; delivered_profit: number;
    returned_orders: number; return_shipping: number;
    ads: number; opex: number;
    expenses_by_category: { category: string; amount: number }[];
    payables: number;
    unpaid_salaries: { month: string; count: number; amount: number } | null;
}

export function normalizeMoney(raw: Money): Money {
    return {
        allowed: !!raw.allowed,
        delivered_orders: n(raw.delivered_orders), delivered_sales: n(raw.delivered_sales), delivered_profit: n(raw.delivered_profit),
        returned_orders: n(raw.returned_orders), return_shipping: n(raw.return_shipping),
        ads: n(raw.ads), opex: n(raw.opex),
        expenses_by_category: (raw.expenses_by_category || []).map(e => ({ category: e.category, amount: n(e.amount) })),
        payables: n(raw.payables),
        unpaid_salaries: raw.unpaid_salaries ? { month: raw.unpaid_salaries.month, count: n(raw.unpaid_salaries.count), amount: n(raw.unpaid_salaries.amount) } : null,
    };
}

export function moneyAttention(m: Money, ar: boolean): AttentionItem[] {
    const t = (a: string, e: string) => (ar ? a : e);
    const items: AttentionItem[] = [];
    if (m.unpaid_salaries?.count) {
        const month = new Intl.DateTimeFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", { month: "long" }).format(new Date(`${m.unpaid_salaries.month}T12:00:00`));
        items.push({ key: "salaries", tone: "attention", href: "/team/payroll", action: t("المرتبات", "Payroll"),
            text: t(`مرتبات ${month} لسه ماتسوّتش لـ ${int(m.unpaid_salaries.count)} موظف (${money(m.unpaid_salaries.amount)}).`, `${month} salaries are not settled for ${int(m.unpaid_salaries.count)} people (${money(m.unpaid_salaries.amount)}).`) });
    }
    if (m.payables > 0) {
        items.push({ key: "payables", tone: "info", href: "/payable", action: t("الموردين", "Suppliers"),
            text: t(`عليك ${money(m.payables)} للموردين.`, `You owe suppliers ${money(m.payables)}.`) });
    }
    return items;
}

/**
 * The period's money: what delivered orders earned, what returns, ads and
 * running costs took, and what is left; beside it, where the cash is.
 */
export function MoneyPanel({ m, treasury, couriers, ar }: {
    m: Money;
    treasury: { account_name: string; balance: number }[] | null;
    couriers: { company_name: string | null; outstanding: number }[] | null;
    ar: boolean;
}) {
    const t = (a: string, e: string) => (ar ? a : e);
    const net = m.delivered_profit - m.return_shipping - m.ads - m.opex;
    const topOpex = m.expenses_by_category.filter(e => e.category?.trim().toLowerCase() !== "ads").slice(0, 3);
    const lines: { label: string; hint?: string; amount: number; sign: 1 | -1 }[] = [
        { label: t("ربح الأوردرات اللي اتسلمت", "Profit on delivered orders"), hint: t(`${int(m.delivered_orders)} أوردر، بعد تكلفة البضاعة والشحن`, `${int(m.delivered_orders)} orders, after goods and courier`), amount: m.delivered_profit, sign: 1 },
        { label: t("شحن المرتجعات", "Courier fees on returns"), hint: t(`${int(m.returned_orders)} مرتجع`, `${int(m.returned_orders)} returns`), amount: m.return_shipping, sign: -1 },
        { label: t("الإعلانات", "Ads"), amount: m.ads, sign: -1 },
        { label: t("مصاريف التشغيل", "Running costs"), hint: topOpex.map(e => `${e.category} ${int(e.amount)}`).join("، ") || undefined, amount: m.opex, sign: -1 },
    ];
    const cash = (treasury || []).reduce((s, a) => s + n(a.balance), 0);
    const owed = (couriers || []).filter(c => c.company_name).reduce((s, c) => s + n(c.outstanding), 0);
    const topCouriers = (couriers || []).filter(c => c.company_name && n(c.outstanding) > 0).sort((a, b) => n(b.outstanding) - n(a.outstanding)).slice(0, 3);

    return (
        <div className="grid gap-4 lg:grid-cols-5">
            <div className="rounded-xl border bg-card lg:col-span-3">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
                    <h3 className="font-semibold">{t("الربح في الفترة", "Profit in the period")}</h3>
                    <Link href="/insights" className="rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("التقارير", "Reports")}</Link>
                </div>
                <dl className="divide-y">
                    {lines.map(l => (
                        <div key={l.label} className="flex items-baseline justify-between gap-4 px-4 py-2.5 sm:px-5">
                            <dt className="min-w-0">
                                <div className="text-sm">{l.label}</div>
                                {l.hint && <div className="truncate text-xs text-muted-foreground" title={l.hint}>{l.hint}</div>}
                            </dt>
                            <dd className={cn("shrink-0 text-sm font-medium tabular-nums", l.sign < 0 && "text-red-700 dark:text-red-400")} dir="ltr">
                                {l.sign < 0 ? "−" : ""}{money(l.amount)}
                            </dd>
                        </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-4 bg-muted/40 px-4 py-3 sm:px-5">
                        <dt>
                            <div className="font-semibold">{t("الصافي التقديري", "Estimated net")}</div>
                            <div className="text-xs text-muted-foreground">
                                {m.unpaid_salaries?.count ? t("قبل المرتبات اللي لسه ماتسجلتش", "Before salaries not yet booked") : t("المصاريف حسب تاريخ تسجيلها في الحسابات", "Costs dated as booked in accounting")}
                            </div>
                        </dt>
                        <dd className={cn("text-xl font-bold tabular-nums", net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")} dir="ltr">{money(net)}</dd>
                    </div>
                </dl>
            </div>

            <div className="flex flex-col rounded-xl border bg-card lg:col-span-2">
                <div className="border-b px-4 py-3 sm:px-5"><h3 className="font-semibold">{t("الفلوس فين", "Where the money is")}</h3></div>
                <dl className="divide-y">
                    <div className="px-4 py-3 sm:px-5">
                        <dt className="flex items-center justify-between text-sm text-muted-foreground">
                            <span>{t("في الخزنة", "In the treasury")}</span>
                            <Link href="/accounting" className="text-primary underline-offset-4 hover:underline">{t("الحسابات", "Accounting")}</Link>
                        </dt>
                        <dd className="mt-0.5 text-2xl font-semibold tabular-nums" dir="ltr">{treasury ? money(cash) : "—"}</dd>
                        {treasury && treasury.length > 1 && (
                            <div className="mt-1 text-xs text-muted-foreground">{treasury.map(a => `${a.account_name} ${int(n(a.balance))}`).join("، ")}</div>
                        )}
                    </div>
                    <div className="px-4 py-3 sm:px-5">
                        <dt className="flex items-center justify-between text-sm text-muted-foreground">
                            <span>{t("لسه عند شركات الشحن", "Still with couriers")}</span>
                            <Link href="/shipping/statement" className="text-primary underline-offset-4 hover:underline">{t("كشف الحساب", "Statement")}</Link>
                        </dt>
                        <dd className="mt-0.5 text-2xl font-semibold tabular-nums" dir="ltr">{couriers ? money(Math.max(owed, 0)) : "—"}</dd>
                        {topCouriers.length > 0 && (
                            <div className="mt-1 text-xs text-muted-foreground">{topCouriers.map(c => `${c.company_name} ${int(n(c.outstanding))}`).join("، ")}</div>
                        )}
                    </div>
                    {m.payables > 0 && (
                        <div className="px-4 py-3 sm:px-5">
                            <dt className="flex items-center justify-between text-sm text-muted-foreground">
                                <span>{t("عليك للموردين", "Owed to suppliers")}</span>
                                <Link href="/payable" className="text-primary underline-offset-4 hover:underline">{t("الموردين", "Suppliers")}</Link>
                            </dt>
                            <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-red-700 dark:text-red-400" dir="ltr">{money(m.payables)}</dd>
                        </div>
                    )}
                </dl>
            </div>
        </div>
    );
}
