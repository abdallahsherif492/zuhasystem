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
} from "recharts";
import { Loader2, DollarSign, Package, ShoppingBag, AlertTriangle } from "lucide-react";
import { Variant } from "@/types";
import { DateRangePicker } from "@/components/date-range-picker";
import { AdvancedSearch } from "@/components/dashboard/advanced-search";
import { format } from "date-fns";

import { Suspense } from "react";

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalSales: 0,
    totalOrders: 0,
    stockValue: 0,
    lowStockCount: 0,
  });
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [lowStockItems, setLowStockItems] = useState<Variant[]>([]);
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
    // Only fetch if we have dates (or if we decide to fetch anyway, but efficient to wait for internal redirect)
    // However, the router.replace might take a tick. Let's fetch if we have dates OR if it's the initial empty state (will render once before redirect)
    // Actually, to avoid double fetch, let's wait for params if we force them.
    if (fromDate) {
      fetchDashboardData();
    }
  }, [fromDate, toDate]);

  async function fetchDashboardData() {
    try {
      setLoading(true);

      // 1. Fetch Orders with Date Filter
      let ordersQuery = supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: true });

      if (fromDate) ordersQuery = ordersQuery.gte("created_at", fromDate);
      if (toDate) {
        // Handle end of day
        ordersQuery = ordersQuery.lte("created_at", `${toDate}T23:59:59`);
      }

      const { data: orders, error: ordersError } = await ordersQuery;
      if (ordersError) throw ordersError;

      // 2. Fetch Variants (Stock)
      const { data: variants, error: variantsError } = await supabase
        .from("variants")
        .select("*");

      if (variantsError) throw variantsError;

      // Calculate Stats
      const totalSales = orders?.reduce((acc, order) => acc + order.total_amount, 0) || 0;
      const totalOrders = orders?.length || 0; // Replaces Net Profit

      const stockValue = variants?.reduce(
        (acc, v) => acc + (v.stock_qty || 0) * v.cost_price,
        0
      ) || 0;

      const lowStock = variants?.filter(
        (v) => v.track_inventory && v.stock_qty < 5
      ) || [];

      setStats({
        totalSales,
        totalOrders,
        stockValue,
        lowStockCount: lowStock.length,
      });

      setLowStockItems(lowStock.slice(0, 5));
      setRecentOrders((orders || []).slice(-5).reverse());

      // Prepare Chart Data (Sales by Date)
      const salesByDate: Record<string, number> = {};
      orders?.forEach((order) => {
        const date = new Date(order.created_at).toLocaleDateString();
        salesByDate[date] = (salesByDate[date] || 0) + order.total_amount;
      });

      const chart = Object.keys(salesByDate).map((date) => ({
        name: date,
        sales: salesByDate[date],
      }));

      setChartData(chart);

    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading && !fromDate) {
    // Initial Load waiting for redirect
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Search Bar - Global for Dashboard */}
      <div className="w-full">
        <AdvancedSearch />
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <DateRangePicker />
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.totalSales)}</div>
            <p className="text-xs text-muted-foreground">Sales in this period</p>
          </CardContent>
        </Card>

        {/* Total Orders (Replaced Net Profit) */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
            <ShoppingBag className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {stats.totalOrders}
            </div>
            <p className="text-xs text-muted-foreground">Orders in this period</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stock Value</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.stockValue)}</div>
            <p className="text-xs text-muted-foreground">Total asset value</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.lowStockCount}</div>
            <p className="text-xs text-muted-foreground">Variants needing restock</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Chart */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Sales Overview</CardTitle>
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
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => formatCurrency(value)}
                />
                <Tooltip />
                <Bar dataKey="sales" fill="#adfa1d" radius={[4, 4, 0, 0]} className="fill-primary" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Recent Sales / Low Stock */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Low Stock Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variant</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStockItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground">
                      All good!
                    </TableCell>
                  </TableRow>
                ) : (
                  lowStockItems.map(v => (
                    <TableRow key={v.id}>
                      <TableCell>{v.title}</TableCell>
                      <TableCell className="text-right font-bold text-orange-500">
                        {v.stock_qty}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
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
