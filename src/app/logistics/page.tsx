"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { restockItems, deductStock } from "@/lib/inventory";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowRight, TrendingUp, TrendingDown, Package, CheckCircle, AlertCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/date-range-picker";
import { startOfDay, endOfDay, subDays, format } from "date-fns";
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
    BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';

import { ChevronsUpDown, FilterX, Truck, Upload, X } from "lucide-react";
import Papa from "papaparse";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelect, Option } from "@/components/ui/multi-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const GOVERNORATES = [
    "Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
].sort();

const STATUSES = [
    "Pending",
    "Prepared",
    "Shipped",
    "Delivered",
    "Collected",
    "Cancelled",
    "Unavailable",
    "Returned",
];

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#d0ed57'];

import { Suspense } from "react";

export default function LogisticsPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <LogisticsDashboard />
        </Suspense>
    );
}

function LogisticsDashboard() {
    return (
        <LogisticsContent />
    );
}

function LogisticsContent() {
    const searchParams = useSearchParams();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters & Selection
    const [searchQuery, setSearchQuery] = useState("");
    const [govFilter, setGovFilter] = useState<string[]>([]);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [productFilter, setProductFilter] = useState<string[]>([]);
    const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

    // Data for Filters/Actions
    const [productsOptions, setProductsOptions] = useState<Option[]>([]);
    const [shippingCompanies, setShippingCompanies] = useState<any[]>([]);

    // Dialog State
    const [shippingDialogOpen, setShippingDialogOpen] = useState(false);
    const [pendingStatusChange, setPendingStatusChange] = useState<{ orderIds: string[], status: string } | null>(null);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
    const [phoneFilter, setPhoneFilter] = useState<string[] | null>(null);

    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    useEffect(() => {
        fetchOrders();
        fetchProducts();
        fetchShippingCompanies();
    }, [fromDate, toDate]);

    async function fetchProducts() {
        const { data } = await supabase.from('products').select('id, name').order('name');
        if (data) {
            setProductsOptions(data.map(p => ({ label: p.name, value: p.id })));
        }
    }

    async function fetchShippingCompanies() {
        const { data } = await supabase.from('shipping_companies').select('*').eq('active', true).order('name');
        setShippingCompanies(data || []);
    }

    async function fetchOrders() {
        try {
            setLoading(true);
            let query = supabase
                .from("orders")
                .select(`
                    *,
                    items:order_items (
                        variant:variants (
                            product:products (id, name)
                        )
                    )
                `)
                .order("created_at", { ascending: false });

            if (fromDate) {
                query = query.gte("created_at", fromDate);
            }
            if (toDate) {
                const end = new Date(toDate);
                end.setHours(23, 59, 59, 999);
                query = query.lte("created_at", end.toISOString());
            }

            const { data, error } = await query;
            if (error) throw error;
            setOrders(data || []);
        } catch (error) {
            console.error("Error fetching orders:", error);
        } finally {
            setLoading(false);
        }
    }

    // --- Update Logic ---

    const initiateStatusChange = (orderId: string, newStatus: string) => {
        // If status is "Shipped", check if company is assigned
        if (newStatus === "Shipped") {
            const order = orders.find(o => o.id === orderId);
            if (order && !order.shipping_company_id) {
                // Open Dialog to select company
                setPendingStatusChange({ orderIds: [orderId], status: newStatus });
                setShippingDialogOpen(true);
                return;
            }
        }
        // Otherwise proceed
        executeStatusUpdate([orderId], newStatus);
    };

    const executeStatusUpdate = async (orderIds: string[], newStatus: string, companyId?: string) => {
        try {
            const payload: any = { status: newStatus };
            if (companyId) payload.shipping_company_id = companyId;

            const { error } = await supabase
                .from("orders")
                .update(payload)
                .in("id", orderIds);

            if (error) throw error;

            // Handle Inventory Logic for each order (simplified loop)
            // Note: Ideally this should be a batch RPC for performance, but loop is acceptable for typical usage
            for (const oid of orderIds) {
                const order = orders.find(o => o.id === oid);
                if (!order) continue;
                const oldStatus = order.status;

                if (newStatus === 'Returned' && oldStatus !== 'Returned') {
                    const { data: items } = await supabase.from('order_items').select('variant_id, quantity').eq('order_id', oid);
                    if (items) {
                        await restockItems(
                            items.map(i => ({ variant_id: i.variant_id, qty: i.quantity })),
                            oid,
                            "Logistics: Order Returned"
                        );
                    }
                } else if (oldStatus === 'Returned' && newStatus !== 'Returned') {
                    const { data: items } = await supabase.from('order_items').select('variant_id, quantity').eq('order_id', oid);
                    if (items) {
                        await deductStock(
                            items.map(i => ({ variant_id: i.variant_id, qty: i.quantity })),
                            oid,
                            "Logistics: Status Change (Un-returned)",
                            "adjustment"
                        );
                    }
                }
            }

            toast.success("Orders updated successfully");
            setOrders(prev => prev.map(o => orderIds.includes(o.id) ? { ...o, status: newStatus, shipping_company_id: companyId || o.shipping_company_id } : o));

            // Clear selection and dialogs
            if (orderIds.length > 1) setSelectedOrders(new Set());
            setShippingDialogOpen(false);
            setPendingStatusChange(null);
            setSelectedCompanyId("");

        } catch (error) {
            console.error("Failed to update status", error);
            toast.error("Failed to update orders");
        }
    };

    const confirmShippingAssignment = () => {
        if (!selectedCompanyId) {
            toast.error("Please select a shipping company");
            return;
        }
        if (pendingStatusChange) {
            executeStatusUpdate(pendingStatusChange.orderIds, pendingStatusChange.status, selectedCompanyId);
        }
    };

    const handleBulkStatusChange = (status: string) => {
        const ids = Array.from(selectedOrders);
        if (ids.length === 0) return;

        if (status === "Shipped") {
            // Check if ANY need a company? Or just force assignment for all?
            // Safer to force prompt for bulk "Shipped" to ensure consistency or ask user.
            // Let's prompt.
            setPendingStatusChange({ orderIds: ids, status });
            setShippingDialogOpen(true);
        } else {
            if (confirm(`Update ${ids.length} orders to ${status}?`)) {
                executeStatusUpdate(ids, status);
            }
        }
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            complete: (results: any) => {
                const phones = new Set<string>();
                // Try to find a column that looks like a phone number or just take the first column
                results.data.forEach((row: any) => {
                    const values = Array.isArray(row) ? row : Object.values(row);
                    values.forEach((val: any) => {
                        if (val && typeof val === 'string') {
                            // Simple normalize: remove non-digits
                            const clean = val.replace(/\D/g, '');
                            if (clean.length >= 10) { // Assuming Egyptian phones are 10+ digits
                                phones.add(clean);
                                // Also add with 0 prefix if missing, or without if present to be safe? 
                                // Let's just store the raw digits for now and doing fuzzy match in filter
                            }
                        }
                    });
                });

                if (phones.size > 0) {
                    // Clean up phone numbers to ensure they match format in DB (usually 01xxxxxxxxx)
                    const normalizedPhones = Array.from(phones).map(p => {
                        // Ensure it starts with 0 if it's an Egyptian mobile (10 digits starting with 1 -> 01...)
                        if (p.length === 10 && p.startsWith('1')) return '0' + p;
                        return p;
                    });
                    setPhoneFilter(normalizedPhones);
                    toast.success(`Loaded ${normalizedPhones.length} phone numbers`);
                } else {
                    toast.error("No valid phone numbers found in CSV");
                }
            },
            header: false // We'll manually inspect rows to be flexible
        });
    };

    // --- Calculations & Filters ---

    // 1. Filter Logic
    const filteredOrders = orders.filter(order => {
        // Search
        // Search
        if (searchQuery) {
            const terms = searchQuery.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
            const matches = terms.some(q =>
                order.id.toLowerCase().includes(q) ||
                order.customer_info?.name?.toLowerCase().includes(q) ||
                order.customer_info?.phone?.includes(q)
            );
            if (!matches) return false;
        }

        // Gov Filter
        if (govFilter.length > 0 && !govFilter.includes(order.customer_info?.governorate || "")) return false;

        // Status Filter
        if (statusFilter.length > 0 && !statusFilter.includes(order.status)) return false;

        // Product Filter
        if (productFilter.length > 0) {
            const orderProductIds = order.items?.map((i: any) => i.variant?.product?.id).filter(Boolean) || [];
            const hasMatch = productFilter.some(pid => orderProductIds.includes(pid));
            if (!hasMatch) return false;
        }

        // Phone List Filter
        if (phoneFilter) {
            const orderPhone = order.customer_info?.phone?.replace(/\D/g, '') || '';
            // Check for exact match or suffix match
            const match = phoneFilter.some(p => orderPhone.includes(p) || p.includes(orderPhone));
            if (!match) return false;
        }

        return true;
    });

    // Selection Handlers
    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedOrders(new Set(filteredOrders.map(o => o.id)));
        } else {
            setSelectedOrders(new Set());
        }
    };

    const handleSelectRow = (id: string, checked: boolean) => {
        const newSet = new Set(selectedOrders);
        if (checked) newSet.add(id);
        else newSet.delete(id);
        setSelectedOrders(newSet);
    };

    // 2. Net Value (Total - Shipping - 10)
    const calculateNetValue = (order: any) => {
        return Math.max(0, (order.total_amount || 0) - (order.shipping_cost || 0) - 10);
    };

    // 3. Metrics Breakdown (use filteredOrders)
    const metrics = STATUSES.map(status => {
        const statusOrders = filteredOrders.filter(o => o.status === status);
        const count = statusOrders.length;
        // Summing the Net Value instead of Gross Total
        const netValue = statusOrders.reduce((acc, o) => acc + calculateNetValue(o), 0);
        return { status, count, netValue };
    });

    // 4. Grouped Stats
    const wonStatuses = ['Delivered', 'Collected'];
    const lostStatuses = ['Cancelled', 'Unavailable', 'Returned'];
    const remainingStatuses = ['Pending', 'Prepared', 'Shipped'];

    const getGroupStats = (statuses: string[]) => {
        const groupOrders = filteredOrders.filter(o => statuses.includes(o.status));
        return {
            count: groupOrders.length,
            value: groupOrders.reduce((acc, o) => acc + calculateNetValue(o), 0)
        };
    };

    const wonStats = getGroupStats(wonStatuses);
    const lostStats = getGroupStats(lostStatuses);
    const remainingStats = getGroupStats(remainingStatuses);

    // Overall Stats
    const totalOrders = filteredOrders.length;
    // Won Rate (Delivered + Collected) / Total
    const wonRate = totalOrders > 0 ? (wonStats.count / totalOrders) * 100 : 0;
    const returnRate = totalOrders > 0 ? (lostStats.count / totalOrders) * 100 : 0; // Assuming lostStats includes returned

    // 4. Chart Data: Status Distribution (Pie)
    const pieData = metrics.filter(m => m.count > 0).map(m => ({
        name: m.status,
        value: m.count
    }));

    // 5. Chart Data: Daily Trends (Bar)
    const dailyDataMap = new Map();
    filteredOrders.forEach(order => {
        const date = format(new Date(order.created_at), 'MM/dd');
        if (!dailyDataMap.has(date)) {
            dailyDataMap.set(date, { date, orders: 0, delivered: 0, collected: 0, lost: 0 });
        }
        const data = dailyDataMap.get(date);
        data.orders += 1;

        if (order.status === 'Delivered') data.delivered += 1;
        if (order.status === 'Collected') data.collected += 1;
        if (lostStatuses.includes(order.status)) data.lost += 1;
    });
    // Sort by date
    const barData = Array.from(dailyDataMap.values()).reverse();

    // 6. Top Governorates (Keep as is)
    const govMap = new Map();
    filteredOrders.forEach(order => {
        const gov = order.customer_info?.governorate || 'Unknown';
        if (!govMap.has(gov)) govMap.set(gov, 0);
        govMap.set(gov, govMap.get(gov) + 1);
    });
    const topGovs = Array.from(govMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);


    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <h1 className="text-3xl font-bold tracking-tight">Logistics</h1>
                </div>
                <div className="flex items-center gap-2 bg-background">
                    <DateRangePicker />
                </div>
            </div>

            {/* Filters Bar */}
            <div className="bg-muted/40 p-4 rounded-lg space-y-4">
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search orders (comma separated for multiple)..."
                            className="pl-8 bg-white"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <div className="grid grid-cols-3 gap-2 flex-1">
                        <MultiSelect
                            options={STATUSES.map(s => ({ label: s, value: s }))}
                            selected={statusFilter}
                            onChange={setStatusFilter}
                            placeholder="Status"
                            className="bg-white"
                        />
                        <MultiSelect
                            options={GOVERNORATES.map(g => ({ label: g, value: g }))}
                            selected={govFilter}
                            onChange={setGovFilter}
                            placeholder="Governorate"
                            className="bg-white"
                        />
                        <MultiSelect
                            options={productsOptions}
                            selected={productFilter}
                            onChange={setProductFilter}
                            placeholder="Product"
                            className="bg-white"
                        />
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => { setSearchQuery(""); setGovFilter([]); setProductFilter([]); setStatusFilter([]); }}>
                        <FilterX className="h-4 w-4" />
                    </Button>
                </div>

                {selectedOrders.size > 0 && (
                    <div className="flex items-center justify-between bg-primary/10 p-2 rounded px-4">
                        <span className="text-sm font-medium text-primary">{selectedOrders.size} Selected</span>
                        <div className="flex items-center gap-2">
                            <Select onValueChange={handleBulkStatusChange}>
                                <SelectTrigger className="w-[180px] h-8 bg-white">
                                    <SelectValue placeholder="Bulk Action" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Pending">Mark Pending</SelectItem>
                                    <SelectItem value="Prepared">Mark Prepared</SelectItem>
                                    <SelectItem value="Shipped">Mark Shipped</SelectItem>
                                    <SelectItem value="Delivered">Mark Delivered</SelectItem>
                                    <SelectItem value="Collected">Mark Collected</SelectItem>
                                    <SelectItem value="Returned">Mark Returned</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                )}

                {/* Phone Filter CSV */}
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <input
                            type="file"
                            accept=".csv"
                            id="csv-upload"
                            className="hidden"
                            onChange={handleFileUpload}
                        />
                        <Button variant="outline" size="sm" onClick={() => document.getElementById('csv-upload')?.click()}>
                            <Upload className="h-4 w-4 mr-2" />
                            {phoneFilter ? `Filtered (${phoneFilter.length} phones)` : "Upload Phones CSV"}
                        </Button>
                    </div>
                    {phoneFilter && (
                        <Button variant="ghost" size="icon" onClick={() => { setPhoneFilter(null); if (document.getElementById('csv-upload')) (document.getElementById('csv-upload') as HTMLInputElement).value = '' }}>
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Top KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
                        <Package className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalOrders}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Won Value (Rate)</CardTitle>
                        <CheckCircle className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{formatCurrency(wonStats.value)}</div>
                        <p className="text-xs text-muted-foreground">
                            {wonStats.count} Orders ({wonRate.toFixed(1)}%)
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Lost Value</CardTitle>
                        <AlertCircle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{formatCurrency(lostStats.value)}</div>
                        <p className="text-xs text-muted-foreground">{lostStats.count} Orders</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Remaining</CardTitle>
                        <TrendingUp className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-600">{formatCurrency(remainingStats.value)}</div>
                        <p className="text-xs text-muted-foreground">{remainingStats.count} Orders (Pending/Ship)</p>
                    </CardContent>
                </Card>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Status Distribution */}
                <Card>
                    <CardHeader>
                        <CardTitle>Order Status Distribution</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(val: any) => [val, 'Orders']} />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Performance Trend */}
                <Card>
                    <CardHeader>
                        <CardTitle>Daily Status Breakdown</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={barData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="delivered" name="Delivered" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
                                <Bar dataKey="collected" name="Collected" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                                <Bar dataKey="lost" name="Lost" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Top Governorates */}
                <Card>
                    <CardHeader>
                        <CardTitle>Top Regions</CardTitle>
                        <CardDescription>Highest volume governorates</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {topGovs.map((gov, i) => (
                                <div key={gov.name} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-medium">
                                            {i + 1}
                                        </div>
                                        <span className="text-sm font-medium">{gov.name}</span>
                                    </div>
                                    <Badge variant="secondary">{gov.count}</Badge>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Status Breakdown List */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>Status Breakdown</CardTitle>
                        <CardDescription>Net value excludes shipping & fees</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Count</TableHead>
                                    <TableHead className="text-right">Net Value</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {metrics.map((m) => (
                                    <TableRow key={m.status}>
                                        <TableCell>
                                            <Badge variant="outline">{m.status}</Badge>
                                        </TableCell>
                                        <TableCell>{m.count}</TableCell>
                                        <TableCell className="text-right font-medium">
                                            {formatCurrency(m.netValue)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            {/* Complete Orders Table */}
            <Card>
                <CardHeader>
                    <CardTitle>All Orders</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[40px]">
                                    <Checkbox
                                        checked={filteredOrders.length > 0 && selectedOrders.size === filteredOrders.length}
                                        onCheckedChange={handleSelectAll}
                                    />
                                </TableHead>
                                <TableHead>Order ID</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Customer</TableHead>
                                <TableHead>Gov</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Net Value</TableHead>
                                <TableHead>Shipping</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredOrders.map((order) => (
                                <TableRow key={order.id} data-state={selectedOrders.has(order.id) ? "selected" : ""}>
                                    <TableCell>
                                        <Checkbox
                                            checked={selectedOrders.has(order.id)}
                                            onCheckedChange={(c) => handleSelectRow(order.id, c as boolean)}
                                        />
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}</TableCell>
                                    <TableCell>{new Date(order.created_at).toLocaleDateString()}</TableCell>
                                    <TableCell>
                                        <div className="font-medium">{order.customer_info?.name || "N/A"}</div>
                                        <div className="text-xs text-muted-foreground">{order.customer_info?.phone}</div>
                                    </TableCell>
                                    <TableCell>{order.customer_info?.governorate || "-"}</TableCell>
                                    <TableCell>
                                        <select
                                            className="h-8 w-32 rounded-md border border-input bg-transparent px-2 text-xs"
                                            value={order.status}
                                            onChange={(e) => initiateStatusChange(order.id, e.target.value)}
                                        >
                                            {STATUSES.map(s => (
                                                <option key={s} value={s}>{s}</option>
                                            ))}
                                        </select>
                                    </TableCell>
                                    <TableCell>{formatCurrency(calculateNetValue(order))}</TableCell>
                                    <TableCell>
                                        {/* Show Shipping Company if exists */}
                                        {order.shipping_company_id ? (
                                            <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                                                <Truck className="h-3 w-3 mr-1" />
                                                {shippingCompanies.find(c => c.id === order.shipping_company_id)?.name || "Unknown"}
                                            </Badge>
                                        ) : "-"}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Shipping Assignment Dialog */}
            <Dialog open={shippingDialogOpen} onOpenChange={setShippingDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Select Shipping Company</DialogTitle>
                        <DialogDescription>
                            You must assign a courier/company to mark this as Shipped.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Shipping Company</Label>
                            <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select Company" />
                                </SelectTrigger>
                                <SelectContent>
                                    {shippingCompanies.map(c => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShippingDialogOpen(false)}>Cancel</Button>
                        <Button onClick={confirmShippingAssignment}>Confirm & Update</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
