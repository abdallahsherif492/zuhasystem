"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency } from "@/lib/utils";
import { DateRangePicker } from "@/components/date-range-picker";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, X, AlertTriangle, Search, PackageSearch, ChevronsUpDown, Globe, ShoppingBag, Sparkles, Filter } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { syncStatusToEasyOrders } from "@/lib/easyorders";
import { syncStatusToShopify } from "@/lib/shopify";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";


interface OrderItem {
    id: string;
    variant_id: string | null;
    quantity: number;
    price_at_sale: number;
    unmapped_name?: string;
    unmapped_sku?: string;
    variants?: {
        title: string;
        sku: string;
        product_id: string;
        products: {
            name: string;
        };
    };
}

interface Order {
    id: string;
    customer_info: any;
    status: string;
    subtotal: number;
    total_amount: number;
    shipping_cost: number;
    easyorders_id?: string;
    shopify_id?: string;
    channel?: string;
    tags?: string[];
    payment_status: string;
    paid_amount: number;
    created_at: string;
    order_items: OrderItem[];
}

interface Variant {
    id: string;
    title: string;
    sku: string;
    sale_price: number;
    products: { name: string };
}

const GOVERNORATES = [
    "Cairo", "New Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
];

function PlatformOrdersContent() {
    const { activeBusiness } = useBusiness();
    const { t } = useLanguage();

    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [variants, setVariants] = useState<Variant[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [platformFilter, setPlatformFilter] = useState<string>("all");

    // Treasury Modal state
    const [depositModalOpen, setDepositModalOpen] = useState(false);
    const [depositOrder, setDepositOrder] = useState<Order | null>(null);
    const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
    const [transactionAccount, setTransactionAccount] = useState("");
    const [depositLoading, setDepositLoading] = useState(false);

    // Add Item state per order
    const [addItemOpen, setAddItemOpen] = useState<Record<string, boolean>>({});
    const [selectedProductForAdd, setSelectedProductForAdd] = useState<Record<string, string>>({});
    const [selectedVariantForAdd, setSelectedVariantForAdd] = useState<Record<string, string>>({});
    const [selectedProductOverride, setSelectedProductOverride] = useState<Record<string, string>>({});

    const searchParams = useSearchParams();
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        if (activeBusiness) {
            fetchOrders();
            fetchVariants();
            fetchProducts();
            fetchAccounts();
        }
    }, [activeBusiness]);

    const fetchAccounts = async () => {
        if (!activeBusiness) return;
        const { data } = await supabase
            .from("financial_accounts")
            .select("id, name")
            .eq("business_id", activeBusiness.id)
            .order("name");
        if (data && data.length > 0) setAccounts(data);
        else setAccounts([{ id: "default", name: "الخزينة الرئيسية" }]);
    };

    const fetchVariants = async () => {
        if (!activeBusiness) return;
        const { data } = await supabase
            .from('variants')
            .select('id, title, sku, sale_price, products!inner(name)')
            .eq('products.business_id', activeBusiness.id);
        if (data) setVariants(data as any[]);
    };

    const fetchProducts = async () => {
        if (!activeBusiness) return;
        const { data, error } = await supabase
            .from('products')
            .select('id, name, variants(id, title, sale_price, stock_qty, track_inventory)')
            .eq('business_id', activeBusiness.id)
            .order('name');
        if (error) console.error("Error fetching products:", error);
        if (data) setProducts(data);
    };

    const fetchOrders = async () => {
        setLoading(true);
        if (!activeBusiness) return;
        const { data, error } = await supabase
            .from('orders')
            .select(`
                id,
                customer_info,
                status,
                subtotal,
                total_amount,
                shipping_cost,
                easyorders_id,
                shopify_id,
                channel,
                tags,
                payment_status,
                paid_amount,
                created_at,
                order_items (
                    id,
                    variant_id,
                    quantity,
                    price_at_sale,
                    unmapped_name,
                    unmapped_sku,
                    variants (
                        title,
                        sku,
                        product_id,
                        products (
                            name
                        )
                    )
                )
            `)
            .eq('business_id', activeBusiness.id)
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Error fetching platform orders:", error);
            toast.error("Failed to load platform orders");
        } else {
            // Filter to include orders with easyorders_id OR shopify_id OR tags
            const platformOrders = (data as any[] || []).filter(o => {
                const isEasy = !!o.easyorders_id || (o.tags && o.tags.includes("easyorders")) || o.channel === "EasyOrders";
                const isShopify = !!o.shopify_id || (o.tags && o.tags.includes("shopify")) || o.channel === "Shopify";
                return isEasy || isShopify;
            });
            setOrders(platformOrders as Order[]);
        }
        setLoading(false);
    };

    // Filtered orders
    const filteredOrders = useMemo(() => {
        return orders.filter(o => {
            // 1. Date Filter
            if (fromDate && toDate) {
                const orderDate = new Date(o.created_at);
                const start = new Date(fromDate);
                const end = new Date(toDate);
                end.setHours(23, 59, 59, 999);
                if (orderDate < start || orderDate > end) return false;
            }

            // 2. Platform Filter
            if (platformFilter === "easyorders") {
                if (!o.easyorders_id && (!o.tags || !o.tags.includes("easyorders")) && o.channel !== "EasyOrders") return false;
            } else if (platformFilter === "shopify") {
                if (!o.shopify_id && (!o.tags || !o.tags.includes("shopify")) && o.channel !== "Shopify") return false;
            }

            // 3. Search Query
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const nameMatch = o.customer_info?.name?.toLowerCase().includes(q);
                const phoneMatch = o.customer_info?.phone?.includes(q);
                const idMatch = o.id.toLowerCase().includes(q);
                const extIdMatch = o.easyorders_id?.toLowerCase().includes(q) || o.shopify_id?.toLowerCase().includes(q);
                if (!nameMatch && !phoneMatch && !idMatch && !extIdMatch) return false;
            }

            return true;
        });
    }, [orders, fromDate, toDate, platformFilter, searchQuery]);

    const handleConfirmOrder = async (order: Order) => {
        setSaving(order.id);
        try {
            // 1. Update status to Pending
            const { error: statusError } = await supabase
                .from('orders')
                .update({ status: 'Pending' })
                .eq('id', order.id);

            if (statusError) throw statusError;

            // Sync status to platform
            if (order.easyorders_id && activeBusiness) {
                await syncStatusToEasyOrders(order.id, 'Pending', activeBusiness.id);
            } else if (order.shopify_id && activeBusiness) {
                await syncStatusToShopify(order.id, 'Pending', activeBusiness.id);
            }

            // If Paid Amount > 0, offer Treasury deposit
            if (order.paid_amount > 0) {
                setDepositOrder(order);
                setDepositModalOpen(true);
            } else {
                toast.success("Order confirmed successfully!");
            }

            fetchOrders();
        } catch (error: any) {
            console.error("Error confirming order:", error);
            toast.error(error.message || "Failed to confirm order");
        } finally {
            setSaving(null);
        }
    };

    const handleCancelOrder = async (order: Order) => {
        setSaving(order.id);
        try {
            const { error } = await supabase
                .from('orders')
                .update({ status: 'Cancelled' })
                .eq('id', order.id);

            if (error) throw error;

            if (order.easyorders_id && activeBusiness) {
                await syncStatusToEasyOrders(order.id, 'Cancelled', activeBusiness.id);
            } else if (order.shopify_id && activeBusiness) {
                await syncStatusToShopify(order.id, 'Cancelled', activeBusiness.id);
            }

            toast.success("Order cancelled");
            fetchOrders();
        } catch (error: any) {
            console.error("Error cancelling order:", error);
            toast.error(error.message || "Failed to cancel order");
        } finally {
            setSaving(null);
        }
    };

    const handleRecordDeposit = async () => {
        if (!depositOrder || !transactionAccount || !activeBusiness) return;
        setDepositLoading(true);
        try {
            await supabase.from("transactions").insert({
                business_id: activeBusiness.id,
                transaction_date: new Date().toISOString(),
                type: "revenue",
                category: "Deposits",
                description: `Platform Order Deposit #${depositOrder.id} - ${depositOrder.customer_info?.name}`,
                amount: depositOrder.paid_amount,
                account_name: transactionAccount
            });
            toast.success("Deposit recorded in treasury!");
            setDepositModalOpen(false);
            setDepositOrder(null);
        } catch (e: any) {
            toast.error("Failed to record deposit: " + e.message);
        } finally {
            setDepositLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-[50vh] w-full items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm">جاري تحميل طلبات المنصات المترابطة...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-12 font-sans">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border/50 pb-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Globe className="h-6 w-6 text-primary" />
                        Platform Synced Orders (طلبات المنصات والمتاجر)
                    </h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        إدارة وتأكيد وتوجيه جميع الطلبات المزامنة تلقائياً من EasyOrders و Shopify.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <Select value={platformFilter} onValueChange={setPlatformFilter}>
                        <SelectTrigger className="w-[160px] h-9 text-xs">
                            <SelectValue placeholder="المنصة" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">جميع المنصات (All)</SelectItem>
                            <SelectItem value="easyorders">EasyOrders</SelectItem>
                            <SelectItem value="shopify">Shopify</SelectItem>
                        </SelectContent>
                    </Select>

                    <Suspense fallback={<div>Loading picker...</div>}>
                        <DateRangePicker />
                    </Suspense>
                </div>
            </div>

            {/* Search Bar */}
            <div className="relative max-w-md">
                <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="البحث باسم العميل، الهاتف، أو رقم الأوردر..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pr-9 h-10 text-xs rounded-xl"
                />
            </div>

            {/* Orders Cards Grid */}
            {filteredOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed rounded-2xl bg-muted/20">
                    <PackageSearch className="h-10 w-10 text-muted-foreground mb-3" />
                    <h3 className="font-bold text-base">لا توجد طلبات متزامنة في هذه الفترة</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        سيتم إدراج الطلبات الجديدة القادمة من EasyOrders أو Shopify هنا تلقائياً لعمليات التأكيد والتجهيز.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {filteredOrders.map((order) => {
                        const isWaiting = order.status === "Waiting";
                        const isCancelled = order.status === "Cancelled";
                        const isShopify = !!order.shopify_id || (order.tags && order.tags.includes("shopify")) || order.channel === "Shopify";

                        return (
                            <Card key={order.id} className={`shadow-sm border transition-all rounded-2xl overflow-hidden ${
                                isWaiting ? 'border-amber-500/50 bg-amber-50/20 dark:bg-amber-950/10' :
                                isCancelled ? 'border-red-500/30 opacity-70 bg-red-50/10' : 'border-border/60'
                            }`}>
                                <CardHeader className="p-4 bg-muted/30 border-b border-border/40 flex flex-row items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className={`text-[10px] uppercase font-bold ${
                                            isShopify ? 'border-emerald-500/50 text-emerald-600 bg-emerald-500/10' : 'border-blue-500/50 text-blue-600 bg-blue-500/10'
                                        }`}>
                                            {isShopify ? 'Shopify' : 'EasyOrders'}
                                        </Badge>
                                        <span className="font-mono text-xs font-bold text-foreground">
                                            #{order.easyorders_id || order.shopify_id || order.id.substring(0, 8)}
                                        </span>
                                    </div>

                                    <Badge variant="secondary" className={`text-[10px] ${
                                        isWaiting ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' :
                                        isCancelled ? 'bg-red-500/10 text-red-600 border-red-500/30' : 'bg-emerald-500/10 text-emerald-600'
                                    }`}>
                                        {isWaiting ? 'في انتظار التأكيد' : order.status}
                                    </Badge>
                                </CardHeader>

                                <CardContent className="p-4 space-y-3">
                                    {/* Customer Info */}
                                    <div className="space-y-1">
                                        <div className="font-bold text-sm text-foreground">
                                            {order.customer_info?.name || "عميل بدون اسم"}
                                        </div>
                                        <div className="text-xs text-muted-foreground font-mono flex items-center justify-between">
                                            <span>📞 {order.customer_info?.phone || "بدون رقم"}</span>
                                            <span>📍 {order.customer_info?.governorate || "غير مسمى"}</span>
                                        </div>
                                        {order.customer_info?.address && (
                                            <div className="text-[11px] text-muted-foreground line-clamp-1">
                                                🏠 {order.customer_info.address}
                                            </div>
                                        )}
                                    </div>

                                    {/* Order Items */}
                                    <div className="border-t border-border/40 pt-2 space-y-1.5">
                                        <span className="text-[11px] font-semibold text-muted-foreground block">المنتجات المطلوب تأكيدها:</span>
                                        {order.order_items.map((item) => (
                                            <div key={item.id} className="flex items-center justify-between text-xs p-1.5 rounded-lg bg-muted/40 border border-border/30">
                                                <div className="flex items-center gap-2 truncate">
                                                    <span className="font-medium truncate">
                                                        {item.variants?.products?.name || item.unmapped_name || "منتج منصة"}
                                                    </span>
                                                    {item.variants?.title && (
                                                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                                                            {item.variants.title}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="font-bold text-xs shrink-0">
                                                    x{item.quantity} ({formatCurrency(item.price_at_sale)})
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Financial Totals */}
                                    <div className="border-t border-border/40 pt-2 flex items-center justify-between text-xs">
                                        <span className="text-muted-foreground">الإجمالي الإجمالي:</span>
                                        <span className="font-bold text-sm text-emerald-600">{formatCurrency(order.total_amount)}</span>
                                    </div>
                                </CardContent>

                                <CardFooter className="p-3 bg-muted/20 border-t border-border/40 flex items-center gap-2">
                                    {isWaiting ? (
                                        <>
                                            <Button
                                                size="sm"
                                                className="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs"
                                                disabled={saving === order.id}
                                                onClick={() => handleConfirmOrder(order)}
                                            >
                                                {saving === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                                تأكيد الأوردر ✓
                                            </Button>

                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-9 text-red-600 border-red-200 hover:bg-red-50 text-xs"
                                                disabled={saving === order.id}
                                                onClick={() => handleCancelOrder(order)}
                                            >
                                                إلغاء ✕
                                            </Button>
                                        </>
                                    ) : (
                                        <div className="text-xs text-muted-foreground w-full text-center py-1 font-medium">
                                            تم المعالجة والتأكيد بنجاح
                                        </div>
                                    )}
                                </CardFooter>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Treasury Deposit Modal */}
            <Dialog open={depositModalOpen} onOpenChange={setDepositModalOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>تسجيل دفعة مقدمة في الخزينة؟</DialogTitle>
                        <DialogDescription>
                            تم تأكيد الأوردر ومحدد به مبلغ مدفوع قدره {formatCurrency(depositOrder?.paid_amount || 0)}.
                            هل ترغب في تسجيل هذا المبلغ في خزينة المحفظة فوراً؟
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <Label>اختر الخزينة / الحساب (Treasury)</Label>
                        <Select value={transactionAccount} onValueChange={setTransactionAccount}>
                            <SelectTrigger><SelectValue placeholder="اختر الخزينة" /></SelectTrigger>
                            <SelectContent>
                                {accounts.map(acc => (
                                    <SelectItem key={acc.id} value={acc.name}>{acc.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setDepositModalOpen(false)}>تخطي</Button>
                        <Button disabled={!transactionAccount || depositLoading} onClick={handleRecordDeposit}>
                            {depositLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            تسجيل في الخزينة
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function PlatformOrdersPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>}>
            <PlatformOrdersContent />
        </Suspense>
    );
}
