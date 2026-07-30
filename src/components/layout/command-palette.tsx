"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
    CommandDialog, CommandInput, CommandList, CommandEmpty,
    CommandGroup, CommandItem, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { formatCurrency } from "@/lib/utils";
import {
    LayoutDashboard, ShoppingCart, Globe, Truck, Package, Box, Users,
    Banknote, LineChart, Settings, Ticket, Megaphone, FileText, ShoppingBag,
    Calendar, History, BookOpen, Wallet, AlertTriangle, Loader2, Search, Plus,
} from "lucide-react";

/**
 * Global search, opened with Ctrl/Cmd+K from anywhere.
 *
 * The system has ~40 routes across six sidebar groups, and several destinations
 * (courier settlements, bulk shipping updates) are only reachable by first
 * landing on another page and spotting a button. Rather than making people
 * learn where everything lives, this lets them type what they want — a page
 * name, a customer, a phone number, an order, a product — and jump straight to
 * it.
 */

type Dest = { label: string; hint?: string; href: string; icon: any; keywords: string };

// Arabic and English keywords on every entry: the UI language is configurable,
// and staff type whichever comes to mind.
const DESTINATIONS: Dest[] = [
    { label: "لوحة التحكم", hint: "Dashboard", href: "/dashboard", icon: LayoutDashboard, keywords: "dashboard home رئيسية الرئيسية" },
    { label: "الأوردرات", hint: "كل الأوردرات", href: "/orders", icon: ShoppingCart, keywords: "orders اوردرات طلبات" },
    { label: "أوردر جديد", hint: "إنشاء", href: "/orders/new", icon: Plus, keywords: "new order اوردر جديد انشاء create" },
    { label: "أوردرات المتاجر", hint: "محتاجة تأكيد", href: "/platform-orders", icon: Globe, keywords: "platform easyorders shopify منصات متاجر waiting" },
    { label: "التحضير والشحن", hint: "Logistics", href: "/logistics", icon: Truck, keywords: "logistics fulfilment تحضير شحن عمليات" },
    { label: "شركات الشحن", href: "/shipping", icon: Truck, keywords: "shipping couriers شحن شركات" },
    { label: "تسوية حسابات الشحن", hint: "فلوسك عند الشركات", href: "/shipping/settlements", icon: Wallet, keywords: "settlement cod reconciliation تسوية تحصيل مستحقات" },
    { label: "تحديث الشحن جماعي", hint: "رفع ملف", href: "/shipping/update", icon: Truck, keywords: "bulk update csv تحديث جماعي رفع" },
    { label: "المنتجات", href: "/products", icon: Package, keywords: "products منتجات كتالوج" },
    { label: "منتج جديد", href: "/products/new", icon: Plus, keywords: "new product منتج جديد" },
    { label: "المخزون", href: "/inventory", icon: Box, keywords: "inventory stock مخزون جرد" },
    { label: "التوالف", href: "/inventory/damages", icon: AlertTriangle, keywords: "damages توالف تلف هالك" },
    { label: "المشتريات", href: "/purchases", icon: ShoppingBag, keywords: "purchases مشتريات شراء" },
    { label: "المستحقات", hint: "Accounts Payable", href: "/payable", icon: FileText, keywords: "payable suppliers موردين مستحقات فواتير" },
    { label: "العملاء", href: "/customers", icon: Users, keywords: "customers عملاء زباين" },
    { label: "الدعم", href: "/support", icon: Ticket, keywords: "support tickets دعم تذاكر شكاوى" },
    { label: "الحسابات", href: "/accounting", icon: Banknote, keywords: "accounting خزنة حسابات مصروفات ايرادات" },
    { label: "الإعلانات", href: "/ads", icon: Megaphone, keywords: "ads اعلانات تسويق" },
    { label: "التقارير", hint: "Insights", href: "/insights", icon: LineChart, keywords: "insights reports تقارير تحليلات" },
    { label: "صافي الأرباح", href: "/insights/actual-returns", icon: LineChart, keywords: "profit net actual returns ارباح صافي" },
    { label: "الفريق", href: "/team", icon: Users, keywords: "team staff فريق موظفين" },
    { label: "الحضور", href: "/team/attendance", icon: Calendar, keywords: "attendance حضور انصراف" },
    { label: "حضوري", hint: "My HR", href: "/my-hr", icon: Calendar, keywords: "my hr حضوري بصمة" },
    { label: "سجل العمليات", href: "/actions-log", icon: History, keywords: "log audit سجل عمليات" },
    { label: "دليل النظام", href: "/guide", icon: BookOpen, keywords: "guide help دليل شرح مساعدة" },
    { label: "الإعدادات", href: "/settings", icon: Settings, keywords: "settings اعدادات ربط تكامل" },
];

interface Hit { id: string; title: string; sub: string; href: string; }

export function CommandPalette() {
    const router = useRouter();
    const { activeBusiness } = useBusiness();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [orders, setOrders] = useState<Hit[]>([]);
    const [customers, setCustomers] = useState<Hit[]>([]);
    const [products, setProducts] = useState<Hit[]>([]);
    const reqId = useRef(0);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen(v => !v);
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, []);

    const go = useCallback((href: string) => {
        setOpen(false);
        setQuery("");
        router.push(href);
    }, [router]);

    // Debounced data search. Every query is business-scoped.
    useEffect(() => {
        const q = query.trim();
        if (!activeBusiness || q.length < 2) {
            setOrders([]); setCustomers([]); setProducts([]); setSearching(false);
            return;
        }

        setSearching(true);
        // Guards against out-of-order responses overwriting newer results.
        const mine = ++reqId.current;
        const timer = setTimeout(async () => {
            const like = `%${q}%`;
            const [cust, prod, ords] = await Promise.all([
                supabase.from("customers").select("id, name, phone")
                    .eq("business_id", activeBusiness.id)
                    .or(`name.ilike.${like},phone.ilike.${like}`).limit(5),
                supabase.from("products").select("id, name")
                    .eq("business_id", activeBusiness.id)
                    .ilike("name", like).limit(5),
                supabase.from("orders").select("id, status, total_amount, customer_info, created_at")
                    .eq("business_id", activeBusiness.id)
                    .or(`customer_info->>name.ilike.${like},customer_info->>phone.ilike.${like}`)
                    .order("created_at", { ascending: false }).limit(6),
            ]);

            if (mine !== reqId.current) return;

            setCustomers((cust.data || []).map((c: any) => ({
                id: c.id, title: c.name || "—", sub: c.phone || "", href: `/customers/${c.id}`,
            })));
            setProducts((prod.data || []).map((p: any) => ({
                id: p.id, title: p.name, sub: "منتج", href: `/products/${p.id}`,
            })));
            setOrders((ords.data || []).map((o: any) => ({
                id: o.id,
                title: o.customer_info?.name || "أوردر",
                sub: `${o.status} · ${formatCurrency(Number(o.total_amount || 0))} · ${o.customer_info?.phone || ""}`,
                href: `/orders/${o.id}`,
            })));
            setSearching(false);
        }, 250);

        return () => clearTimeout(timer);
    }, [query, activeBusiness]);

    const hasData = orders.length || customers.length || products.length;

    return (
        <>
            {/* Header affordance — the shortcut is useless if nobody knows it exists. */}
            <button
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border bg-muted/40 text-muted-foreground hover:bg-muted transition-colors text-sm"
            >
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">ابحث عن أي حاجة…</span>
                <kbd className="hidden md:inline pointer-events-none select-none rounded border bg-background px-1.5 font-mono text-[10px]">
                    ⌘K
                </kbd>
            </button>

            <CommandDialog
                open={open}
                onOpenChange={setOpen}
                title="بحث"
                description="ابحث عن صفحة أو أوردر أو عميل أو منتج"
            >
                {/* shouldFilter off for data hits — the server already matched them,
                    and cmdk's fuzzy filter would drop rows matched by phone. */}
                <CommandInput
                    placeholder="اكتب اسم صفحة، رقم تليفون، اسم عميل أو منتج…"
                    value={query}
                    onValueChange={setQuery}
                />
                <CommandList>
                    <CommandEmpty>
                        {searching
                            ? <span className="flex items-center justify-center gap-2 py-4"><Loader2 className="h-4 w-4 animate-spin" /> بيدور…</span>
                            : "مفيش نتائج."}
                    </CommandEmpty>

                    <CommandGroup heading="الصفحات">
                        {DESTINATIONS.map(d => (
                            <CommandItem
                                key={d.href}
                                value={`${d.label} ${d.hint || ""} ${d.keywords}`}
                                onSelect={() => go(d.href)}
                            >
                                <d.icon className="h-4 w-4 me-2 text-muted-foreground" />
                                <span>{d.label}</span>
                                {d.hint && <span className="text-xs text-muted-foreground ms-2">{d.hint}</span>}
                                <CommandShortcut>{d.href}</CommandShortcut>
                            </CommandItem>
                        ))}
                    </CommandGroup>

                    {hasData ? <CommandSeparator /> : null}

                    {orders.length > 0 && (
                        <CommandGroup heading="أوردرات">
                            {orders.map(o => (
                                <CommandItem key={o.id} value={`order-${o.id}-${o.title}-${o.sub}`} onSelect={() => go(o.href)}>
                                    <ShoppingCart className="h-4 w-4 me-2 text-muted-foreground" />
                                    <span>{o.title}</span>
                                    <span className="text-xs text-muted-foreground ms-2 truncate">{o.sub}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {customers.length > 0 && (
                        <CommandGroup heading="عملاء">
                            {customers.map(c => (
                                <CommandItem key={c.id} value={`customer-${c.id}-${c.title}-${c.sub}`} onSelect={() => go(c.href)}>
                                    <Users className="h-4 w-4 me-2 text-muted-foreground" />
                                    <span>{c.title}</span>
                                    <span className="text-xs text-muted-foreground ms-2">{c.sub}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {products.length > 0 && (
                        <CommandGroup heading="منتجات">
                            {products.map(p => (
                                <CommandItem key={p.id} value={`product-${p.id}-${p.title}`} onSelect={() => go(p.href)}>
                                    <Package className="h-4 w-4 me-2 text-muted-foreground" />
                                    <span>{p.title}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}
                </CommandList>
            </CommandDialog>
        </>
    );
}
