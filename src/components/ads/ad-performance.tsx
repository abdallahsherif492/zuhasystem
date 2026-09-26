"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO, startOfMonth, subDays, subMonths, endOfMonth } from "date-fns";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import {
    AlertTriangle, CalendarIcon, History, Loader2, Megaphone, PackageSearch, Trash2, TrendingDown, TrendingUp, Upload,
} from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase, fetchAll } from "@/lib/supabase";
import { formatCurrency, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { AD_CHANNELS, adChannelInfo, orderInAdChannel, type AdChannel } from "@/lib/ads/ad-report";
import {
    computeAdAnalytics, metrics, verdict, type DayStats, type OrderRow, type SpendRow, type Totals, type Verdict,
} from "@/lib/ads/ad-analytics";
import { AdUploadDialog, MIGRATION_HINT, isMissingMigration } from "./ad-upload-dialog";
import { ExportGuide } from "./export-guide";
import { AdProductPicker, type PickerProduct } from "./product-picker";

interface UploadRow {
    id: string;
    channel: AdChannel;
    file_name: string | null;
    date_from: string;
    date_to: string;
    row_count: number;
    total_spend: number;
    created_at: string;
}

interface RawOrder {
    id: string;
    created_at: string;
    status: string;
    channel: string | null;
    items: { quantity: number; price_at_sale: number; cost_at_sale: number | null; variant: { product_id: string } | { product_id: string }[] | null }[];
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const addDay = (s: string, n: number) => iso(new Date(Date.parse(s) + n * 86_400_000));

const money = (v: number | null) => (v === null ? "—" : formatCurrency(v));
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const times = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}x`);
const count = (v: number) => Math.round(v).toLocaleString("en");

/**
 * Ad performance by product: what each product's ads cost, how many orders
 * they brought and what an order cost, from uploaded Meta or TikTok reports.
 */
export function AdPerformance({ businessId, ar }: { businessId: string; ar: boolean }) {
    const t = useCallback((a: string, e: string) => (ar ? a : e), [ar]);

    const [channel, setChannel] = useState<AdChannel>("messages");
    const [range, setRange] = useState<{ from: string; to: string }>(() => ({ from: iso(subDays(new Date(), 29)), to: iso(new Date()) }));

    const [products, setProducts] = useState<PickerProduct[]>([]);
    const [links, setLinks] = useState<Map<string, string | null>>(new Map());
    const [spend, setSpend] = useState<SpendRow[]>([]);
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [uploads, setUploads] = useState<UploadRow[]>([]);
    const [covered, setCovered] = useState<{ date_from: string; date_to: string }[]>([]);
    const [anyUpload, setAnyUpload] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);

    const [uploadOpen, setUploadOpen] = useState(false);
    const [detail, setDetail] = useState<string | null>(null);
    const [onlyUnlinked, setOnlyUnlinked] = useState(false);
    const [savingLink, setSavingLink] = useState<string | null>(null);

    const ch = adChannelInfo(channel);

    // Catalogue and links: once per store.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [prods, lks] = await Promise.all([
                fetchAll<{ id: string; name: string; variants: { sku: string | null }[] }>((f, to) =>
                    supabase.from("products").select("id, name, variants(sku)").eq("business_id", businessId).range(f, to)),
                supabase.from("ad_product_links").select("ad_key, product_id").eq("business_id", businessId),
            ]);
            if (cancelled) return;
            setProducts(prods
                .map(p => ({ id: p.id, name: p.name, skus: (p.variants || []).map(v => v.sku || "").filter(Boolean) }))
                .sort((a, b) => a.name.localeCompare(b.name)));
            if (lks.error) {
                if (isMissingMigration(lks.error)) setMissing(true);
                return;
            }
            setLinks(new Map((lks.data || []).map(l => [l.ad_key, l.product_id])));
        })().catch(e => console.error("Ad links load failed:", e));
        return () => { cancelled = true; };
    }, [businessId]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [sp, up, any, cov, ords] = await Promise.all([
                fetchAll<SpendRow & { id: string }>((f, to) =>
                    supabase.from("ad_spend")
                        .select("id, ad_name, date_from, date_to, spend, impressions, reach, clicks, results")
                        .eq("business_id", businessId).eq("channel", channel)
                        .lte("date_from", range.to).gte("date_to", range.from)
                        .range(f, to)),
                supabase.from("ad_spend_uploads")
                    .select("id, channel, file_name, date_from, date_to, row_count, total_spend, created_at")
                    .eq("business_id", businessId).eq("channel", channel)
                    .order("created_at", { ascending: false }).limit(20),
                supabase.from("ad_spend_uploads").select("id", { count: "exact", head: true }).eq("business_id", businessId),
                supabase.from("ad_spend_uploads").select("date_from, date_to")
                    .eq("business_id", businessId).eq("channel", channel)
                    .lte("date_from", range.to).gte("date_to", range.from),
                // A day either side: dates are Cairo days, created_at is UTC.
                fetchAll((f, to) =>
                    supabase.from("orders")
                        .select("id, created_at, status, channel, items:order_items(quantity, price_at_sale, cost_at_sale, variant:variants(product_id))")
                        .eq("business_id", businessId)
                        .gte("created_at", `${addDay(range.from, -1)}T00:00:00Z`)
                        .lt("created_at", `${addDay(range.to, 2)}T00:00:00Z`)
                        .or(ch.orderFilter)
                        .range(f, to)),
            ]);
            setMissing(false);
            setSpend(sp.map(r => ({ ...r, spend: Number(r.spend), results: Number(r.results) })));
            setUploads((up.data || []) as UploadRow[]);
            setCovered(cov.data || []);
            setAnyUpload((any.count ?? 0) > 0);
            setOrders((ords as unknown as RawOrder[])
                .filter(o => orderInAdChannel(o.channel, ch))
                .map(o => ({
                    id: o.id, created_at: o.created_at, status: o.status,
                    items: (o.items || []).map(i => ({ quantity: i.quantity, price_at_sale: i.price_at_sale, cost_at_sale: i.cost_at_sale, product_id: (Array.isArray(i.variant) ? i.variant[0] : i.variant)?.product_id ?? null })),
                })));
        } catch (e) {
            const err = e as { code?: string; message?: string };
            if (isMissingMigration(err)) setMissing(true);
            else { console.error("Ad performance load failed:", err); toast.error(t("مش قادر أحمّل بيانات الإعلانات", "Could not load ad data")); }
        } finally {
            setLoading(false);
        }
    }, [businessId, channel, range.from, range.to, ch, t]);

    useEffect(() => { load(); }, [load]);

    const a = useMemo(() => computeAdAnalytics(spend, orders, links, range.from, range.to, covered), [spend, orders, links, range, covered]);
    const productName = useCallback((id: string) => products.find(p => p.id === id)?.name ?? t("منتج محذوف", "Deleted product"), [products, t]);
    const unlinkedAds = a.ads.filter(x => x.productId === undefined);

    const setLink = async (key: string, name: string, productId: string | null) => {
        setSavingLink(key);
        const { error } = await supabase.from("ad_product_links").upsert(
            { business_id: businessId, ad_key: key, ad_name: name, product_id: productId, source: "manual", updated_at: new Date().toISOString() },
            { onConflict: "business_id,ad_key" });
        setSavingLink(null);
        if (error) { console.error(error); toast.error(t("الربط ماتحفظش", "The link was not saved")); return; }
        setLinks(m => new Map(m).set(key, productId));
        toast.success(t("اتربط", "Linked"));
    };

    const deleteUpload = async (u: UploadRow) => {
        if (!confirm(t(`تمسح الملف "${u.file_name}"؟ مصروف الأيام دي هيتشال من التحليل ومن المصروف اليومي.`, `Delete "${u.file_name}"? Its spend leaves this analysis and the daily spend.`))) return;
        const { error } = await supabase.rpc("delete_ad_spend_upload", { p_upload_id: u.id });
        if (error) { console.error(error); toast.error(t("المسح فشل", "Delete failed")); return; }
        toast.success(t("اتمسح", "Deleted"));
        load();
    };

    const m = metrics(a.total);

    if (missing) {
        return (
            <Card className="border-amber-300">
                <CardContent className="flex gap-3 p-5 text-sm">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                    <div>
                        <div className="font-medium">{t("محتاج تشغّل migration الأول", "Run the migration first")}</div>
                        <p className="mt-1 text-muted-foreground">
                            {t("شغّل الملف ده في Supabase → SQL Editor، وبعدها الصفحة هتشتغل:", "Run this file in Supabase → SQL Editor, then reload:")}
                            {" "}<code className="rounded bg-muted px-1" dir="ltr">{MIGRATION_HINT}</code>
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-5">
            {/* Controls */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="inline-flex w-full rounded-lg border bg-muted p-1 sm:w-auto">
                    {AD_CHANNELS.map(c => (
                        <button
                            key={c.key}
                            onClick={() => setChannel(c.key)}
                            className={cn(
                                "flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium transition-colors sm:flex-none sm:px-3 sm:text-sm",
                                channel === c.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {ar ? c.label : c.labelEn}
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <RangePicker range={range} onChange={setRange} ar={ar} />
                    <Button onClick={() => setUploadOpen(true)}>
                        <Upload className="me-2 h-4 w-4" />
                        {t("رفع تقرير", "Upload report")}
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : anyUpload === false ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5" />{t("اعرف كل منتج بيكلّفك كام في الأوردر", "See what each product's orders cost in ads")}</CardTitle>
                        <CardDescription>
                            {t("نزّل تقرير الإعلانات من Ads Manager وارفعه هنا. السيستم هيربط كل إعلان بالمنتج بتاعه ويحسبلك تكلفة الأوردر والمحادثة والربح بعد الإعلان لكل منتج.",
                                "Export the ad report from Ads Manager and upload it here. Each ad is linked to its product, and you get cost per order, per conversation and profit after ads for every product.")}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <ExportGuide channel={channel} ar={ar} />
                        <Button onClick={() => setUploadOpen(true)}><Upload className="me-2 h-4 w-4" />{t("ارفع أول تقرير", "Upload your first report")}</Button>
                    </CardContent>
                </Card>
            ) : (
                <>
                    {a.total.spend === 0 && (
                        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                            {t(`مفيش مصروف ${ch.label} في الفترة دي. غيّر الفترة أو ارفع تقرير ليها.`, `No ${ch.labelEn.toLowerCase()} spend in these dates. Change the dates or upload a report for them.`)}
                        </div>
                    )}

                    {unlinkedAds.length > 0 && (
                        <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex gap-2">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                {t(`${unlinkedAds.length} إعلان مش متربط بمنتج (${formatCurrency(a.unlinkedSpend)}). اربطهم عشان تكلفة المنتجات تبقى مظبوطة.`,
                                    `${unlinkedAds.length} ads are not linked to a product (${formatCurrency(a.unlinkedSpend)}). Link them so product costs are right.`)}
                            </div>
                            <Button size="sm" variant="outline" onClick={() => { setOnlyUnlinked(true); document.getElementById("ads-table")?.scrollIntoView({ behavior: "smooth" }); }}>
                                {t("اربطهم", "Link them")}
                            </Button>
                        </div>
                    )}

                    {/* Headline numbers */}
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Kpi label={t("المصروف", "Spend")} value={money(a.total.spend)} hint={`CPM ${money(m.cpm)}`} />
                        <Kpi label={ar ? ch.resultLabel : ch.resultLabelEn} value={count(a.total.results)} hint={`${t("تكلفة الواحدة", "Cost each")} ${money(m.costPerResult)}`} />
                        <Kpi label={t("الأوردرات", "Orders")} value={count(a.total.orders)} hint={t(`${a.total.confirmed} مؤكد · ${a.total.cancelled} ملغي`, `${a.total.confirmed} confirmed · ${a.total.cancelled} cancelled`)} />
                        <Kpi label={t("تكلفة الأوردر", "Cost per order")} value={money(m.cpo)} hint={`${t("المؤكد", "Confirmed")} ${money(m.cpoConfirmed)}`} strong />
                        <Kpi label={t("تكلفة الأوردر المُسلَّم", "Cost per delivered order")} value={money(m.cpoDelivered)} hint={`${t("نسبة التسليم", "Delivery rate")} ${pct(m.deliveryRate)}`} />
                        <Kpi label={t("معدل التحويل", "Conversion rate")} value={pct(m.conversionRate)} hint={t(`أوردر لكل ${ch.resultLabel}`, `Orders per ${ch.resultLabelEn.toLowerCase()}`)} />
                        <Kpi label="ROAS" value={times(m.roas)} hint={`${t("المبيعات", "Sales")} ${money(a.total.revenue)}`} />
                        <Kpi
                            label={t("الربح بعد الإعلانات", "Profit after ads")}
                            value={money(m.profitAfterAds)}
                            hint={t("مبيعات مؤكدة − تكلفة البضاعة − الإعلانات", "Confirmed sales − cost of goods − ads")}
                            tone={m.profitAfterAds >= 0 ? "good" : "bad"}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {t(`الأوردرات هنا هي أوردرات ${ch.orderChannels.join(" / ")} في نفس الفترة، لكل المنتجات. الأرقام دي قبل الشحن والمرتجعات.`,
                            `Orders are ${ch.orderChannels.join(" / ")} orders in the same dates, for all products. Figures are before shipping and returns.`)}
                        {a.uncoveredDays > 0 && a.uncoveredDays < a.days.length && t(
                            ` ${a.uncoveredDays} يوم في الفترة مفيش ليهم تقرير مرفوع، فأوردراتهم مش محسوبة.`,
                            ` ${a.uncoveredDays} days in the period have no uploaded report, so their orders are left out.`)}
                        {a.generalSpend > 0 && t(` فيه ${formatCurrency(a.generalSpend)} على إعلانات عامة.`, ` ${formatCurrency(a.generalSpend)} went to general ads.`)}
                    </p>

                    {/* Daily */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">{t("المصروف وتكلفة الأوردر يوم بيوم", "Spend and cost per order, day by day")}</CardTitle>
                        </CardHeader>
                        <CardContent className="h-[280px]" dir="ltr">
                            <DailyChart days={a.days} ar={ar} />
                        </CardContent>
                    </Card>

                    {/* Products */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">{t("المنتجات", "Products")}</CardTitle>
                            <CardDescription>{t("دوس على أي منتج تشوف تفاصيله يوم بيوم وإعلاناته.", "Click a product for its day-by-day numbers and its ads.")}</CardDescription>
                        </CardHeader>
                        <CardContent className="overflow-x-auto p-0">
                            <table className="w-full min-w-[980px] text-sm">
                                <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                                        <th>{t("المنتج", "Product")}</th>
                                        <th>{t("الحالة", "Status")}</th>
                                        <th>{t("المصروف", "Spend")}</th>
                                        <th>{ar ? ch.resultLabel : ch.resultLabelEn}</th>
                                        <th>{t("تكلفة النتيجة", "Cost/result")}</th>
                                        <th>{t("أوردرات", "Orders")}</th>
                                        <th>{t("تحويل", "Conv.")}</th>
                                        <th>{t("تكلفة الأوردر", "CPO")}</th>
                                        <th title={t("ربح المنتج في الأوردر قبل الإعلان: لو تكلفة الأوردر عدّته بتخسر", "Product profit per order before ads: past this, orders lose money")}>{t("أقصى تكلفة للتعادل", "Break-even CPO")}</th>
                                        <th>{t("تسليم", "Delivered")}</th>
                                        <th>ROAS</th>
                                        <th>{t("ربح بعد الإعلان", "Profit after ads")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {a.products.length === 0 && (
                                        <tr><td colSpan={12} className="p-6 text-center text-muted-foreground">{t("مفيش إعلانات متربطة بمنتجات في الفترة دي.", "No ads linked to products in these dates.")}</td></tr>
                                    )}
                                    {a.products.map(p => {
                                        const pm = metrics(p);
                                        return (
                                            <tr key={p.productId} onClick={() => setDetail(p.productId)} className="cursor-pointer hover:bg-muted/40 [&>td]:px-3 [&>td]:py-2.5">
                                                <td className="max-w-[240px]"><div className="truncate font-medium" dir="auto">{productName(p.productId)}</div><div className="text-xs text-muted-foreground">{t(`${p.ads.length} إعلان`, `${p.ads.length} ads`)}</div></td>
                                                <td><VerdictBadge v={verdict(p)} ar={ar} /></td>
                                                <td className="font-medium">{money(p.spend)}</td>
                                                <td>{count(p.results)}</td>
                                                <td>{money(pm.costPerResult)}</td>
                                                <td>{p.orders}{p.cancelled > 0 && <span className="text-xs text-muted-foreground"> ({p.cancelled} {t("ملغي", "cxl")})</span>}</td>
                                                <td>{pct(pm.conversionRate)}</td>
                                                <td className="font-semibold">{money(pm.cpoConfirmed)}</td>
                                                <td className="text-muted-foreground">{money(pm.breakEvenCpo)}</td>
                                                <td>{p.delivered} <span className="text-xs text-muted-foreground">({pct(pm.deliveryRate)})</span></td>
                                                <td>{times(pm.roas)}</td>
                                                <td className={cn("font-medium", pm.profitAfterAds >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>{money(pm.profitAfterAds)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </CardContent>
                    </Card>

                    {/* Ads */}
                    <Card id="ads-table">
                        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                            <div>
                                <CardTitle className="text-base">{t("الإعلانات", "Ads")}</CardTitle>
                                <CardDescription>{t("غيّر المنتج المربوط بأي إعلان من هنا، والتحليل بيتحدث على طول.", "Change the product an ad is linked to here; the analysis updates at once.")}</CardDescription>
                            </div>
                            <label className="flex items-center gap-2 text-sm">
                                <Switch checked={onlyUnlinked} onCheckedChange={setOnlyUnlinked} />
                                {t("غير المربوطة بس", "Unlinked only")}
                            </label>
                        </CardHeader>
                        <CardContent className="overflow-x-auto p-0">
                            <table className="w-full min-w-[860px] text-sm">
                                <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                                        <th>{t("الإعلان", "Ad")}</th>
                                        <th>{t("المنتج", "Product")}</th>
                                        <th>{t("المصروف", "Spend")}</th>
                                        <th>{ar ? ch.resultLabel : ch.resultLabelEn}</th>
                                        <th>{t("تكلفة النتيجة", "Cost/result")}</th>
                                        <th>CPM</th>
                                        <th>CTR</th>
                                        <th>{t("أيام", "Days")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {(onlyUnlinked ? unlinkedAds : a.ads).map(ad => (
                                        <tr key={ad.key} className="[&>td]:px-3 [&>td]:py-2">
                                            <td className="max-w-[260px]"><div className="truncate font-medium" dir="auto">{ad.name}</div></td>
                                            <td>
                                                <AdProductPicker
                                                    products={products}
                                                    value={links.has(ad.key) ? links.get(ad.key) : undefined}
                                                    onChange={pid => setLink(ad.key, ad.name, pid)}
                                                    disabled={savingLink === ad.key}
                                                    ar={ar}
                                                />
                                            </td>
                                            <td className="font-medium">{money(ad.spend)}</td>
                                            <td>{count(ad.results)}</td>
                                            <td>{money(ad.results > 0 ? ad.spend / ad.results : null)}</td>
                                            <td>{money(ad.impressions > 0 ? ad.spend * 1000 / ad.impressions : null)}</td>
                                            <td>{pct(ad.clicks > 0 && ad.impressions > 0 ? ad.clicks * 100 / ad.impressions : null)}</td>
                                            <td>{ad.days}</td>
                                        </tr>
                                    ))}
                                    {(onlyUnlinked ? unlinkedAds : a.ads).length === 0 && (
                                        <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">{onlyUnlinked ? t("كل الإعلانات متربطة 👌", "Every ad is linked 👌") : t("مفيش إعلانات في الفترة دي.", "No ads in these dates.")}</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </CardContent>
                    </Card>

                    {/* Organic */}
                    {a.organic.length > 0 && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-2 text-base"><PackageSearch className="h-4 w-4" />{t("منتجات بتبيع من غير إعلانات", "Products selling without ads")}</CardTitle>
                                <CardDescription>{t(`ليها أوردرات ${ch.label} في الفترة ومفيش إعلان متربط بيها — يا إما بتبيع لوحدها، يا إما إعلانها لسه مش متربط.`, `They have ${ch.labelEn.toLowerCase()} orders in these dates and no linked ad — selling on their own, or their ad is not linked yet.`)}</CardDescription>
                            </CardHeader>
                            <CardContent className="flex flex-wrap gap-2">
                                {a.organic.slice(0, 24).map(p => (
                                    <Badge key={p.productId} variant="outline" className="font-normal">
                                        <span dir="auto">{productName(p.productId)}</span>
                                        <span className="ms-1.5 font-semibold">{p.orders}</span>
                                    </Badge>
                                ))}
                            </CardContent>
                        </Card>
                    )}

                    {/* Uploads */}
                    {uploads.length > 0 && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" />{t("الملفات المرفوعة", "Uploaded files")}</CardTitle>
                            </CardHeader>
                            <CardContent className="divide-y p-0">
                                {uploads.map(u => (
                                    <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                                        <div className="min-w-0">
                                            <div className="truncate font-medium" dir="ltr">{u.file_name || "—"}</div>
                                            <div className="text-xs text-muted-foreground">
                                                <span dir="ltr">{u.date_from} → {u.date_to}</span> · {formatCurrency(Number(u.total_spend))} · {t("اترفع", "uploaded")} {format(parseISO(u.created_at), "dd/MM HH:mm")}
                                            </div>
                                        </div>
                                        <Button variant="ghost" size="icon" onClick={() => deleteUpload(u)} className="text-red-500 hover:bg-red-50 hover:text-red-700" aria-label={t("مسح", "Delete")}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    )}
                </>
            )}

            {uploadOpen && (
                <AdUploadDialog
                    open={uploadOpen}
                    onOpenChange={setUploadOpen}
                    businessId={businessId}
                    initialChannel={channel}
                    products={products}
                    links={links}
                    firstTime={!anyUpload}
                    ar={ar}
                    onDone={async (c, from, to) => {
                        const { data } = await supabase.from("ad_product_links").select("ad_key, product_id").eq("business_id", businessId);
                        setLinks(new Map((data || []).map(l => [l.ad_key, l.product_id])));
                        // Show what was just uploaded.
                        setChannel(c);
                        setRange({ from, to });
                        if (c === channel && from === range.from && to === range.to) load();
                    }}
                />
            )}

            {detail && (
                <ProductDetail
                    open={!!detail}
                    onOpenChange={o => !o && setDetail(null)}
                    name={productName(detail)}
                    stats={a.products.find(p => p.productId === detail)!}
                    days={a.daysByProduct.get(detail) || []}
                    ads={a.ads.filter(x => links.get(x.key) === detail)}
                    resultLabel={ar ? ch.resultLabel : ch.resultLabelEn}
                    ar={ar}
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------

function Kpi({ label, value, hint, strong, tone }: { label: string; value: React.ReactNode; hint?: string; strong?: boolean; tone?: "good" | "bad" }) {
    return (
        <Card className={cn(strong && "border-primary/40 bg-primary/[0.03]")}>
            <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className={cn("mt-1 text-xl font-bold", tone === "good" && "text-emerald-600 dark:text-emerald-400", tone === "bad" && "text-red-600 dark:text-red-400")}>{value}</div>
                {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
            </CardContent>
        </Card>
    );
}

function VerdictBadge({ v, ar }: { v: Verdict | null; ar: boolean }) {
    if (!v) return null;
    const map: Record<Verdict, { ar: string; en: string; cls: string; icon?: React.ReactNode }> = {
        winning: { ar: "كسبان", en: "Winning", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300", icon: <TrendingUp className="h-3 w-3" /> },
        marginal: { ar: "على الحافة", en: "Marginal", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
        losing: { ar: "خسران", en: "Losing", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300", icon: <TrendingDown className="h-3 w-3" /> },
        "no-orders": { ar: "مفيش أوردرات", en: "No orders", cls: "bg-muted text-muted-foreground" },
    };
    const s = map[v];
    return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", s.cls)}>{s.icon}{ar ? s.ar : s.en}</span>;
}

function DailyChart({ days, ar }: { days: DayStats[]; ar: boolean }) {
    const data = days.map(d => ({
        day: d.day,
        spend: Math.round(d.spend),
        orders: d.orders,
        cpo: d.orders > 0 && d.spend > 0 ? Math.round(d.spend / d.orders) : null,
    }));
    return (
        <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ left: -10, right: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tickFormatter={v => format(parseISO(v), "dd/MM")} tickLine={false} axisLine={false} fontSize={11} />
                {/* Spend is ten times the cost per order; on one axis the cost line
                    lies flat along the bottom. Bars get a hidden scale of their own. */}
                <YAxis yAxisId="spend" hide />
                <YAxis yAxisId="money" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis yAxisId="orders" orientation="right" tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
                <Tooltip
                    labelFormatter={l => format(parseISO(String(l)), "dd MMM yyyy")}
                    formatter={(v, name) => (name === (ar ? "أوردرات" : "Orders") ? v : formatCurrency(Number(v) || 0))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="spend" dataKey="spend" name={ar ? "المصروف" : "Spend"} fill="#93c5fd" radius={[3, 3, 0, 0]} />
                <Line yAxisId="orders" dataKey="orders" name={ar ? "أوردرات" : "Orders"} stroke="#10b981" strokeWidth={2} dot={false} />
                <Line yAxisId="money" dataKey="cpo" name={ar ? "تكلفة الأوردر" : "Cost per order"} stroke="#ef4444" strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
        </ResponsiveContainer>
    );
}

function ProductDetail({ open, onOpenChange, name, stats, days, ads, resultLabel, ar }: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    name: string;
    stats: Totals | undefined;
    days: DayStats[];
    ads: { key: string; name: string; spend: number; results: number; impressions: number }[];
    resultLabel: string;
    ar: boolean;
}) {
    const t = (a: string, e: string) => (ar ? a : e);
    if (!stats) return null;
    const m = metrics(stats);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl" dir={ar ? "rtl" : "ltr"}>
                <DialogHeader>
                    <DialogTitle dir="auto">{name}</DialogTitle>
                    <DialogDescription><VerdictBadge v={verdict(stats)} ar={ar} /></DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Kpi label={t("المصروف", "Spend")} value={money(stats.spend)} hint={`CPM ${money(m.cpm)}`} />
                    <Kpi label={resultLabel} value={count(stats.results)} hint={`${t("تكلفة الواحدة", "Cost each")} ${money(m.costPerResult)}`} />
                    <Kpi label={t("أوردرات", "Orders")} value={stats.orders} hint={t(`${stats.confirmed} مؤكد · ${stats.units} قطعة`, `${stats.confirmed} confirmed · ${stats.units} units`)} />
                    <Kpi label={t("تكلفة الأوردر المؤكد", "Cost per confirmed order")} value={money(m.cpoConfirmed)} hint={`${t("التعادل", "Break-even")} ${money(m.breakEvenCpo)}`} strong />
                    <Kpi label={t("تكلفة المُسلَّم", "Cost per delivered")} value={money(m.cpoDelivered)} hint={`${stats.delivered} ${t("اتسلم", "delivered")} · ${stats.returned} ${t("مرتجع", "returned")}`} />
                    <Kpi label={t("معدل التحويل", "Conversion")} value={pct(m.conversionRate)} hint={`${t("إلغاء", "Cancelled")} ${pct(m.cancelRate)}`} />
                    <Kpi label="ROAS" value={times(m.roas)} hint={`${t("متوسط الأوردر", "AOV")} ${money(m.aov)}`} />
                    <Kpi label={t("ربح بعد الإعلان", "Profit after ads")} value={money(m.profitAfterAds)} tone={m.profitAfterAds >= 0 ? "good" : "bad"} hint={`${t("الإعلان من المبيعات", "Ads / sales")} ${pct(m.spendShareOfRevenue)}`} />
                </div>
                <div className="h-[240px]" dir="ltr"><DailyChart days={days} ar={ar} /></div>
                <div className="rounded-lg border">
                    <div className="border-b px-3 py-2 text-sm font-medium">{t("إعلانات المنتج", "This product's ads")}</div>
                    <div className="divide-y text-sm">
                        {ads.map(ad => (
                            <div key={ad.key} className="flex items-center justify-between gap-3 px-3 py-2">
                                <span className="truncate" dir="auto">{ad.name}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                    {money(ad.spend)} · {count(ad.results)} {resultLabel} · {money(ad.results > 0 ? ad.spend / ad.results : null)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ---------------------------------------------------------------------------

function RangePicker({ range, onChange, ar }: { range: { from: string; to: string }; onChange: (r: { from: string; to: string }) => void; ar: boolean }) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<DateRange | undefined>();
    const today = new Date();
    const presets: { label: string; from: Date; to: Date }[] = [
        { label: ar ? "آخر ٧ أيام" : "Last 7 days", from: subDays(today, 6), to: today },
        { label: ar ? "آخر ١٤ يوم" : "Last 14 days", from: subDays(today, 13), to: today },
        { label: ar ? "آخر ٣٠ يوم" : "Last 30 days", from: subDays(today, 29), to: today },
        { label: ar ? "الشهر ده" : "This month", from: startOfMonth(today), to: today },
        { label: ar ? "الشهر اللي فات" : "Last month", from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) },
    ];
    return (
        <Popover open={open} onOpenChange={o => { setOpen(o); if (o) setDraft({ from: parseISO(range.from), to: parseISO(range.to) }); }}>
            <PopoverTrigger asChild>
                <Button variant="outline" className="justify-start font-normal">
                    <CalendarIcon className="me-2 h-4 w-4" />
                    <span dir="ltr">{format(parseISO(range.from), "dd MMM")} – {format(parseISO(range.to), "dd MMM yyyy")}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="flex w-auto flex-col gap-2 p-2 sm:flex-row" align="end">
                <div className="flex flex-row flex-wrap gap-1 sm:flex-col">
                    {presets.map(p => (
                        <Button key={p.label} size="sm" variant="ghost" className="justify-start" onClick={() => { onChange({ from: iso(p.from), to: iso(p.to) }); setOpen(false); }}>
                            {p.label}
                        </Button>
                    ))}
                </div>
                <div>
                    <Calendar mode="range" numberOfMonths={1} selected={draft} onSelect={setDraft} defaultMonth={draft?.from} />
                    <Button
                        size="sm"
                        className="w-full"
                        disabled={!draft?.from}
                        onClick={() => {
                            const from = draft?.from;
                            if (!from) return;
                            onChange({ from: iso(from), to: iso(draft?.to ?? from) });
                            setOpen(false);
                        }}
                    >
                        {ar ? "تطبيق" : "Apply"}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
