"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { 
  Loader2, DollarSign, Package, AlertTriangle, CheckCircle2, 
  Clock, Plus, Globe, ArrowUpRight, X, Bell, TrendingUp, Award, Layers
} from "lucide-react";
import { DateRangePicker } from "@/components/date-range-picker";
import { AdvancedSearch } from "@/components/dashboard/advanced-search";
import { format } from "date-fns";
import { RecentSales } from "@/components/dashboard/recent-sales";

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

function DashboardContent() {
  const { activeBusiness } = useBusiness();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // Realtime Pending Order Alert State
  const [pendingOrderAlert, setPendingOrderAlert] = useState<{ id: string; name: string; total: number } | null>(null);

  // Stats
  const [stats, setStats] = useState({
    totalSales: 0,
    totalOrders: 0,
    stockValue: 0,
    totalItems: 0,
    lowStockCount: 0,
    salesChange: 0,
    ordersChange: 0,
    waitingCount: 0,
    waitingValue: 0,
    confirmedCount: 0,
    confirmedValue: 0,
  });

  // Lists
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [restockAlerts, setRestockAlerts] = useState<RestockAlertItem[]>([]);

  // Charts
  const [chartData, setChartData] = useState<any[]>([]);

  const fromDate = searchParams.get("from");
  const toDate = searchParams.get("to");

  // Default to Today if no filters
  useEffect(() => {
    if (!fromDate && !toDate) {
      const todayStr = format(new Date(), "yyyy-MM-dd");
      router.replace(`?from=${todayStr}&to=${todayStr}`, { scroll: false });
    }
  }, [fromDate, toDate, router]);

  // Realtime Pending Order Notification Listener
  useEffect(() => {
    if (!activeBusiness) return;

    const channel = supabase
      .channel("dashboard-pending-orders-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `business_id=eq.${activeBusiness.id}`
        },
        (payload: any) => {
          if (payload.new && String(payload.new.status || "").toLowerCase() === "pending") {
            const name = payload.new.customer_info?.name || "Customer";
            const total = payload.new.total_amount || 0;
            setPendingOrderAlert({ id: payload.new.id, name, total });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeBusiness]);

  useEffect(() => {
    if (fromDate && activeBusiness) {
      fetchDashboardData();
    }
  }, [fromDate, toDate, activeBusiness]);

  async function fetchDashboardData() {
    if (!activeBusiness) return;
    try {
      setLoading(true);

      const start = fromDate ? `${fromDate}T00:00:00` : new Date().toISOString();
      const end = toDate ? `${toDate}T23:59:59` : new Date().toISOString();

      // Calculate Previous Period
      const startDate = new Date(start);
      const endDate = new Date(end);
      const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      const prevStartDate = new Date(startDate);
      prevStartDate.setDate(prevStartDate.getDate() - diffDays);
      const prevStartStr = prevStartDate.toISOString();

      const prevEndDate = new Date(endDate);
      prevEndDate.setDate(prevEndDate.getDate() - diffDays);
      const prevEndStr = prevEndDate.toISOString();

      // 1. Dashboard Stats (RPC)
      const { data: statsData } = await supabase
        .rpc('get_dashboard_stats', { from_date: start, to_date: end, p_business_id: activeBusiness.id });

      const { data: prevStatsData } = await supabase
        .rpc('get_dashboard_stats', { from_date: prevStartStr, to_date: prevEndStr, p_business_id: activeBusiness.id });

      // 2. Daily Sales Chart (RPC)
      const { data: dailyData } = await supabase
        .rpc('get_daily_sales', { from_date: start, to_date: end, p_business_id: activeBusiness.id });

      // 3. Top Products (RPC)
      const { data: topProds } = await supabase
        .rpc('get_top_products', { from_date: start, to_date: end, limit_count: 5, p_business_id: activeBusiness.id });

      // 4. Recent Sales (Raw Query)
      const { data: recent } = await supabase
        .from("orders")
        .select("*, customer_info")
        .eq("business_id", activeBusiness.id)
        .gte("created_at", start)
        .lte("created_at", end)
        .order("created_at", { ascending: false })
        .limit(5);

      // 5. Restock Predictor Calculation for Inventory Alerts (Exact Logic from Purchases)
      const hDays = activeBusiness.theme_config?.restock_history_days || 14;
      const cDays = activeBusiness.theme_config?.restock_coverage_days || 14;

      let allVariants: any[] = [];
      let vPage = 0;
      let vHasMore = true;
      while (vHasMore) {
        const { data: vData } = await supabase
          .from("variants")
          .select("id, title, sku, stock_qty, products(name)")
          .eq("business_id", activeBusiness.id)
          .range(vPage * 1000, (vPage + 1) * 1000 - 1);
        if (vData && vData.length > 0) {
          allVariants.push(...vData);
          if (vData.length < 1000) vHasMore = false;
          else vPage++;
        } else {
          vHasMore = false;
        }
      }

      const restockStartDate = new Date();
      restockStartDate.setDate(restockStartDate.getDate() - hDays);

      let restockOrders: any[] = [];
      let rPage = 0;
      let rHasMore = true;
      while (rHasMore) {
        const { data: rOrders } = await supabase
          .from("orders")
          .select("id, status")
          .eq("business_id", activeBusiness.id)
          .gte("created_at", restockStartDate.toISOString())
          .neq("status", "Cancelled")
          .neq("status", "Waiting")
          .range(rPage * 1000, (rPage + 1) * 1000 - 1);
        if (rOrders && rOrders.length > 0) {
          restockOrders.push(...rOrders);
          if (rOrders.length < 1000) rHasMore = false;
          else rPage++;
        } else {
          rHasMore = false;
        }
      }

      const orderIds = restockOrders.map(o => o.id);
      let restockOrderItems: any[] = [];
      const chunkSize = 200;
      for (let i = 0; i < orderIds.length; i += chunkSize) {
        const chunk = orderIds.slice(i, i + chunkSize);
        if (chunk.length === 0) continue;
        const { data: itemsData } = await supabase
          .from("order_items")
          .select("variant_id, quantity")
          .in("order_id", chunk);
        if (itemsData) restockOrderItems.push(...itemsData);
      }

      const salesMap: Record<string, number> = {};
      restockOrderItems.forEach(item => {
        if (item.variant_id) {
          salesMap[item.variant_id] = (salesMap[item.variant_id] || 0) + (item.quantity || 1);
        }
      });

      const predictedAlerts: RestockAlertItem[] = [];
      allVariants.forEach(v => {
        const totalSold = salesMap[v.id] || 0;
        const dailyVelocity = totalSold / hDays;
        const predictedDemand = dailyVelocity * cDays;
        const currentStock = v.stock_qty || 0;
        const needToBuy = Math.max(0, Math.ceil(predictedDemand - currentStock));

        if (needToBuy > 0) {
          predictedAlerts.push({
            variantId: v.id,
            productName: v.products?.name || "Unknown Product",
            variantTitle: v.title,
            sku: v.sku || "N/A",
            currentStock,
            dailyVelocity: Number(dailyVelocity.toFixed(2)),
            predictedDemand: Math.ceil(predictedDemand),
            needToBuy
          });
        }
      });

      predictedAlerts.sort((a, b) => b.needToBuy - a.needToBuy);
      setRestockAlerts(predictedAlerts.slice(0, 5));

      // 6. Confirmed and Waiting Metrics
      let allPeriodOrders: any[] = [];
      let pageP = 0;
      let hasMoreP = true;
      while (hasMoreP) {
        const { data } = await supabase
          .from("orders")
          .select("status, total_amount")
          .eq("business_id", activeBusiness.id)
          .gte("created_at", start)
          .lte("created_at", end)
          .range(pageP * 1000, (pageP + 1) * 1000 - 1);
        if (data && data.length > 0) {
          allPeriodOrders.push(...data);
          if (data.length < 1000) hasMoreP = false;
          else pageP++;
        } else {
          hasMoreP = false;
        }
      }

      let allWaitingOrders: any[] = [];
      let pageW = 0;
      let hasMoreW = true;
      while (hasMoreW) {
        const { data } = await supabase
          .from("orders")
          .select("total_amount")
          .eq("business_id", activeBusiness.id)
          .ilike("status", "waiting")
          .range(pageW * 1000, (pageW + 1) * 1000 - 1);
        if (data && data.length > 0) {
          allWaitingOrders.push(...data);
          if (data.length < 1000) hasMoreW = false;
          else pageW++;
        } else {
          hasMoreW = false;
        }
      }

      let cCount = 0;
      let cValue = 0;
      allPeriodOrders.forEach(o => {
        const st = String(o.status || '').toLowerCase();
        if (st !== 'waiting' && st !== 'cancelled') {
          cCount++;
          cValue += Number(o.total_amount) || 0;
        }
      });

      let globalWCount = allWaitingOrders.length;
      let globalWValue = allWaitingOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

      // Stock Total Items and Value
      let calcStockValue = 0;
      let calcTotalItems = 0;
      allVariants.forEach(v => {
        calcStockValue += (v.stock_qty * (v.cost_price || 0)) || 0;
        calcTotalItems += v.stock_qty || 0;
      });

      // Update State
      if (statsData && statsData.length > 0) {
        const s = statsData[0];
        const prevS = (prevStatsData && prevStatsData.length > 0) ? prevStatsData[0] : null;

        let sChange = 0;
        let oChange = 0;

        if (prevS) {
          const prevSales = prevS.total_sales || 0;
          const currSales = s.total_sales || 0;
          sChange = prevSales === 0 ? (currSales > 0 ? 100 : 0) : ((currSales - prevSales) / prevSales) * 100;

          const prevOrders = prevS.total_orders || 0;
          const currOrders = s.total_orders || 0;
          oChange = prevOrders === 0 ? (currOrders > 0 ? 100 : 0) : ((currOrders - prevOrders) / prevOrders) * 100;
        }

        setStats({
          totalSales: s.total_sales || 0,
          totalOrders: s.total_orders || 0,
          stockValue: calcStockValue,
          totalItems: calcTotalItems,
          lowStockCount: predictedAlerts.length,
          salesChange: sChange,
          ordersChange: oChange,
          waitingCount: globalWCount,
          waitingValue: globalWValue,
          confirmedCount: cCount,
          confirmedValue: cValue
        });
      }

      setRecentOrders(recent || []);
      setTopProducts(topProds || []);

      const formattedChart = (dailyData || []).map((d: any) => ({
        name: format(new Date(d.day_date), "MMM dd"),
        sales: d.total_sales,
        orders: d.order_count
      }));
      setChartData(formattedChart);

    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading && !fromDate) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const maxSoldInTop = topProducts.length > 0 ? Math.max(...topProducts.map((p: any) => Number(p.total_sold ?? p.total_units ?? p.quantity ?? 1))) : 1;


  return (
    <div className="flex flex-col space-y-6 pb-12 font-sans">
      
      {/* Real-Time Pending Order Notification Banner */}
      {pendingOrderAlert && (
        <div className="relative overflow-hidden p-4 rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent backdrop-blur-md shadow-lg transition-all animate-in fade-in slide-in-from-top duration-300">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                  {t("New Order Moved to Pending!")}
                  <Badge variant="outline" className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px]">
                    LIVE
                  </Badge>
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("Customer")}: <span className="font-medium text-foreground">{pendingOrderAlert.name}</span> — {formatCurrency(pendingOrderAlert.total)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/orders/${pendingOrderAlert.id}`}>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
                  {t("View Order")}
                </Button>
              </Link>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground" onClick={() => setPendingOrderAlert(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Spotlight Universal Search */}
      <div className="w-full">
        <AdvancedSearch />
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
            {t("Dashboard")}
            <Layers className="h-6 w-6 text-primary" />
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("Welcome to your live analytics & management dashboard.")}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <DateRangePicker />
        </div>
      </div>

      {/* Quick Action Buttons Bar - Expanded Full Width */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link href="/orders/new">
          <Button variant="outline" className="w-full h-14 justify-start gap-3 text-xs font-semibold bg-gradient-to-br from-primary/10 via-primary/5 to-transparent hover:bg-primary/20 border-primary/20 transition-all shadow-sm">
            <Plus className="h-4 w-4 text-primary shrink-0" />
            <div className="text-left">
              <div>{t("New Order")}</div>
              <div className="text-[10px] text-muted-foreground font-normal">{t("Create Local Order")}</div>
            </div>
          </Button>
        </Link>

        <Link href="/platform-orders">
          <Button variant="outline" className="w-full h-14 justify-start gap-3 text-xs font-semibold bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent hover:bg-amber-500/20 border-amber-500/20 transition-all shadow-sm relative">
            <Globe className="h-4 w-4 text-amber-600 shrink-0" />
            <div className="text-left">
              <div>{t("Review Platform Orders")}</div>
              <div className="text-[10px] text-muted-foreground font-normal">{stats.waitingCount} {t("Pending Review")}</div>
            </div>
            {stats.waitingCount > 0 && (
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-amber-500" />
            )}
          </Button>
        </Link>

        <Link href="/inventory/damages">
          <Button variant="outline" className="w-full h-14 justify-start gap-3 text-xs font-semibold bg-gradient-to-br from-red-500/10 via-red-500/5 to-transparent hover:bg-red-500/20 border-red-500/20 transition-all shadow-sm">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
            <div className="text-left">
              <div>{t("Record Damage")}</div>
              <div className="text-[10px] text-muted-foreground font-normal">{t("Record Losses")}</div>
            </div>
          </Button>
        </Link>

        <Link href="/accounting">
          <Button variant="outline" className="w-full h-14 justify-start gap-3 text-xs font-semibold bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent hover:bg-emerald-500/20 border-emerald-500/20 transition-all shadow-sm">
            <DollarSign className="h-4 w-4 text-emerald-600 shrink-0" />
            <div className="text-left">
              <div>{t("Add Expense / Transaction")}</div>
              <div className="text-[10px] text-muted-foreground font-normal">{t("Financial Treasury")}</div>
            </div>
          </Button>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent dark:from-emerald-950/30 dark:to-transparent border-emerald-500/20 shadow-sm hover:shadow-md transition-all">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">{t("Total Sales & Orders")}</CardTitle>
            <div className="p-2 rounded-full bg-emerald-500/20 text-emerald-600">
              <DollarSign className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-emerald-900 dark:text-emerald-100">{formatCurrency(stats.totalSales)}</div>
            <div className="flex items-baseline gap-2 mt-1">
               <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{stats.totalOrders}</span>
               <span className="text-xs font-medium text-emerald-700/80 dark:text-emerald-400/80">{t("Orders")}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
              <span className={stats.salesChange >= 0 ? "text-emerald-600 font-bold" : "text-red-500 font-bold"}>
                {stats.salesChange > 0 ? "+" : ""}{stats.salesChange.toFixed(1)}%
              </span>
              {t("sales from prev period")}
            </p>
          </CardContent>
        </Card>
        
        <Card className="bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent dark:from-blue-950/30 dark:to-transparent border-blue-500/20 shadow-sm hover:shadow-md transition-all">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold text-blue-800 dark:text-blue-300 uppercase tracking-wider">{t("Confirmed Orders")}</CardTitle>
            <div className="p-2 rounded-full bg-blue-500/20 text-blue-600">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-blue-900 dark:text-blue-100">{formatCurrency(stats.confirmedValue)}</div>
            <div className="flex items-baseline gap-2 mt-1">
               <span className="text-2xl font-black text-blue-600 dark:text-blue-400">{stats.confirmedCount}</span>
               <span className="text-xs font-medium text-blue-700/80 dark:text-blue-400/80">{t("Orders")}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent dark:from-amber-950/30 dark:to-transparent border-amber-500/20 shadow-sm hover:shadow-md transition-all">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider">{t("Waiting Orders")}</CardTitle>
            <div className="p-2 rounded-full bg-amber-500/20 text-amber-600">
              <Clock className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-amber-900 dark:text-amber-100">{formatCurrency(stats.waitingValue)}</div>
            <div className="flex items-baseline gap-2 mt-1">
               <span className="text-2xl font-black text-amber-600 dark:text-amber-400">{stats.waitingCount}</span>
               <span className="text-xs font-medium text-amber-700/80 dark:text-amber-400/80">{t("Orders")}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent dark:from-purple-950/30 dark:to-transparent border-purple-500/20 shadow-sm hover:shadow-md transition-all">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold text-purple-800 dark:text-purple-300 uppercase tracking-wider">{t("Stock Value")}</CardTitle>
            <div className="p-2 rounded-full bg-purple-500/20 text-purple-600">
              <Package className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-purple-900 dark:text-purple-100">{formatCurrency(stats.stockValue)}</div>
            <div className="flex items-baseline gap-2 mt-1">
               <span className="text-2xl font-black text-purple-600 dark:text-purple-400">{stats.totalItems}</span>
               <span className="text-xs font-medium text-purple-700/80 dark:text-purple-400/80">{t("Total Units")}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">

        {/* Main Interactive Chart */}
        <Card className="col-span-4 shadow-sm border border-border/60">
          <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
                {t("Revenue & Orders Overview")}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData}>
                <XAxis dataKey="name" stroke="#888888" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" orientation="left" stroke="#10b981" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: any, name: any) => name === "Revenue" ? formatCurrency(value) : value} contentStyle={{ borderRadius: '12px', border: '1px solid rgba(0,0,0,0.1)' }} />
                <Legend />
                <Bar yAxisId="left" dataKey="sales" name="Revenue" fill="#10b981" radius={[6, 6, 0, 0]} />
                <Bar yAxisId="right" dataKey="orders" name="Order Count" fill="#3b82f6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Recent Sales */}
        <Card className="col-span-3 shadow-sm border border-border/60">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base font-bold">{t("Recent Sales")}</CardTitle>
            <CardDescription className="text-xs">{t("Latest transactions from this period")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <RecentSales orders={recentOrders} />
          </CardContent>
        </Card>
      </div>

      {/* Secondary Grid (Top Products & Restock Predictor Alerts) */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">

        {/* Redesigned Top Selling Products */}
        <Card className="col-span-4 shadow-sm border border-border/60">
          <CardHeader className="border-b pb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Award className="h-5 w-5 text-amber-500" />
                {t("Top Selling Products")}
              </CardTitle>
              <CardDescription className="text-xs">{t("Best performing variants by units sold")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {topProducts.length === 0 ? (
              <div className="text-xs text-muted-foreground py-8 text-center">{t("No sales recorded in this period.")}</div>
            ) : (
              topProducts.map((p: any, idx: number) => {
                const unitsCount = Number(p.total_sold ?? p.total_units ?? p.quantity ?? 0);
                const percent = Math.min(100, Math.round((unitsCount / maxSoldInTop) * 100));
                return (
                  <div key={idx} className="p-3 rounded-xl border bg-muted/20 space-y-2">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="h-6 px-2 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-bold shrink-0">
                          #{idx + 1}
                        </Badge>
                        <span className="font-bold text-foreground text-xs">{p.product_name || p.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="secondary" className="font-bold text-xs bg-primary/10 text-primary">
                          {unitsCount} {t("units")}
                        </Badge>
                        <span className="font-bold text-xs text-foreground">{formatCurrency(p.total_revenue || 0)}</span>
                      </div>
                    </div>
                    <Progress value={percent} className="h-2 bg-muted/60" />
                  </div>
                );
              })
            )}

          </CardContent>
        </Card>

        {/* Restock Predictor Inventory Alerts */}
        <Card className="col-span-3 shadow-sm border border-border/60">
          <CardHeader className="border-b pb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                {t("Restock Predictor Alerts")}
              </CardTitle>
              <CardDescription className="text-xs">{t("Items predicted to run out based on sales velocity")}</CardDescription>
            </div>
            <Link href="/purchases">
              <Button variant="ghost" size="sm" className="h-7 text-[11px] text-primary gap-1">
                {t("View All")} <ArrowUpRight className="h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3">
              {restockAlerts.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                  {t("No inventory restock needed")}
                </div>
              ) : (
                restockAlerts.map(v => (
                  <div key={v.variantId} className="p-3 rounded-lg border bg-muted/20 flex items-center justify-between gap-2 text-xs">
                    <div className="space-y-0.5">
                      <p className="font-semibold text-foreground">{v.productName} ({v.variantTitle})</p>
                      <p className="text-[11px] text-muted-foreground font-mono">SKU: {v.sku} — {t("Current Stock")}: {v.currentStock}</p>
                    </div>
                    <Badge variant="destructive" className="shrink-0 font-semibold px-2 py-1 bg-red-500/10 text-red-600 border-red-500/20">
                      {t("Need to buy")}: {v.needToBuy} {t("units")}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex justify-center items-center h-screen"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>}>
      <DashboardContent />
    </Suspense>
  );
}
