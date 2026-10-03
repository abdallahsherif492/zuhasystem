"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, startOfMonth } from "date-fns";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Lightbulb, Loader2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/date-range-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    AD_GROUP_LABEL, byView, change, channelColor, moderatorName, normalize, previousPeriod, rates, totals,
    type AdGroup, type ChannelAnalytics, type ChannelRow,
} from "@/lib/insights/channel-analytics";

const MIGRATION = "supabase/migrations/20261004_channel_analytics.sql";
const pct = (v: number | null, digits = 1) => (v === null ? "—" : `${v.toFixed(digits)}%`);
const money = (v: number | null) => (v === null ? "—" : formatCurrency(v));
const int = (v: number) => Math.round(v).toLocaleString("en");

function ChannelAnalyticsContent() {
    const { activeBusiness } = useBusiness();
    const { language } = useLanguage();
    const ar = language !== "en";
    const t = (a: string, e: string) => (ar ? a : e);
    const router = useRouter();
    const params = useSearchParams();
    const from = params.get("from");
    const to = params.get("to");

    const [data, setData] = useState<ChannelAnalytics | null>(null);
    const [prev, setPrev] = useState<ChannelAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<"missing" | "failed" | null>(null);
    const [errorDetail, setErrorDetail] = useState("");
    const [view, setView] = useState<"channel" | "group">("channel");
    const [productChannel, setProductChannel] = useState<string | null>(null);

    useEffect(() => {
        if (!from || !to) {
            router.replace(`?from=${format(startOfMonth(new Date()), "yyyy-MM-dd")}&to=${format(new Date(), "yyyy-MM-dd")}`);
            return;
        }
        if (!activeBusiness) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const p = previousPeriod(from, to);
                const [now, before] = await Promise.all([
                    supabase.rpc("channel_analytics", { p_business_id: activeBusiness.id, p_from: from, p_to: to }),
                    supabase.rpc("channel_analytics", { p_business_id: activeBusiness.id, p_from: p.from, p_to: p.to }),
                ]);
                if (cancelled) return;
                if (now.error) {
                    console.error("channel_analytics failed:", now.error);
                    setErrorDetail([now.error.code, now.error.message].filter(Boolean).join(" — "));
                    setError(now.error.code === "PGRST202" || /could not find|does not exist/i.test(now.error.message) ? "missing" : "failed");
                    return;
                }
                setError(null);
                setData(normalize(now.data as ChannelAnalytics));
                setPrev(before.error ? null : normalize(before.data as ChannelAnalytics));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [from, to, activeBusiness, router]);

    const rows = useMemo(() => (data ? byView(data.channels, view) : []), [data, view]);
    const prevRows = useMemo(() => (prev ? byView(prev.channels, view) : []), [prev, view]);
    const all = useMemo(() => totals(rows), [rows]);
    const allPrev = useMemo(() => totals(prevRows), [prevRows]);
    const label = (c: string) => (view === "group" ? (ar ? AD_GROUP_LABEL[c as AdGroup].ar : AD_GROUP_LABEL[c as AdGroup].en) : c);

    if (!from || !to) return null;

    return (
        <div className="space-y-6 p-0 pt-2 sm:p-4" dir={ar ? "rtl" : "ltr"}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t("تحليل القنوات", "Channel analytics")}</h1>
                    <p className="text-sm text-muted-foreground">
                        {t(`مقارنة بالفترة اللي قبلها (${previousPeriod(from, to).from} → ${previousPeriod(from, to).to})`, `Compared with the period before (${previousPeriod(from, to).from} → ${previousPeriod(from, to).to})`)}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg border bg-muted p-1">
                        {(["channel", "group"] as const).map(v => (
                            <button key={v} onClick={() => setView(v)} className={cn("rounded-md px-3 py-1 text-sm font-medium", view === v ? "bg-background shadow-sm" : "text-muted-foreground")}>
                                {v === "channel" ? t("القنوات", "Channels") : t("مجموعات الإعلانات", "Ad groups")}
                            </button>
                        ))}
                    </div>
                    <div dir="ltr"><DateRangePicker /></div>
                </div>
            </div>

            {error === "missing" ? (
                <Card className="border-amber-300">
                    <CardContent className="flex gap-3 p-5 text-sm">
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                        <div>
                            <div className="font-medium">{t("محتاج تشغّل migration الأول", "Run the migration first")}</div>
                            <p className="mt-1 text-muted-foreground">{t("شغّل الملف ده في Supabase → SQL Editor:", "Run this file in Supabase → SQL Editor:")} <code className="rounded bg-muted px-1" dir="ltr">{MIGRATION}</code></p>
                        </div>
                    </CardContent>
                </Card>
            ) : error === "failed" ? (
                <div className="p-10 text-center text-muted-foreground">
                    <p>{t("مش قادر أحمّل البيانات. جرّب تاني.", "Could not load the data. Try again.")}</p>
                    {errorDetail && <p className="mt-2 font-mono text-xs" dir="ltr">{errorDetail}</p>}
                </div>
            ) : loading || !data ? (
                <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>
            ) : all.orders === 0 ? (
                <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">{t("مفيش أوردرات في الفترة دي.", "No orders in these dates.")}</p>
            ) : (
                <>
                    <Kpis data={data} all={all} allPrev={prevRows.length ? allPrev : null} ar={ar} />
                    <Insights rows={rows} label={label} ar={ar} />
                    <ChannelTable rows={rows} prevRows={prevRows} all={all} label={label} ar={ar} />

                    <div className="grid gap-4 lg:grid-cols-2">
                        <StatusChart rows={rows} label={label} ar={ar} />
                        <DailyChart data={data} view={view} label={label} ar={ar} />
                    </div>

                    <AdsSection data={data} ar={ar} />
                    <Moderators data={data} ar={ar} />
                    <Products data={data} selected={productChannel} onSelect={setProductChannel} ar={ar} />
                </>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------

function Delta({ value, invert }: { value: number | null; invert?: boolean }) {
    if (value === null || !isFinite(value)) return null;
    const good = invert ? value < 0 : value > 0;
    const Icon = value >= 0 ? ArrowUpRight : ArrowDownRight;
    return (
        <span dir="ltr" className={cn("inline-flex items-center text-xs font-medium", Math.abs(value) < 0.5 ? "text-muted-foreground" : good ? "text-emerald-600" : "text-red-600")}>
            <Icon className="h-3 w-3" />{Math.abs(value).toFixed(0)}%
        </span>
    );
}

function Kpis({ data, all, allPrev, ar }: { data: ChannelAnalytics; all: ChannelRow; allPrev: ChannelRow | null; ar: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const r = rates(all);
    const p = allPrev ? rates(allPrev) : null;
    const ads = data.ads.reduce((s, a) => s + a.spend, 0);
    const items: { label: string; value: string; delta?: number | null; invert?: boolean; hint?: string; tone?: "good" | "bad" }[] = [
        { label: t("الأوردرات", "Orders"), value: int(all.orders), delta: allPrev && change(all.orders, allPrev.orders), hint: t(`${int(r.confirmed)} مؤكد`, `${int(r.confirmed)} confirmed`) },
        { label: t("نسبة الإلغاء", "Cancel rate"), value: pct(r.cancelRate), delta: p && r.cancelRate !== null && p.cancelRate !== null ? r.cancelRate - p.cancelRate : null, invert: true, hint: t(`${int(all.cancelled)} ملغي`, `${int(all.cancelled)} cancelled`) },
        { label: t("نسبة التسليم", "Delivery rate"), value: pct(r.deliveryRate), delta: p && r.deliveryRate !== null && p.deliveryRate !== null ? r.deliveryRate - p.deliveryRate : null, hint: t(`${int(all.delivered)} اتسلم · ${int(all.returned)} مرتجع`, `${int(all.delivered)} delivered · ${int(all.returned)} returned`) },
        { label: t("مبيعات اتسلمت", "Delivered sales"), value: money(all.delivered_sales), delta: allPrev && change(all.delivered_sales, allPrev.delivered_sales), hint: `${t("متوسط الأوردر", "AOV")} ${money(r.aov)}` },
        { label: t("ربح المسلَّم", "Delivered profit"), value: money(all.delivered_profit), delta: allPrev && change(all.delivered_profit, allPrev.delivered_profit), hint: `${t("شحن المرتجعات", "Return shipping")} −${money(all.return_shipping)}` },
        { label: t("الصافي بعد الإعلانات", "Net after ads"), value: money(r.net - ads), tone: r.net - ads >= 0 ? "good" : "bad", hint: `${t("إعلانات", "Ads")} ${money(ads)}` },
    ];
    return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {items.map(k => (
                <Card key={k.label}>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground"><span>{k.label}</span><Delta value={k.delta ?? null} invert={k.invert} /></div>
                        <div className={cn("mt-1 text-lg font-bold", k.tone === "good" && "text-emerald-600 dark:text-emerald-400", k.tone === "bad" && "text-red-600 dark:text-red-400")}><span dir="ltr">{k.value}</span></div>
                        {k.hint && <div className="mt-0.5 text-xs text-muted-foreground">{k.hint}</div>}
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

/** A few plain-language findings, only those the data supports. */
function Insights({ rows, label, ar }: { rows: ChannelRow[]; label: (c: string) => string; ar: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const big = rows.filter(r => r.orders >= 20);
    if (big.length < 2) return null;
    const out: string[] = [];
    const by = (f: (r: ChannelRow) => number | null) => big.map(r => ({ r, v: f(r) })).filter(x => x.v !== null) as { r: ChannelRow; v: number }[];

    const cancel = by(r => rates(r).cancelRate).sort((a, b) => b.v - a.v);
    if (cancel.length >= 2 && cancel[0].v - cancel[cancel.length - 1].v >= 10)
        out.push(t(`${label(cancel[0].r.channel)} نسبة الإلغاء فيه ${cancel[0].v.toFixed(0)}% مقابل ${cancel[cancel.length - 1].v.toFixed(0)}% في ${label(cancel[cancel.length - 1].r.channel)} — راجع تأكيد أوردراته.`,
            `${label(cancel[0].r.channel)} cancels ${cancel[0].v.toFixed(0)}% of orders against ${cancel[cancel.length - 1].v.toFixed(0)}% on ${label(cancel[cancel.length - 1].r.channel)} — review how its orders are confirmed.`));

    const deliv = by(r => rates(r).deliveryRate).sort((a, b) => b.v - a.v);
    if (deliv.length >= 2 && deliv[0].v - deliv[deliv.length - 1].v >= 5)
        out.push(t(`أعلى نسبة تسليم: ${label(deliv[0].r.channel)} (${deliv[0].v.toFixed(0)}%)، وأقلها ${label(deliv[deliv.length - 1].r.channel)} (${deliv[deliv.length - 1].v.toFixed(0)}%).`,
            `Best delivery rate: ${label(deliv[0].r.channel)} (${deliv[0].v.toFixed(0)}%); lowest: ${label(deliv[deliv.length - 1].r.channel)} (${deliv[deliv.length - 1].v.toFixed(0)}%).`));

    const ppo = by(r => rates(r).profitPerDelivered).sort((a, b) => b.v - a.v);
    if (ppo.length >= 2)
        out.push(t(`ربح الأوردر المسلَّم أعلى في ${label(ppo[0].r.channel)} (${formatCurrency(ppo[0].v)}) وأقل في ${label(ppo[ppo.length - 1].r.channel)} (${formatCurrency(ppo[ppo.length - 1].v)}).`,
            `Profit per delivered order is highest on ${label(ppo[0].r.channel)} (${formatCurrency(ppo[0].v)}) and lowest on ${label(ppo[ppo.length - 1].r.channel)} (${formatCurrency(ppo[ppo.length - 1].v)}).`));

    const loss = [...big].sort((a, b) => b.return_shipping - a.return_shipping)[0];
    if (loss.return_shipping > 0)
        out.push(t(`المرتجعات في ${label(loss.channel)} كلّفت ${formatCurrency(loss.return_shipping)} شحن على الفاضي.`, `Returns on ${label(loss.channel)} cost ${formatCurrency(loss.return_shipping)} in wasted shipping.`));

    if (!out.length) return null;
    return (
        <Card className="border-primary/30 bg-primary/[0.03]">
            <CardContent className="space-y-1.5 p-4 text-sm">
                {out.map((s, i) => <div key={i} className="flex gap-2"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{s}</div>)}
            </CardContent>
        </Card>
    );
}

function ChannelTable({ rows, prevRows, all, label, ar }: { rows: ChannelRow[]; prevRows: ChannelRow[]; all: ChannelRow; label: (c: string) => string; ar: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const cols = [
        t("القناة", "Channel"), t("أوردرات", "Orders"), t("من الإجمالي", "Share"), t("إلغاء", "Cancelled"), t("نسبة التسليم", "Delivery"),
        t("مرتجع", "Returned"), t("لسه شغالة", "Open"), t("متوسط الأوردر", "AOV"), t("مبيعات اتسلمت", "Delivered sales"),
        t("ربح المسلَّم", "Delivered profit"), t("ربح/أوردر", "Profit/order"), t("شحن المرتجعات", "Return shipping"), t("عملاء راجعين", "Returning"),
    ];
    const line = (r: ChannelRow, isTotal = false) => {
        const x = rates(r);
        const p = prevRows.find(q => q.channel === r.channel);
        return (
            <tr key={r.channel} className={cn("whitespace-nowrap [&>td]:px-2.5 [&>td]:py-2", isTotal ? "bg-muted/40 font-semibold" : "hover:bg-muted/30")}>
                <td className="ps-4">
                    <span className="inline-flex items-center gap-2">
                        {!isTotal && <span className="h-2.5 w-2.5 rounded-full" style={{ background: channelColor(r.channel) }} />}
                        {isTotal ? t("الإجمالي", "Total") : label(r.channel)}
                    </span>
                </td>
                <td><span className="font-semibold">{int(r.orders)}</span> {!isTotal && p && <Delta value={change(r.orders, p.orders)} />}</td>
                <td>{pct((r.orders / Math.max(all.orders, 1)) * 100, 0)}</td>
                <td className={cn((x.cancelRate ?? 0) >= 25 && "text-red-600")}>{int(r.cancelled)} <span className="text-xs text-muted-foreground">({pct(x.cancelRate, 0)})</span></td>
                <td className={cn("font-medium", x.deliveryRate !== null && (x.deliveryRate >= 85 ? "text-emerald-600" : x.deliveryRate < 70 ? "text-red-600" : "text-amber-600"))}>{pct(x.deliveryRate, 0)}</td>
                <td>{int(r.returned)}</td>
                <td>{int(r.open)}</td>
                <td dir="ltr" className="text-end">{money(x.aov)}</td>
                <td dir="ltr" className="text-end">{money(r.delivered_sales)}</td>
                <td dir="ltr" className={cn("text-end font-medium", r.delivered_profit < 0 && "text-red-600")}>{money(r.delivered_profit)}</td>
                <td dir="ltr" className="text-end">{money(x.profitPerDelivered)}</td>
                <td dir="ltr" className="text-end text-red-600">{r.return_shipping ? `−${money(r.return_shipping)}` : "—"}</td>
                <td>{pct(x.returningShare, 0)}</td>
            </tr>
        );
    };
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("أداء كل قناة", "Each channel")}</CardTitle>
                <CardDescription>{t("نسبة التسليم = اتسلم ÷ (اتسلم + مرتجع). الربح من الأوردرات اللي اتسلمت بس، ومن غير الإعلانات.", "Delivery rate = delivered ÷ (delivered + returned). Profit is from delivered orders only, before ads.")}</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                        <tr className="[&>th]:px-2.5 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium [&>th:first-child]:ps-4">{cols.map(c => <th key={c}>{c}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y">
                        {rows.map(r => line(r))}
                        {rows.length > 1 && line(all, true)}
                    </tbody>
                </table>
            </CardContent>
        </Card>
    );
}

function StatusChart({ rows, label, ar }: { rows: ChannelRow[]; label: (c: string) => string; ar: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const data = rows.filter(r => r.orders > 0).map(r => ({
        name: label(r.channel),
        delivered: (r.delivered / r.orders) * 100,
        returned: (r.returned / r.orders) * 100,
        open: (r.open / r.orders) * 100,
        cancelled: (r.cancelled / r.orders) * 100,
    }));
    return (
        <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t("الأوردرات انتهت إزاي", "How orders ended")}</CardTitle></CardHeader>
            <CardContent className="h-[280px]" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} layout="vertical" margin={{ left: 10, right: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} fontSize={11} />
                        <YAxis type="category" dataKey="name" width={110} fontSize={11} />
                        <Tooltip formatter={v => `${Number(v).toFixed(1)}%`} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="delivered" stackId="s" name={t("اتسلم", "Delivered")} fill="#10b981" />
                        <Bar dataKey="returned" stackId="s" name={t("مرتجع", "Returned")} fill="#f59e0b" />
                        <Bar dataKey="open" stackId="s" name={t("لسه شغال", "Open")} fill="#93c5fd" />
                        <Bar dataKey="cancelled" stackId="s" name={t("ملغي", "Cancelled")} fill="#ef4444" radius={[0, 4, 4, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
}

function DailyChart({ data, view, label, ar }: { data: ChannelAnalytics; view: "channel" | "group"; label: (c: string) => string; ar: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const groupOf = new Map(data.channels.map(c => [c.channel, c.ad_group]));
    const keyOf = (c: string) => (view === "group" ? groupOf.get(c) ?? "other" : c);
    const keys = [...new Set(data.channels.map(c => keyOf(c.channel)))];
    const byDay = new Map<string, Record<string, number | string>>();
    for (const d of data.daily) {
        const row = byDay.get(d.day) ?? { day: d.day };
        const k = keyOf(d.channel);
        row[k] = (Number(row[k]) || 0) + d.confirmed;
        byDay.set(d.day, row);
    }
    const rows = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
    return (
        <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t("الأوردرات المؤكدة يوم بيوم", "Confirmed orders by day")}</CardTitle></CardHeader>
            <CardContent className="h-[280px]" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows} margin={{ left: -15, right: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="day" tickFormatter={v => String(v).slice(8, 10) + "/" + String(v).slice(5, 7)} fontSize={11} />
                        <YAxis fontSize={11} allowDecimals={false} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        {keys.map((k, i) => <Bar key={k} dataKey={k} name={label(k)} stackId="d" fill={channelColor(k, i)} />)}
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
}

/** Ad spend against the orders of the channels each ad group brings. */
function AdsSection({ data, ar }: { data: ChannelAnalytics; ar: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const groups = byView(data.channels, "group");
    const spendOf = (g: string) => data.ads.find(a => a.ad_group === g)?.spend ?? 0;
    const unassigned = spendOf("unassigned");
    const rows = groups.filter(g => g.channel !== "other" && (spendOf(g.channel) > 0 || g.orders > 0));
    if (!data.ads.length) return null;
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("الإعلانات لكل مجموعة قنوات", "Ads by channel group")}</CardTitle>
                <CardDescription>{t("المصروف من صفحة الإعلانات. إعلانات الرسائل بتتقارن بأوردرات فيسبوك وواتساب وإنستجرام مع بعض.", "Spend from the Ads page. Message ads are compared with Facebook, WhatsApp and Instagram orders together.")}</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                        <tr className="[&>th]:px-2.5 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium [&>th:first-child]:ps-4">
                            <th>{t("المجموعة", "Group")}</th><th>{t("المصروف", "Spend")}</th><th>{t("أوردرات", "Orders")}</th><th>{t("تكلفة الأوردر", "CPO")}</th>
                            <th>{t("تكلفة المؤكد", "Per confirmed")}</th><th>{t("تكلفة المسلَّم", "Per delivered")}</th><th>ROAS</th><th>{t("الصافي بعد الإعلانات", "Net after ads")}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {rows.map(g => {
                            const s = spendOf(g.channel);
                            const x = rates(g);
                            const net = x.net - s;
                            return (
                                <tr key={g.channel} className="whitespace-nowrap [&>td]:px-2.5 [&>td]:py-2">
                                    <td className="ps-4 font-medium">{ar ? AD_GROUP_LABEL[g.ad_group].ar : AD_GROUP_LABEL[g.ad_group].en}</td>
                                    <td dir="ltr" className="text-end">{s ? money(s) : "—"}</td>
                                    <td>{int(g.orders)}</td>
                                    <td dir="ltr" className="text-end font-semibold">{s ? money(s / Math.max(g.orders, 1)) : "—"}</td>
                                    <td dir="ltr" className="text-end">{s && x.confirmed ? money(s / x.confirmed) : "—"}</td>
                                    <td dir="ltr" className="text-end">{s && g.delivered ? money(s / g.delivered) : "—"}</td>
                                    <td>{s ? `${(g.delivered_sales / s).toFixed(1)}x` : "—"}</td>
                                    <td dir="ltr" className={cn("text-end font-medium", net >= 0 ? "text-emerald-600" : "text-red-600")}>{money(net)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {unassigned > 0 && (
                    <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                        {t(`فيه ${formatCurrency(unassigned)} مصروف إعلانات مش معروف لأنهي قناة (متسجل يدوي في المصروف اليومي)، فمش داخل في الجدول.`, `${formatCurrency(unassigned)} of ad spend is not tied to a channel (entered by hand under daily spend), so it is not in this table.`)}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

/** Who confirmed how many orders on each channel, and how those orders ended. */
function Moderators({ data, ar }: { data: ChannelAnalytics; ar: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const channels = [...new Set(data.moderators.map(m => m.channel))]
        .sort((a, b) => (data.channels.find(c => c.channel === b)?.orders ?? 0) - (data.channels.find(c => c.channel === a)?.orders ?? 0));
    const people = new Map<string, { key: string; email: string | null; cells: Map<string, number>; orders: number; cancelled: number; delivered: number; returned: number; delivered_sales: number }>();
    for (const m of data.moderators) {
        const key = m.moderator ?? "__none__";
        const p = people.get(key) ?? { key, email: m.moderator, cells: new Map(), orders: 0, cancelled: 0, delivered: 0, returned: 0, delivered_sales: 0 };
        p.cells.set(m.channel, (p.cells.get(m.channel) ?? 0) + m.orders);
        p.orders += m.orders; p.cancelled += m.cancelled; p.delivered += m.delivered; p.returned += m.returned; p.delivered_sales += m.delivered_sales;
        people.set(key, p);
    }
    const list = [...people.values()].sort((a, b) => (a.email ? 0 : 1) - (b.email ? 0 : 1) || b.orders - a.orders);
    if (!list.some(p => p.email)) return null;
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("المودريتورز", "Moderators")}</CardTitle>
                <CardDescription>{t("كل مودريتور أكّد كام أوردر من كل قناة، وانتهوا إزاي. \"بدون مودريتور\" = أوردرات ماحدش أكّدها (اتلغت قبل التأكيد، أو اتعملت قبل ما السيستم يسجّل مين أكّد).", "How many orders each moderator confirmed per channel, and how they ended. \"No moderator\" = orders nobody confirmed (cancelled before confirmation, or made before the system recorded who confirmed).")}</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                        <tr className="[&>th]:px-2.5 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium [&>th:first-child]:ps-4">
                            <th>{t("المودريتور", "Moderator")}</th>
                            {channels.map(c => <th key={c}><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: channelColor(c) }} />{c}</span></th>)}
                            <th>{t("الإجمالي", "Total")}</th><th>{t("إلغاء", "Cancelled")}</th><th>{t("نسبة التسليم", "Delivery")}</th><th>{t("مبيعات اتسلمت", "Delivered sales")}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {list.map(p => {
                            const closed = p.delivered + p.returned;
                            const dr = closed ? (p.delivered / closed) * 100 : null;
                            return (
                                <tr key={p.key} className={cn("whitespace-nowrap [&>td]:px-2.5 [&>td]:py-2", !p.email && "text-muted-foreground")}>
                                    <td className="ps-4 font-medium" title={p.email ?? undefined}>{moderatorName(p.email) ?? t("بدون مودريتور", "No moderator")}</td>
                                    {channels.map(c => <td key={c}>{p.cells.get(c) ? int(p.cells.get(c)!) : "—"}</td>)}
                                    <td className="font-semibold">{int(p.orders)}</td>
                                    <td>{int(p.cancelled)} <span className="text-xs text-muted-foreground">({pct(p.orders ? (p.cancelled / p.orders) * 100 : null, 0)})</span></td>
                                    <td className={cn("font-medium", dr !== null && (dr >= 85 ? "text-emerald-600" : dr < 70 ? "text-red-600" : "text-amber-600"))}>{pct(dr, 0)}</td>
                                    <td dir="ltr" className="text-end">{money(p.delivered_sales)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </CardContent>
        </Card>
    );
}

function Products({ data, selected, onSelect, ar }: { data: ChannelAnalytics; selected: string | null; onSelect: (c: string) => void; ar: boolean }) {
    const t = (a: string, e: string) => (ar ? a : e);
    const channels = data.channels.map(c => c.channel).filter(c => data.products.some(p => p.channel === c));
    if (!channels.length) return null;
    const current = selected && channels.includes(selected) ? selected : channels[0];
    const list = data.products.filter(p => p.channel === current);
    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base">{t("أكتر المنتجات مبيعًا في كل قناة", "Top products per channel")}</CardTitle>
                <div className="flex flex-wrap gap-1">
                    {channels.map(c => (
                        <button key={c} onClick={() => onSelect(c)} className={cn("rounded-full border px-3 py-1 text-xs", c === current ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{c}</button>
                    ))}
                </div>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                        <tr className="[&>th]:px-2.5 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium [&>th:first-child]:ps-4">
                            <th>{t("المنتج", "Product")}</th><th>{t("قطع", "Units")}</th><th>{t("أوردرات", "Orders")}</th><th>{t("نسبة التسليم", "Delivery")}</th><th>{t("المبيعات", "Sales")}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {list.map(p => {
                            const closed = p.delivered + p.returned;
                            const dr = closed ? (p.delivered / closed) * 100 : null;
                            return (
                                <tr key={p.product_id} className="[&>td]:px-2.5 [&>td]:py-2">
                                    <td className="max-w-[320px] truncate ps-4 font-medium" dir="auto">{p.name}</td>
                                    <td>{int(p.units)}</td>
                                    <td>{int(p.orders)}</td>
                                    <td className={cn(dr !== null && (dr >= 85 ? "text-emerald-600" : dr < 70 ? "text-red-600" : "text-amber-600"))}>{pct(dr, 0)}</td>
                                    <td dir="ltr" className="text-end">{money(p.sales)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </CardContent>
        </Card>
    );
}

export default function ChannelAnalyticsPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <ChannelAnalyticsContent />
        </Suspense>
    );
}
