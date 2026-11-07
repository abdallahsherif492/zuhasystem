"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Layers, Loader2, Pencil, Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { formatCurrency, normalizeSearchText } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BUNDLES_MIGRATION, bundlePrice, bundleStock, loadBundles, type Bundle } from "@/lib/bundles";

export default function BundlesPage() {
    const { activeBusiness } = useBusiness();
    const [state, setState] = useState<{ key: string; bundles: Bundle[]; missing: boolean; error?: string } | null>(null);
    const [query, setQuery] = useState("");

    const businessId = activeBusiness?.id;
    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        loadBundles(supabase, businessId).then(r => { if (!gone) setState({ key: businessId, ...r }); });
        return () => { gone = true; };
    }, [businessId]);

    const loading = !state || state.key !== businessId;
    const q = normalizeSearchText(query);
    const shown = (state?.bundles || []).filter(b => !q
        || normalizeSearchText(b.name).includes(q)
        || b.variants.some(v => normalizeSearchText(`${v.title} ${v.sku || ""}`).includes(q)));

    return (
        <div className="space-y-6" dir="rtl">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-semibold">الباندلز</h1>
                    <p className="max-w-2xl text-sm text-muted-foreground">
                        منتجات بتتباع مع بعض بسعر لكل منتج فيها. في الأوردر بتتسجل كمنتجاتها، فالمخزون والتكلفة بيمشوا عادي.
                        ولو جت من EasyOrders بكود الباندل، السيستم بيفكّها لمنتجاتها لوحده.
                    </p>
                </div>
                <Button asChild>
                    <Link href="/products/bundles/new"><Plus className="me-2 h-4 w-4" />باندل جديد</Link>
                </Button>
            </div>

            {state?.missing && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    الباندلز محتاجة تشغّل الملف <code className="font-mono">{BUNDLES_MIGRATION}</code> في Supabase (SQL Editor) الأول.
                </div>
            )}
            {state?.error && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                    مقدرناش نجيب الباندلز: {state.error}
                </div>
            )}

            <div className="relative max-w-sm">
                <Search className="absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="ps-8" placeholder="دوّر باسم الباندل أو الكود…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="text-start">الباندل</TableHead>
                            <TableHead className="text-start">الأنواع</TableHead>
                            <TableHead className="text-start">يكفي من المخزون</TableHead>
                            <TableHead className="w-12" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={4} className="h-24 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
                        ) : shown.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="h-32 text-center">
                                    {(state?.bundles.length || 0) === 0 && !state?.missing ? (
                                        <div className="space-y-3">
                                            <Layers className="mx-auto h-8 w-8 text-muted-foreground" />
                                            <p className="text-muted-foreground">لسه مفيش باندلز. اعمل أول واحد واختار منتجاته وسعر كل منتج فيه.</p>
                                            <Button asChild size="sm"><Link href="/products/bundles/new">باندل جديد</Link></Button>
                                        </div>
                                    ) : <span className="text-muted-foreground">مفيش باندل بالاسم ده.</span>}
                                </TableCell>
                            </TableRow>
                        ) : shown.map(b => {
                            const stocks = b.variants.map(bundleStock).filter((n): n is number => n !== null);
                            return (
                                <TableRow key={b.id} className={b.active ? "" : "opacity-60"}>
                                    <TableCell className="align-top">
                                        <div className="flex items-center gap-2 font-medium">
                                            {b.name}
                                            {!b.active && <Badge variant="outline">متوقف</Badge>}
                                        </div>
                                        {b.description && <div className="max-w-xs truncate text-sm text-muted-foreground">{b.description}</div>}
                                    </TableCell>
                                    <TableCell className="align-top">
                                        <div className="flex flex-wrap gap-1">
                                            {b.variants.map(v => (
                                                <Badge key={v.id} variant="secondary" className="gap-1 font-normal">
                                                    {v.title !== "Default" && <span>{v.title}</span>}
                                                    <span className="font-mono text-[11px]">{v.sku || "بدون كود"}</span>
                                                    <span className="font-semibold">{formatCurrency(bundlePrice(v))}</span>
                                                </Badge>
                                            ))}
                                        </div>
                                    </TableCell>
                                    <TableCell className="align-top">
                                        {stocks.length ? `${Math.min(...stocks)}–${Math.max(...stocks)}`.replace(/^(\d+)–\1$/, "$1") : "—"}
                                    </TableCell>
                                    <TableCell className="align-top">
                                        <Button asChild variant="ghost" size="icon" aria-label={`عدّل ${b.name}`}>
                                            <Link href={`/products/bundles/${b.id}`}><Pencil className="h-4 w-4" /></Link>
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
