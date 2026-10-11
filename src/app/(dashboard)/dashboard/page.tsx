"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { GettingStarted } from "@/components/onboarding/getting-started";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import { Loader2, DollarSign, AlertTriangle, CheckCircle2, Plus, Globe, Bell, X } from "lucide-react";
import { DateRangePicker } from "@/components/date-range-picker";
import { AdvancedSearch } from "@/components/dashboard/advanced-search";
import { format } from "date-fns";
import { ModeratorsLeague } from "@/components/dashboard/moderators-league";
import { CommissionBoard } from "@/components/dashboard/commission-board";
import { AdvancedAnalytics } from "@/components/dashboard/advanced-analytics";
import {
  Disclosure, PerformanceStrip, PlatformQueue, Section, ShippingQueue, normalizeOverview, type Overview,
} from "@/components/dashboard/overview";

// The dashboard is read in Arabic, and the app's own typeface has no Arabic
// letters, so it fell back to whatever the computer had. One family with
// Arabic and Latin drawn to match, and figures that line up in columns.
const plex = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], display: "swap" });

interface RestockAlertItem {
  variantId: string;
  productName: string;
  variantTitle: string;
  sku: string;
  currentStock: number;
  dailyVelocity: number;
  predictedDemand: number;
  needToBuy: number;
}

const MIGRATION = "supabase/migrations/20261009_dashboard_overview.sql";

interface RecentOrder { id: string; created_at: string; status: string; total_amount: number; channel: string | null; customer_info: { name?: string } | null }
interface TopProduct { product_name?: string; name?: string; total_sold?: number; total_units?: number; quantity?: number; total_revenue?: number }
interface DailySale { day_date: string; total_sales: number; order_count: number }
interface ChartPoint { name: string; sales: number; orders: number }
interface VariantRow { id: string; title: string; sku: string | null; stock_qty: number | null; cost_price: number | null; products: { name: string } | { name: string }[] | null }
const unitsOf = (p: TopProduct) => Number(p.total_sold ?? p.total_units ?? p.quantity ?? 0);

/**
 * The dashboard, in the order the questions come:
 *   1. How did the period go?            sales, orders, confirmation, delivery, AOV
 *   2. What work is waiting, and who did what?
 *                                        store orders to confirm, shipping problems,
 *                                        commission, the moderators league
 *   3. Sales in detail                   by day, latest orders, advanced analytics
 *   4. Products and stock                best sellers, what to restock, stock value
 * Sections 1 and 2 come from one call to dashboard_overview().
 */
function DashboardContent() {
  const { activeBusiness } = useBusiness();
  const { t, language } = useLanguage();
  const ar = language !== "en";
  const c = (a: string, e: string) => (ar ? a : e);
  const searchParams = useSearchParams();
  const router = useRouter();

  const [pendingOrderAlert, setPendingOrderAlert] = useState<{ id: string; name: string; total: number } | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<"missing" | "failed" | null>(null);
  const [stock, setStock] = useState({ value: 0, units: 0 });
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [restockAlerts, setRestockAlerts] = useState<RestockAlertItem[]>([]);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);

  const fromDate = searchParams.get("from");
  const toDate = searchParams.get("to");
  const todayStr = format(new Date(), "yyyy-MM-dd");

  // Default to today.
  useEffect(() => {
    if (!fromDate && !toDate) {
      router.replace(`?from=${todayStr}&to=${todayStr}`, { scroll: false });
    }
  }, [fromDate, toDate, router, todayStr]);

  // A banner when an order moves to Pending somewhere else.
  useEffect(() => {
    if (!activeBusiness) return;
    const channel = supabase
      .channel("dashboard-pending-orders-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `business_id=eq.${activeBusiness.id}` },
        (payload: { new?: { id?: string; status?: string; total_amount?: number; customer_info?: { name?: string } } }) => {
          const o = payload.new;
          if (o?.id && String(o.status || "").toLowerCase() === "pending") {
            setPendingOrderAlert({ id: o.id, name: o.customer_info?.name || "Customer", total: o.total_amount || 0 });
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeBusiness]);

  useEffect(() => {
    if (fromDate && activeBusiness) fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, activeBusiness]);

  async function fetchDashboardData() {
    if (!activeBusiness) return;
    const from = fromDate || todayStr;
    const to = toDate || from;
    const start = `${from}T00:00:00`;
    const end = `${to}T23:59:59`;

    try {
      const [ov, dailyRes, topRes, recentRes] = await Promise.all([
        // Sections 1 and 2: the period, its predecessor and the queues, in one call.
        supabase.rpc("dashboard_overview", { p_business_id: activeBusiness.id, p_from: from, p_to: to }),
        supabase.rpc("get_daily_sales", { from_date: start, to_date: end, p_business_id: activeBusiness.id }),
        supabase.rpc("get_top_products", { from_date: start, to_date: end, limit_count: 5, p_business_id: activeBusiness.id }),
        supabase.from("orders")
          .select("id, created_at, status, total_amount, channel, customer_info")
          .eq("business_id", activeBusiness.id)
          .gte("created_at", start)
          .lte("created_at", end)
          .order("created_at", { ascending: false })
          .limit(6),
      ]);

      if (ov.error) {
        console.error("dashboard_overview failed:", ov.error);
        setOverviewError(ov.error.code === "PGRST202" || /could not find|does not exist/i.test(ov.error.message) ? "missing" : "failed");
      } else {
        setOverviewError(null);
        setOverview(normalizeOverview(ov.data as Overview));
      }

      setRecentOrders((recentRes.data || []) as RecentOrder[]);
      setTopProducts((topRes.data || []) as TopProduct[]);
      setChartData(((dailyRes.data || []) as DailySale[]).map(d => ({
        name: format(new Date(d.day_date), "dd/MM"),
        sales: d.total_sales,
        orders: d.order_count,
      })));

      // Restock predictor: units sold over the history window against what
      // is on the shelf. Same logic as the Purchases page.
      const hDays = activeBusiness.theme_config?.restock_history_days || 14;
      const cDays = activeBusiness.theme_config?.restock_coverage_days || 14;

      const allVariants: VariantRow[] = [];
      for (let page = 0; ; page++) {
        const { data } = await supabase
          .from("variants")
          .select("id, title, sku, stock_qty, cost_price, products(name)")
          .eq("business_id", activeBusiness.id)
          .range(page * 1000, (page + 1) * 1000 - 1);
        if (!data || data.length === 0) break;
        allVariants.push(...(data as VariantRow[]));
        if (data.length < 1000) break;
      }

      const restockStart = new Date();
      restockStart.setDate(restockStart.getDate() - hDays);
      const restockOrders: { id: string }[] = [];
      for (let page = 0; ; page++) {
        const { data } = await supabase
          .from("orders")
          .select("id")
          .eq("business_id", activeBusiness.id)
          .gte("created_at", restockStart.toISOString())
          .neq("status", "Cancelled")
          .neq("status", "Waiting")
          .range(page * 1000, (page + 1) * 1000 - 1);
        if (!data || data.length === 0) break;
        restockOrders.push(...data);
        if (data.length < 1000) break;
      }

      const orderIds = restockOrders.map(o => o.id);
      const restockItems: { variant_id: string | null; quantity: number | null }[] = [];
      for (let i = 0; i < orderIds.length; i += 200) {
        const { data } = await supabase.from("order_items").select("variant_id, quantity").in("order_id", orderIds.slice(i, i + 200));
        if (data) restockItems.push(...data);
      }

      const sold: Record<string, number> = {};
      restockItems.forEach(item => {
        if (item.variant_id) sold[item.variant_id] = (sold[item.variant_id] || 0) + (item.quantity || 1);
      });

      const alerts: RestockAlertItem[] = [];
      let stockValue = 0;
      let stockUnits = 0;
      allVariants.forEach(v => {
        const dailyVelocity = (sold[v.id] || 0) / hDays;
        const predictedDemand = dailyVelocity * cDays;
        const currentStock = v.stock_qty || 0;
        const needToBuy = Math.max(0, Math.ceil(predictedDemand - currentStock));
        stockValue += ((v.stock_qty || 0) * (v.cost_price || 0)) || 0;
        stockUnits += v.stock_qty || 0;
        if (needToBuy > 0) {
          alerts.push({
            variantId: v.id,
            productName: (Array.isArray(v.products) ? v.products[0]?.name : v.products?.name) || "Unknown Product",
            variantTitle: v.title,
            sku: v.sku || "N/A",
            currentStock,
            dailyVelocity: Number(dailyVelocity.toFixed(2)),
            predictedDemand: Math.ceil(predictedDemand),
            needToBuy,
          });
        }
      });
      alerts.sort((a, b) => b.needToBuy - a.needToBuy);
      setRestockAlerts(alerts.slice(0, 6));
      setStock({ value: stockValue, units: stockUnits });
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    }
  }

  if (!fromDate) {
    return <div className="flex h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  // How the period reads: "today", one day, or a range.
  const fmt = (d: string) => new Intl.DateTimeFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "long" }).format(new Date(`${d}T12:00:00`));
  const to = toDate || fromDate;
  const isToday = fromDate === todayStr && to === todayStr;
  const periodTitle = isToday ? c("النهارده", "Today") : fromDate === to ? fmt(fromDate) : c(`من ${fmt(fromDate)} لـ ${fmt(to)}`, `${fmt(fromDate)} to ${fmt(to)}`);
  const periodPhrase = isToday ? c("النهارده", "today") : c("في الفترة دي", "in this period");
  const maxSold = Math.max(1, ...topProducts.map(unitsOf));
  const waitingCount = overview?.platform.waiting ?? 0;

  const overviewNotice = overviewError && (
    <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
      {overviewError === "missing"
        ? <>{c("الجزء ده محتاج migration يتشغّل في Supabase:", "This part needs a migration run in Supabase:")} <code className="rounded bg-muted px-1" dir="ltr">{MIGRATION}</code></>
        : c("مش قادر أحمّل الأرقام دي دلوقتي. حدّث الصفحة.", "These figures could not be loaded. Refresh the page.")}
    </div>
  );

  return (
    <div className={cn(plex.className, "flex flex-col gap-10 pb-16")} dir={ar ? "rtl" : "ltr"}>
      <div className="flex flex-col gap-4">
        <GettingStarted compact />

        {pendingOrderAlert && (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-emerald-600/30 bg-emerald-50 p-3 dark:bg-emerald-950/30">
            <div className="flex items-center gap-3 text-sm">
              <Bell className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
              <span>
                {c("أوردر اتنقل لـ Pending:", "An order moved to Pending:")} <span className="font-medium">{pendingOrderAlert.name}</span>{" "}
                <span dir="ltr">{formatCurrency(pendingOrderAlert.total)}</span>
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button asChild size="sm" variant="outline" className="h-8"><Link href={`/orders/${pendingOrderAlert.id}`}>{c("افتح الأوردر", "Open order")}</Link></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setPendingOrderAlert(null)} aria-label={c("إخفاء", "Dismiss")}><X className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        <AdvancedSearch />

        {/* Header: what period, and the four things people start from here. */}
        <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("Dashboard")}</h1>
            <p className="mt-1 text-muted-foreground">{periodTitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5"><Link href="/orders/new"><Plus className="h-4 w-4" />{c("أوردر جديد", "New order")}</Link></Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/platform-orders">
                <Globe className="h-4 w-4" />{c("طلبات المنصات", "Store orders")}
                {waitingCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold tabular-nums text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">{waitingCount}</span>}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5"><Link href="/inventory/damages"><AlertTriangle className="h-4 w-4" />{c("تسجيل تالف", "Record damage")}</Link></Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5"><Link href="/accounting"><DollarSign className="h-4 w-4" />{c("مصروف أو حركة", "Expense or transaction")}</Link></Button>
            <div id="date-range-picker" dir="ltr"><DateRangePicker /></div>
          </div>
        </div>
      </div>

      {/* 1 — How the period went */}
      <Section id="dash-performance" title={c("أداء الفترة", "How the period went")}
               description={c("مقارنة بنفس عدد الأيام اللي قبلها.", "Against the same number of days before.")}>
        {overviewNotice || (overview
          ? <PerformanceStrip o={overview} ar={ar} />
          : <div className="h-[118px] animate-pulse rounded-xl border bg-muted/30 motion-reduce:animate-none" />)}
      </Section>

      {/* 2 — The moderators' work */}
      <Section id="dash-work" title={c("شغل المودريتورز", "The moderators' work")}
               description={c("اللي مستني دلوقتي، واللي عمله كل مودريتور.", "What is waiting now, and what each moderator did.")}>
        {overviewNotice || (overview ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <PlatformQueue o={overview} ar={ar} periodLabel={periodPhrase} />
            <ShippingQueue o={overview} ar={ar} periodLabel={periodPhrase} />
          </div>
        ) : <div className="h-72 animate-pulse rounded-xl border bg-muted/30 motion-reduce:animate-none" />)}
        <div className="mt-4"><CommissionBoard /></div>
        <Disclosure storageKey="ecx:dash:league" label={c("تفاصيل المودريتورز: الترتيب والرسوم والأهداف", "Moderator details: ranking, charts and targets")}>
          <ModeratorsLeague />
        </Disclosure>
      </Section>

      {/* 3 — Sales in detail */}
      <Section id="dash-sales" title={c("المبيعات بالتفصيل", "Sales in detail")}>
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="rounded-xl border bg-card p-4 lg:col-span-3">
            <h3 className="mb-3 font-semibold">{c("يوم بيوم", "Day by day")}</h3>
            {chartData.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">{c("مفيش مبيعات في الفترة دي.", "No sales in this period.")}</p>
            ) : (
              <div dir="ltr">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData} margin={{ left: -10, right: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                    <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="right" orientation="right" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip formatter={(value, name) => (name === c("المبيعات", "Sales") ? formatCurrency(Number(value)) : value)} contentStyle={{ borderRadius: 10 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="left" dataKey="sales" name={c("المبيعات", "Sales")} fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="right" dataKey="orders" name={c("الأوردرات", "Orders")} fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-card lg:col-span-2">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="font-semibold">{c("آخر الأوردرات", "Latest orders")}</h3>
              <Link href="/orders" className="text-sm text-primary underline-offset-4 hover:underline">{c("كل الأوردرات", "All orders")}</Link>
            </div>
            {recentOrders.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{c("مفيش أوردرات في الفترة دي.", "No orders in this period.")}</p>
            ) : (
              <ul className="divide-y">
                {recentOrders.map(o => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{o.customer_info?.name || c("عميل", "Customer")}</div>
                        <div className="text-xs text-muted-foreground"><span dir="ltr">#{String(o.id).slice(0, 8)}</span> {o.channel ? `${c("من", "via")} ${o.channel}` : ""}</div>
                      </div>
                      <div className="shrink-0 text-end">
                        <div className="text-sm font-semibold tabular-nums" dir="ltr">{formatCurrency(o.total_amount)}</div>
                        <div className="text-[11px] text-muted-foreground">{o.status}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <Disclosure storageKey="ecx:dash:advanced" label={c("تحليلات متقدمة: كل يوم، المحافظات، المنتجات", "Advanced analytics: every day, governorates, products")}>
          <AdvancedAnalytics from={fromDate} to={toDate} />
        </Disclosure>
      </Section>

      {/* 4 — Products and stock */}
      <Section id="dash-stock" title={c("المنتجات والمخزون", "Products and stock")}
               aside={<div className="text-sm text-muted-foreground">{c("قيمة المخزون", "Stock value")} <span className="font-semibold text-foreground" dir="ltr">{formatCurrency(stock.value)}</span> {c(`في ${stock.units.toLocaleString("en")} قطعة`, `across ${stock.units.toLocaleString("en")} units`)}</div>}>
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="rounded-xl border bg-card lg:col-span-3">
            <div className="border-b px-4 py-3"><h3 className="font-semibold">{c("الأكتر مبيعًا", "Best sellers")}</h3></div>
            {topProducts.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{c("مفيش مبيعات في الفترة دي.", "No sales in this period.")}</p>
            ) : (
              <ol className="divide-y">
                {topProducts.map((p, i) => {
                  const units = unitsOf(p);
                  return (
                    <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-5 shrink-0 text-center text-sm font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" dir="auto">{p.product_name || p.name}</div>
                        <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max(4, (units / maxSold) * 100)}%` }} /></div>
                      </div>
                      <div className="shrink-0 text-end">
                        <div className="text-sm font-semibold tabular-nums">{units} {c("قطعة", "units")}</div>
                        <div className="text-xs text-muted-foreground" dir="ltr">{formatCurrency(p.total_revenue || 0)}</div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="rounded-xl border bg-card lg:col-span-2">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="font-semibold">{c("محتاج يتطلب", "Needs restocking")}</h3>
              <Link href="/purchases" className="text-sm text-primary underline-offset-4 hover:underline">{c("المشتريات", "Purchases")}</Link>
            </div>
            {restockAlerts.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />{c("مفيش حاجة هتخلص قريب.", "Nothing is about to run out.")}
              </div>
            ) : (
              <ul className="divide-y">
                {restockAlerts.map(v => (
                  <li key={v.variantId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium" dir="auto">{v.productName}{v.variantTitle && v.variantTitle !== "Default" ? ` (${v.variantTitle})` : ""}</div>
                      <div className="text-xs text-muted-foreground">{c(`فاضل ${v.currentStock}`, `${v.currentStock} left`)}</div>
                    </div>
                    <Badge variant="outline" className="shrink-0 border-red-300 text-red-700 dark:border-red-900 dark:text-red-300">
                      {c(`اطلب ${v.needToBuy}`, `Order ${v.needToBuy}`)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>}>
      <DashboardContent />
    </Suspense>
  );
}
