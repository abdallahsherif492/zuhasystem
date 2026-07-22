"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Loader2, DollarSign, Package, ShoppingBag, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Variant } from "@/types";
import { DateRangePicker } from "@/components/date-range-picker";
import { AdvancedSearch } from "@/components/dashboard/advanced-search";
import { format } from "date-fns";

import { Suspense } from "react";

import { RecentSales } from "@/components/dashboard/recent-sales";
import { TopProducts } from "@/components/dashboard/top-products";

function DashboardContent() {
  const { activeBusiness } = useBusiness();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);

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
  const [lowStockItems, setLowStockItems] = useState<Variant[]>([]);

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

  useEffect(() => {
    if (fromDate) {
      fetchDashboardData();
    }
  }, [fromDate, toDate]);

  async function fetchDashboardData() {
    if (!activeBusiness) return;
    try {
      setLoading(true);

      const start = fromDate ? `${fromDate}T00:00:00` : new Date().toISOString();
      const end = toDate ? `${toDate}T23:59:59` : new Date().toISOString();

      // Calculate Previous Period
      const startDate = new Date(start);
      const endDate = new Date(end);
      // Duration in days (round up to ensure inclusive count)
      const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      const prevStartDate = new Date(startDate);
      prevStartDate.setDate(prevStartDate.getDate() - diffDays);
      const prevStartStr = prevStartDate.toISOString();

      const prevEndDate = new Date(endDate);
      prevEndDate.setDate(prevEndDate.getDate() - diffDays);
      const prevEndStr = prevEndDate.toISOString();

      // 1. Dashboard Stats (RPC)
      const { data: statsData, error: statsError } = await supabase
        .rpc('get_dashboard_stats', { from_date: start, to_date: end, p_business_id: activeBusiness.id });
      if (statsError) throw statsError;

      const { data: prevStatsData, error: prevStatsError } = await supabase
        .rpc('get_dashboard_stats', { from_date: prevStartStr, to_date: prevEndStr, p_business_id: activeBusiness.id });
      if (prevStatsError) throw prevStatsError;

      // 2. Daily Sales Chart (RPC)
      const { data: dailyData, error: chartError } = await supabase
        .rpc('get_daily_sales', { from_date: start, to_date: end, p_business_id: activeBusiness.id });
      if (chartError) throw chartError;

      // 3. Top Products (RPC)
      const { data: topProds, error: topError } = await supabase
        .rpc('get_top_products', { from_date: start, to_date: end, limit_count: 5, p_business_id: activeBusiness.id });
      if (topError) throw topError;

      // 4. Recent Sales (Raw Query)
      const { data: recent, error: recentError } = await supabase
        .from("orders")
        .select("*, customer_info")
        .eq("business_id", activeBusiness.id)
        .gte("created_at", start)
        .lte("created_at", end)
        .order("created_at", { ascending: false })
        .limit(5);
      if (recentError) throw recentError;

      // 5. Low Stock (Raw Query)
      const { data: lowStock, error: lowStockError } = await supabase
        .from("variants")
        .select("*, products(name)")
        .eq("business_id", activeBusiness.id)
        .eq("track_inventory", true)
        .lt("stock_qty", 5)
        .order("stock_qty", { ascending: true })
        .limit(5);
      if (lowStockError) throw lowStockError;

      // 6. All Orders in Period for exact status metrics (Confirmed)
      let allPeriodOrders: any[] = [];
      let pageP = 0;
      let hasMoreP = true;
      while (hasMoreP) {
        const { data, error } = await supabase
          .from("orders")
          .select("status, total_amount")
          .eq("business_id", activeBusiness.id)
          .gte("created_at", start)
          .lte("created_at", end)
          .range(pageP * 1000, (pageP + 1) * 1000 - 1);
        if (error) throw error;
        if (data && data.length > 0) {
          allPeriodOrders.push(...data);
          if (data.length < 1000) hasMoreP = false;
          else pageP++;
        } else {
          hasMoreP = false;
        }
      }

      // 7. ALL Waiting Orders (regardless of date)
      let allWaitingOrders: any[] = [];
      let pageW = 0;
      let hasMoreW = true;
      while (hasMoreW) {
        const { data, error } = await supabase
          .from("orders")
          .select("total_amount")
          .eq("business_id", activeBusiness.id)
          .eq("status", "Waiting")
          .range(pageW * 1000, (pageW + 1) * 1000 - 1);
        if (error) throw error;
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
          if (o.status !== 'Waiting' && o.status !== 'Cancelled') {
              cCount++;
              cValue += Number(o.total_amount) || 0;
          }
      });

      let globalWCount = allWaitingOrders.length;
      let globalWValue = allWaitingOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

      // 8. Calculate total stock value and units (like Inventory page)
      let allStockVariants: any[] = [];
      let pageV = 0;
      let hasMoreV = true;
      while (hasMoreV) {
        const { data, error } = await supabase
          .from("variants")
          .select("stock_qty, cost_price, products!inner(business_id)")
          .eq("products.business_id", activeBusiness.id)
          .range(pageV * 1000, (pageV + 1) * 1000 - 1);
        if (error) throw error;
        if (data && data.length > 0) {
          allStockVariants.push(...data);
          if (data.length < 1000) hasMoreV = false;
          else pageV++;
        } else {
          hasMoreV = false;
        }
      }

      let calcStockValue = 0;
      let calcTotalItems = 0;
      allStockVariants.forEach(v => {
          calcStockValue += (v.stock_qty * v.cost_price) || 0;
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
          if (prevSales === 0) {
            sChange = currSales > 0 ? 100 : 0;
          } else {
            sChange = ((currSales - prevSales) / prevSales) * 100;
          }

          const prevOrders = prevS.total_orders || 0;
          const currOrders = s.total_orders || 0;
          if (prevOrders === 0) {
            oChange = currOrders > 0 ? 100 : 0;
          } else {
            oChange = ((currOrders - prevOrders) / prevOrders) * 100;
          }
        }

        setStats({
          totalSales: s.total_sales || 0,
          totalOrders: s.total_orders || 0,
          stockValue: calcStockValue,
          totalItems: calcTotalItems,
          lowStockCount: s.low_stock_count || 0,
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
      // @ts-ignore
      setLowStockItems(lowStock || []);

      // Format Chart Data
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
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-6">

      {/* Extended Search */}
      <div className="w-full">
        <AdvancedSearch />
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <div className="flex items-center space-x-2">
          <DateRangePicker />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("Total Sales & Orders")}</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
               <div className="text-2xl font-bold">{formatCurrency(stats.totalSales)}</div>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
               <span className="text-3xl font-black text-emerald-700 dark:text-emerald-400">{stats.totalOrders}</span>
               <span className="text-sm font-medium text-emerald-600/80 dark:text-emerald-400/80">{t("Orders")}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <span className={stats.salesChange >= 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
                {stats.salesChange > 0 ? "+" : ""}{stats.salesChange.toFixed(1)}%
              </span>
              sales from prev period
            </p>
          </CardContent>
        </Card>
        
        <Card className="bg-primary/10 dark:bg-primary/20 border-primary/20 dark:border-primary/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("Confirmed Orders")}</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
               <div className="text-2xl font-bold">{formatCurrency(stats.confirmedValue)}</div>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
               <span className="text-3xl font-black text-primary dark:text-primary">{stats.confirmedCount}</span>
               <span className="text-sm font-medium text-primary/80 dark:text-primary/80">{t("Orders")}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-amber-50/50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("Waiting Orders")}</CardTitle>
            <Clock className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
               <div className="text-2xl font-bold">{formatCurrency(stats.waitingValue)}</div>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
               <span className="text-3xl font-black text-amber-700 dark:text-amber-400">{stats.waitingCount}</span>
               <span className="text-sm font-medium text-amber-600/80 dark:text-amber-400/80">{t("Orders")}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-primary/10 dark:bg-primary/20 border-primary/20 dark:border-primary/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("Stock Value")}</CardTitle>
            <Package className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
               <div className="text-2xl font-bold">{formatCurrency(stats.stockValue)}</div>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
               <span className="text-3xl font-black text-primary dark:text-primary">{stats.totalItems}</span>
               <span className="text-sm font-medium text-primary/80 dark:text-primary/80">{t("Total Units")}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">

        {/* Main Chart */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Revenue & Orders Overview</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={chartData}>
                <XAxis
                  dataKey="name"
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  stroke="#10b981" // Emerald
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value}`} // formatCurrency implied but value is raw
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#3b82f6" // Blue
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(value: any, name: any) => {
                    if (name === "Revenue") return formatCurrency(value);
                    return value; // Orders count
                  }}
                  labelStyle={{ color: "black" }}
                  contentStyle={{ borderRadius: '8px' }}
                />
                <Legend />
                <Bar yAxisId="left" dataKey="sales" name="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="orders" name="Order Count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Recent Sales */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Recent Sales</CardTitle>
            <div className="text-sm text-muted-foreground">
              Latest transactions from this period
            </div>
          </CardHeader>
          <CardContent>
            <RecentSales orders={recentOrders} />
          </CardContent>
        </Card>
      </div>

      {/* Secondary Grid (Top Products & Low Stock) */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">

        {/* Top Selling Products */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Top Selling Products</CardTitle>
            <div className="text-sm text-muted-foreground">
              Best performing variants by units sold
            </div>
          </CardHeader>
          <CardContent>
            <TopProducts products={topProducts} />
          </CardContent>
        </Card>

        {/* Low Stock Alerts */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Inventory Alerts</CardTitle>
            <div className="text-sm text-muted-foreground">
              Items below 5 units
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {lowStockItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No critical stock levels.</p>
              ) : (
                lowStockItems.map(v => (
                  <div key={v.id} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                    <div className="flex flex-col">
                      {/* @ts-ignore */}
                      <span className="font-medium text-sm">{v.products?.name} ({v.title})</span>
                      <span className="text-xs text-muted-foreground">SKU: {v.sku || 'N/A'}</span>
                    </div>
                    <Badge variant="destructive" className="h-6">
                      {v.stock_qty} left
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
    <Suspense fallback={<div className="flex justify-center items-center h-screen"><Loader2 className="h-10 w-10 animate-spin" /></div>}>
      <DashboardContent />
    </Suspense>
  );
}
