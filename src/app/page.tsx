"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
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
import { Loader2, DollarSign, Package, ShoppingBag, AlertTriangle } from "lucide-react";
import { Variant } from "@/types";
import { DateRangePicker } from "@/components/date-range-picker";
import { AdvancedSearch } from "@/components/dashboard/advanced-search";
import { format } from "date-fns";

import { Suspense } from "react";

import { RecentSales } from "@/components/dashboard/recent-sales";
import { TopProducts } from "@/components/dashboard/top-products";

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // Stats
  const [stats, setStats] = useState({
    totalSales: 0,
    totalOrders: 0,
    stockValue: 0,
    lowStockCount: 0,
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
    try {
      setLoading(true);

      const start = fromDate ? `${fromDate}T00:00:00` : new Date().toISOString();
      const end = toDate ? `${toDate}T23:59:59` : new Date().toISOString();

      // 1. Dashboard Stats (RPC)
      const { data: statsData, error: statsError } = await supabase
        .rpc('get_dashboard_stats', { from_date: start, to_date: end });
      if (statsError) throw statsError;

      // 2. Daily Sales Chart (RPC)
      const { data: dailyData, error: chartError } = await supabase
        .rpc('get_daily_sales', { from_date: start, to_date: end });
      if (chartError) throw chartError;

      // 3. Top Products (RPC)
      const { data: topProds, error: topError } = await supabase
        .rpc('get_top_products', { from_date: start, to_date: end, limit_count: 5 });
      if (topError) throw topError;

      // 4. Recent Sales (Raw Query)
      const { data: recent, error: recentError } = await supabase
        .from("orders")
        .select("*, customer_info") // Need customer names
        .gte("created_at", start)
        .lte("created_at", end)
        .order("created_at", { ascending: false })
        .limit(5);
      // Note: Recent sales usually implies "Latest global sales", but here conforming to date filter is safer for "Dashboard specific to date".
      // HOWEVER, "Recent Sales" usually means "Just Happened". 
      // If I filter by "Yesterday", seeing "Recent Sales" as "Sales from Yesterday" is correct contextually.
      if (recentError) throw recentError;


      // 5. Low Stock (Raw Query)
      const { data: lowStock, error: lowStockError } = await supabase
        .from("variants")
        .select("*, products(name)")
        .eq("track_inventory", true)
        .lt("stock_qty", 5)
        .order("stock_qty", { ascending: true })
        .limit(5);
      if (lowStockError) throw lowStockError;

      // Update State
      if (statsData && statsData.length > 0) {
        const s = statsData[0];
        setStats({
          totalSales: s.total_sales || 0,
          totalOrders: s.total_orders || 0,
          stockValue: s.stock_value || 0,
          lowStockCount: s.low_stock_count || 0,
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.totalSales)}</div>
            <p className="text-xs text-muted-foreground">
              in selected period
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Orders</CardTitle>
            <ShoppingBag className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalOrders}</div>
            <p className="text-xs text-muted-foreground">
              processed orders
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stock Value</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.stockValue)}</div>
            <p className="text-xs text-muted-foreground">
              total asset value
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.lowStockCount}</div>
            <p className="text-xs text-muted-foreground">
              variants to restock
            </p>
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
