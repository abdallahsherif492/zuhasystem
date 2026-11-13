"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Layers, Loader2, Package, Plus, Search } from "lucide-react";
import { supabase, fetchAll } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { cn, normalizeSearchText } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { egp, margin, type ProductRow } from "@/lib/products";

type Filter = "all" | "low" | "out" | "nocost" | "archived";
type Sort = "new" | "name" | "stock" | "margin";

const LOW = 5;

/** The catalogue: find a product, see what it sells for, makes and has left. */
export default function ProductsPage() {
    const { activeBusiness } = useBusiness();
    const businessId = activeBusiness?.id;
    const [products, setProducts] = useState<{ key: string; rows: ProductRow[] } | null>(null);
    const [q, setQ] = useState("");
    const [filter, setFilter] = useState<Filter>("all");
    const [sort, setSort] = useState<Sort>("new");

    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        fetchAll<ProductRow>((a, b) => supabase.from("products").select("*, variants(*)").eq("business_id", businessId)
            .order("created_at", { ascending: false }).range(a, b))
            .then(rows => { if (!gone) setProducts({ key: businessId, rows }); })
            .catch(() => { if (!gone) setProducts({ key: businessId, rows: [] }); });
        return () => { gone = true; };
    }, [businessId]);

    const view = useMemo(() => {
        const rows = (products?.rows || []).map(p => {
            const vs = (p.variants || []).filter(v => v.archived !== true);
            const prices = vs.map(v => Number(v.sale_price) || 0);
            const costs = vs.map(v => Number(v.cost_price) || 0);
            const tracked = vs.filter(v => v.track_inventory);
            const stock = tracked.reduce((s, v) => s + (Number(v.stock_qty) || 0), 0);
            const margins = vs.map(v => margin(Number(v.sale_price) || 0, Number(v.cost_price) || 0)).filter((m): m is number => m !== null);
            return {
                p, vs, stock, tracked: tracked.length > 0,
                minPrice: prices.length ? Math.min(...prices) : 0, maxPrice: prices.length ? Math.max(...prices) : 0,
                avgCost: costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : 0,
                margin: margins.length ? Math.round(margins.reduce((s, m) => s + m, 0) / margins.length) : null,
                out: tracked.length > 0 && tracked.some(v => (Number(v.stock_qty) || 0) <= 0),
                low: tracked.some(v => (Number(v.stock_qty) || 0) > 0 && (Number(v.stock_qty) || 0) <= LOW),
                noCost: vs.some(v => !(Number(v.cost_price) > 0)),
            };
        });
        const live = rows.filter(r => r.p.archived !== true);
        const counts = {
            all: live.length,
            low: live.filter(r => r.low).length,
            out: live.filter(r => r.out).length,
            nocost: live.filter(r => r.noCost).length,
            archived: rows.length - live.length,
        };
        const needle = normalizeSearchText(q);
        let list = (filter === "archived" ? rows.filter(r => r.p.archived === true) : live).filter(r =>
            filter === "low" ? r.low : filter === "out" ? r.out : filter === "nocost" ? r.noCost : true);
        if (needle) list = list.filter(r => normalizeSearchText(`${r.p.name} ${r.p.description || ""} ${r.vs.map(v => `${v.title} ${v.sku || ""}`).join(" ")}`).includes(needle));
        list = [...list].sort((a, b) =>
            sort === "name" ? a.p.name.localeCompare(b.p.name, "ar")
                : sort === "stock" ? a.stock - b.stock
                : sort === "margin" ? (a.margin ?? 999) - (b.margin ?? 999)
                : 0);
        return { list, counts };
    }, [products, q, filter, sort]);

    const loading = !products || products.key !== businessId;
    const chips: { key: Filter; label: string; tone?: string }[] = [
        { key: "all", label: "الكل" },
        { key: "low", label: `قرب يخلص (${LOW} أو أقل)`, tone: "text-amber-700 dark:text-amber-400" },
        { key: "out", label: "خلص", tone: "text-rose-700 dark:text-rose-400" },
        { key: "nocost", label: "من غير تكلفة", tone: "text-amber-700 dark:text-amber-400" },
        { key: "archived", label: "مؤرشف" },
    ];

    return (
        <div className="mx-auto max-w-6xl space-y-5" dir="rtl">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold">المنتجات</h1>
                    <p className="text-sm text-muted-foreground">{loading ? "…" : `${view.counts.all} منتج`}</p>
                </div>
                <div className="flex gap-2">
                    <Button asChild variant="outline"><Link href="/products/bundles"><Layers className="me-2 h-4 w-4" />الباندلز</Link></Button>
                    <Button asChild id="add-product-btn"><Link href="/products/new"><Plus className="me-2 h-4 w-4" />منتج جديد</Link></Button>
                </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                    <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="ps-9" placeholder="دوّر بالاسم أو الكود أو اللون…" value={q} onChange={e => setQ(e.target.value)} />
                </div>
                <select value={sort} onChange={e => setSort(e.target.value as Sort)} className="h-10 rounded-md border bg-background px-3 text-sm" aria-label="الترتيب">
                    <option value="new">الأحدث</option>
                    <option value="name">الاسم</option>
                    <option value="stock">المخزون الأقل الأول</option>
                    <option value="margin">الهامش الأقل الأول</option>
                </select>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {chips.map(c => (
                    <button key={c.key} type="button" onClick={() => setFilter(c.key)} aria-pressed={filter === c.key}
                        className={cn("rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            filter === c.key ? "border-foreground bg-foreground text-background" : cn("hover:bg-muted", c.tone))}>
                        {c.label} <span className="tabular-nums opacity-70">{loading ? "" : view.counts[c.key]}</span>
                    </button>
                ))}
            </div>

            <div id="products-table" className="overflow-hidden rounded-xl border bg-card">
                {loading ? (
                    <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : view.list.length === 0 ? (
                    <div className="space-y-3 p-10 text-center">
                        <Package className="mx-auto h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                            {view.counts.all === 0 && filter === "all" && !q ? "مفيش منتجات لسه. ضيف أول منتج بسعره وتكلفته." : "مفيش منتجات بالبحث أو الفلتر ده."}
                        </p>
                        {view.counts.all === 0 && <Button asChild size="sm"><Link href="/products/new">منتج جديد</Link></Button>}
                    </div>
                ) : (
                    <ul className="divide-y">
                        {view.list.map(r => (
                            <li key={r.p.id}>
                                <Link href={`/products/${r.p.id}`} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium">{r.p.name}</span>
                                            {r.p.archived && <span className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">مؤرشف</span>}
                                            {r.noCost && <span className="rounded bg-amber-50 px-1.5 text-[11px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">من غير تكلفة</span>}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {r.vs.slice(0, 6).map(v => (
                                                <span key={v.id} className={cn("rounded-md border px-1.5 py-0.5 text-[11px]",
                                                    v.track_inventory && (Number(v.stock_qty) || 0) <= 0 ? "border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-400" : "text-muted-foreground")}>
                                                    {v.title !== "Default" && <>{v.title} · </>}
                                                    <span className="font-mono" dir="ltr">{v.sku || "بدون كود"}</span>
                                                    {v.track_inventory && <> · {v.stock_qty}</>}
                                                </span>
                                            ))}
                                            {r.vs.length > 6 && <span className="text-[11px] text-muted-foreground">+{r.vs.length - 6}</span>}
                                        </div>
                                    </div>
                                    <div className="hidden w-28 shrink-0 text-end sm:block">
                                        <p className="text-sm font-semibold tabular-nums">{r.minPrice === r.maxPrice ? egp(r.minPrice) : `${egp(r.minPrice)}+`}</p>
                                        <p className={cn("text-[11px] tabular-nums", r.margin === null ? "text-muted-foreground" : r.margin < 20 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                                            {r.margin === null ? "—" : `هامش ${r.margin}%`}
                                        </p>
                                    </div>
                                    <div className="w-20 shrink-0 text-end">
                                        {r.tracked ? (
                                            <>
                                                <p className={cn("text-sm font-semibold tabular-nums", r.stock <= 0 ? "text-rose-700 dark:text-rose-400" : r.out || r.low ? "text-amber-700 dark:text-amber-400" : "")}>{r.stock}</p>
                                                <p className="text-[11px] text-muted-foreground">{r.stock > 0 && r.out ? "اختيار خلص" : "في المخزن"}</p>
                                            </>
                                        ) : <p className="text-[11px] text-muted-foreground">مش متتبّع</p>}
                                    </div>
                                    <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
