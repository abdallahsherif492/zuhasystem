"use client";

import { CheckCircle2, CircleDashed, Package, XCircle } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";

/**
 * The orders tab's summary, as the page always had it: totals for won,
 * lost and remaining, and how many orders sit in each status — the same
 * groups, the same net value (total − shipping − 10), the statuses by their
 * own names. Clicking a status filters the table to it, so the count and the
 * orders behind it are one click apart.
 */

interface StatusOrder { status: string | null }

export const WON_STATUSES = ["Delivered", "Collected"];
export const LOST_STATUSES = ["Cancelled", "Unavailable", "Returned"];
export const REMAINING_STATUSES = ["Pending", "Prepared", "Shipped"];

type Tone = "won" | "lost" | "remaining" | "other";
const toneOf = (status: string): Tone =>
    WON_STATUSES.includes(status) ? "won" : LOST_STATUSES.includes(status) ? "lost" : REMAINING_STATUSES.includes(status) ? "remaining" : "other";

const TONE = {
    won: { dot: "bg-emerald-500", bar: "bg-emerald-500", ring: "ring-emerald-500 border-emerald-500", num: "text-emerald-700 dark:text-emerald-400" },
    lost: { dot: "bg-red-500", bar: "bg-red-400", ring: "ring-red-500 border-red-500", num: "text-red-700 dark:text-red-400" },
    remaining: { dot: "bg-sky-500", bar: "bg-sky-500", ring: "ring-sky-500 border-sky-500", num: "text-sky-700 dark:text-sky-400" },
    other: { dot: "bg-amber-400", bar: "bg-amber-400", ring: "ring-amber-500 border-amber-500", num: "text-amber-700 dark:text-amber-400" },
};

export function StatusOverview<T extends StatusOrder>({ orders, statusOrders, statuses, netValue, selected, onToggle, t }: {
    orders: T[];
    /** The same orders before the status filter, which the tiles count from. */
    statusOrders: T[];
    statuses: string[];
    netValue: (o: T) => number;
    selected: string[];
    onToggle: (status: string) => void;
    t: (key: string) => string;
}) {
    const sum = (list: T[]) => list.reduce((a, o) => a + netValue(o), 0);
    const inGroup = (group: string[]) => orders.filter(o => group.includes(o.status || ""));
    const won = inGroup(WON_STATUSES), lost = inGroup(LOST_STATUSES), remaining = inGroup(REMAINING_STATUSES);
    const total = orders.length;
    const rate = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "0%");

    const perStatus = statuses.map(status => {
        const list = statusOrders.filter(o => o.status === status);
        return { status, count: list.length, value: sum(list) };
    });
    const statusTotal = statusOrders.length;

    return (
        <div className="space-y-4">
            {/* The four totals */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Total icon={<Package className="h-5 w-5" />} label={t("Total Orders")} value={total.toLocaleString("en")}
                       sub={formatCurrency(sum(orders))} className="border-2 bg-card" />
                <Total icon={<CheckCircle2 className="h-5 w-5" />} label={t("Won Value (Rate)")} value={formatCurrency(sum(won))}
                       sub={`${won.length.toLocaleString("en")} ${t("Orders")} (${rate(won.length)})`}
                       className="border-emerald-600 bg-emerald-600 text-white dark:border-emerald-700 dark:bg-emerald-700" subClassName="text-emerald-50" />
                <Total icon={<XCircle className="h-5 w-5" />} label={t("Lost Value")} value={formatCurrency(sum(lost))}
                       sub={`${lost.length.toLocaleString("en")} ${t("Orders")} (${rate(lost.length)})`}
                       className="border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" />
                <Total icon={<CircleDashed className="h-5 w-5" />} label={t("Remaining")} value={formatCurrency(sum(remaining))}
                       sub={`${remaining.length.toLocaleString("en")} ${t("Orders")} (${t("Pending/Ship")})`}
                       className="border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300" />
            </div>

            {/* How many in each status */}
            <div className="rounded-xl border bg-card p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                    <div>
                        <h3 className="text-lg font-semibold">{t("Status Breakdown")}</h3>
                        <p className="text-xs text-muted-foreground">{t("Net value excludes shipping & fees")}</p>
                    </div>
                    {selected.length > 0 && (
                        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                            {selected.join(", ")}
                        </span>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {perStatus.map(m => {
                        const tone = TONE[toneOf(m.status)];
                        const active = selected.includes(m.status);
                        const share = statusTotal > 0 ? (m.count / statusTotal) * 100 : 0;
                        return (
                            <button key={m.status} type="button" onClick={() => onToggle(m.status)} aria-pressed={active}
                                    title={m.status}
                                    className={cn("rounded-lg border p-3 text-start transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                        active && cn("ring-1", tone.ring), m.count === 0 && "opacity-50")}>
                                <div className="flex items-center gap-1.5 text-sm font-medium">
                                    <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} aria-hidden />
                                    <span className="truncate">{m.status}</span>
                                </div>
                                <div className={cn("mt-1 text-3xl font-bold tabular-nums leading-tight", m.count ? tone.num : "text-muted-foreground")}>
                                    {m.count.toLocaleString("en")}
                                </div>
                                <div className="truncate text-sm font-medium tabular-nums text-foreground/80">{formatCurrency(m.value)}</div>
                                <div className="mt-2 flex items-center gap-2">
                                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                        <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${share}%` }} />
                                    </div>
                                    <span className="text-[11px] tabular-nums text-muted-foreground">{share.toFixed(0)}%</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function Total({ icon, label, value, sub, className, subClassName }: {
    icon: React.ReactNode; label: string; value: string; sub: string; className?: string; subClassName?: string;
}) {
    return (
        <div className={cn("rounded-xl border p-4 sm:p-5", className)}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold opacity-90">{label}</span>
                <span className="opacity-70" aria-hidden>{icon}</span>
            </div>
            <div className="mt-2 break-words text-xl font-bold tabular-nums leading-tight xl:text-2xl 2xl:text-3xl">{value}</div>
            <div className={cn("mt-1 text-sm opacity-80", subClassName)}>{sub}</div>
        </div>
    );
}
