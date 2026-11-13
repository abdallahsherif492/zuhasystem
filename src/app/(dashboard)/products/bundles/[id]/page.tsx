"use client";

import { activeCatalog } from "@/lib/products";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { cn, formatCurrency } from "@/lib/utils";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ProductVariantPicker, type CatalogProduct } from "@/components/bundles/product-variant-picker";
import { BUNDLES_MIGRATION, bundleSaveError, loadBundles, skuKey, type Bundle, type BundleProduct } from "@/lib/bundles";

interface ItemDraft { key: string; variant_id: string; quantity: number; price: number }
interface VariantDraft { key: string; id?: string; title: string; sku: string; items: ItemDraft[] }

let seq = 0;
const newKey = () => `k${++seq}`;

export default function BundleEditorPage() {
    const { activeBusiness, currentUser } = useBusiness();
    const router = useRouter();
    const params = useParams();
    const bundleId = String(params.id || "");
    const isNew = bundleId === "new";
    const businessId = activeBusiness?.id;

    const [loaded, setLoaded] = useState<string | null>(null);
    const [missing, setMissing] = useState(false);
    const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
    const [others, setOthers] = useState<Bundle[]>([]);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [active, setActive] = useState(true);
    const [variants, setVariants] = useState<VariantDraft[]>([{ key: newKey(), title: "", sku: "", items: [] }]);

    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        (async () => {
            const [{ data: products }, result] = await Promise.all([
                supabase.from("products")
                    .select("*, variants(*)")
                    .eq("business_id", businessId).order("name"),
                loadBundles(supabase, businessId),
            ]);
            if (gone) return;
            setCatalog((products || []) as CatalogProduct[]);
            setMissing(result.missing);
            setOthers(result.bundles.filter(b => b.id !== bundleId));
            const mine = result.bundles.find(b => b.id === bundleId);
            if (!isNew && mine) {
                setName(mine.name);
                setDescription(mine.description || "");
                setActive(mine.active);
                setVariants(mine.variants.map(v => ({
                    key: newKey(), id: v.id, title: v.title === "Default" ? "" : v.title, sku: v.sku || "",
                    items: v.items.map(i => ({ key: newKey(), variant_id: i.variant_id, quantity: i.quantity, price: i.price })),
                })));
            }
            setLoaded(businessId);
        })();
        return () => { gone = true; };
    }, [businessId, bundleId, isNew]);

    // Every product variant by id, with its product's name.
    const productOf = useMemo(() => {
        const map = new Map<string, BundleProduct>();
        for (const p of catalog) for (const v of p.variants) map.set(v.id, { ...v, product: { name: p.name } });
        return map;
    }, [catalog]);

    // SKUs already taken: by a product, or by another bundle.
    const takenSkus = useMemo(() => {
        const map = new Map<string, string>();
        for (const p of catalog) for (const v of p.variants) if (skuKey(v.sku)) map.set(skuKey(v.sku), `المنتج «${p.name}»`);
        for (const b of others) for (const v of b.variants) if (skuKey(v.sku)) map.set(skuKey(v.sku), `الباندل «${b.name}»`);
        return map;
    }, [catalog, others]);

    const editVariant = (key: string, change: (v: VariantDraft) => VariantDraft) =>
        setVariants(prev => prev.map(v => v.key === key ? change(v) : v));

    const addProduct = (vKey: string, variantId: string) => editVariant(vKey, v => {
        const existing = v.items.find(i => i.variant_id === variantId);
        if (existing) return { ...v, items: v.items.map(i => i === existing ? { ...i, quantity: i.quantity + 1 } : i) };
        return { ...v, items: [...v.items, { key: newKey(), variant_id: variantId, quantity: 1, price: Number(productOf.get(variantId)?.sale_price) || 0 }] };
    });

    const addVariant = (copyFrom?: VariantDraft) => setVariants(prev => [...prev, {
        key: newKey(), title: "", sku: "",
        items: (copyFrom?.items || []).map(i => ({ ...i, key: newKey() })),
    }]);

    // What is wrong, per variant and overall, shown inline and blocking save.
    const problems = useMemo(() => {
        const perVariant = new Map<string, string[]>();
        const seen = new Map<string, string>();
        for (const v of variants) {
            const list: string[] = [];
            const k = skuKey(v.sku);
            if (!v.sku.trim()) list.push("اكتب كود (SKU) للنوع ده، هو اللي EasyOrders بيبعته.");
            else if (!k) list.push("الكود لازم يبقى فيه حروف إنجليزي أو أرقام.");
            else if (takenSkus.has(k)) list.push(`الكود ده مستخدم لـ ${takenSkus.get(k)}.`);
            else if (seen.has(k)) list.push("الكود ده متكرر في نوع تاني في نفس الباندل.");
            if (k) seen.set(k, v.key);
            if (variants.length > 1 && !v.title.trim()) list.push("اكتب اسم للنوع (مثلًا اللون).");
            if (!v.items.length) list.push("ضيف منتج واحد على الأقل.");
            if (v.items.some(i => !productOf.has(i.variant_id))) list.push("فيه منتج اتمسح من الكتالوج. شيله من الباندل.");
            if (list.length) perVariant.set(v.key, list);
        }
        const titles = variants.map(v => v.title.trim().toLowerCase()).filter(Boolean);
        const dupTitle = titles.length !== new Set(titles).size;
        return { perVariant, dupTitle, any: !name.trim() || dupTitle || perVariant.size > 0 };
    }, [variants, takenSkus, productOf, name]);
    const [triedSave, setTriedSave] = useState(false);

    const save = async () => {
        setTriedSave(true);
        if (!businessId || problems.any) {
            toast.error("فيه حاجات ناقصة، شوف الملاحظات الحمرا.");
            return;
        }
        setSaving(true);
        const payload = {
            id: isNew ? null : bundleId,
            name: name.trim(),
            description: description.trim() || null,
            active,
            variants: variants.map(v => ({
                id: v.id || null,
                title: v.title.trim() || "Default",
                sku: v.sku.trim(),
                items: v.items.map(i => ({ variant_id: i.variant_id, quantity: i.quantity, price: i.price })),
            })),
        };
        const { data, error } = await supabase.rpc("save_bundle", { p_business_id: businessId, p_bundle: payload });
        setSaving(false);
        if (error) {
            console.error(error);
            toast.error(bundleSaveError(error));
            return;
        }
        logBusinessAction({
            businessId,
            userEmail: currentUser?.email || "Staff",
            actionType: isNew ? "create" : "edit",
            entityType: "product",
            entityId: String(data),
            entityName: `باندل: ${payload.name}`,
            changes: payload.variants.map(v => ({
                field: `${v.title} (${v.sku})`,
                old_value: null,
                new_value: v.items.map(i => `${productOf.get(i.variant_id)?.product?.name ?? "?"} ×${i.quantity} @ ${i.price}`).join(" + "),
            })),
            metadata: { kind: "bundle" },
        });
        toast.success(isNew ? "الباندل اتعمل." : "اتحفظ.");
        router.push("/products/bundles");
    };

    const remove = async () => {
        if (!businessId || isNew) return;
        setDeleting(true);
        const { error } = await supabase.from("bundles").delete().eq("id", bundleId).eq("business_id", businessId);
        setDeleting(false);
        if (error) { toast.error("ماتمسحش، جرّب تاني."); return; }
        logBusinessAction({ businessId, userEmail: currentUser?.email || "Staff", actionType: "delete", entityType: "product", entityId: bundleId, entityName: `باندل: ${name}`, metadata: { kind: "bundle" } });
        toast.success("الباندل اتمسح.");
        router.push("/products/bundles");
    };

    if (loaded !== businessId) {
        return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    }
    if (!isNew && !name && !missing && variants.every(v => !v.id)) {
        return (
            <div className="space-y-4 p-6 text-center" dir="rtl">
                <p className="text-muted-foreground">الباندل ده مش موجود.</p>
                <Button asChild variant="outline"><Link href="/products/bundles">ارجع للباندلز</Link></Button>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-4xl space-y-6 pb-24" dir="rtl">
            <div className="flex items-center gap-3">
                <Button asChild variant="ghost" size="icon" aria-label="ارجع للباندلز">
                    <Link href="/products/bundles"><ArrowRight className="h-4 w-4" /></Link>
                </Button>
                <h1 className="text-2xl font-semibold">{isNew ? "باندل جديد" : name || "باندل"}</h1>
            </div>

            {missing && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    شغّل الملف <code className="font-mono">{BUNDLES_MIGRATION}</code> في Supabase الأول، وبعدين احفظ.
                </div>
            )}

            <Card>
                <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="bundle-name">اسم الباندل</Label>
                        <Input id="bundle-name" value={name} onChange={e => setName(e.target.value)} placeholder="مثلًا: طقم الشتا"
                            className={cn(triedSave && !name.trim() && "border-destructive")} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="bundle-desc">وصف (اختياري)</Label>
                        <Textarea id="bundle-desc" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-lg border p-3 sm:col-span-2">
                        <div>
                            <Label htmlFor="bundle-active">بيظهر في صفحات الأوردرات</Label>
                            <p className="text-xs text-muted-foreground">لو قفلته، المودريتورز مش هيشوفوه. أوردرات EasyOrders اللي فيها كوده هتتفك برضه.</p>
                        </div>
                        <Switch id="bundle-active" checked={active} onCheckedChange={setActive} />
                    </div>
                </CardContent>
            </Card>

            {variants.map((v, index) => {
                const lines = v.items.map(i => ({ ...i, product: productOf.get(i.variant_id) }));
                const price = lines.reduce((s, i) => s + i.price * i.quantity, 0);
                const list = lines.reduce((s, i) => s + (Number(i.product?.sale_price) || 0) * i.quantity, 0);
                const cost = lines.reduce((s, i) => s + (Number(i.product?.cost_price) || 0) * i.quantity, 0);
                const tracked = lines.filter(i => i.product?.track_inventory);
                const canMake = tracked.length ? Math.max(0, Math.min(...tracked.map(i => Math.floor((Number(i.product?.stock_qty) || 0) / i.quantity)))) : null;
                const issues = triedSave ? problems.perVariant.get(v.key) : undefined;
                return (
                    <Card key={v.key} className={cn(issues?.length && "border-destructive/60")}>
                        <CardHeader className="flex flex-row flex-wrap items-end gap-3 space-y-0 pb-3">
                            <CardTitle className="sr-only">نوع {index + 1}</CardTitle>
                            <div className="min-w-[10rem] flex-1 space-y-1.5">
                                <Label>اسم النوع{variants.length === 1 && " (اختياري)"}</Label>
                                <Input value={v.title} onChange={e => editVariant(v.key, x => ({ ...x, title: e.target.value }))} placeholder="مثلًا: بيج" />
                            </div>
                            <div className="w-44 space-y-1.5">
                                <Label>الكود (SKU)</Label>
                                <Input dir="ltr" className="font-mono" value={v.sku} onChange={e => editVariant(v.key, x => ({ ...x, sku: e.target.value }))} placeholder="BND-WINTER-BG" />
                            </div>
                            <div className="flex gap-1">
                                <Button type="button" variant="ghost" size="icon" title="نوع جديد بنفس المنتجات" aria-label="نوع جديد بنفس المنتجات" onClick={() => addVariant(v)}>
                                    <Copy className="h-4 w-4" />
                                </Button>
                                {variants.length > 1 && (
                                    <Button type="button" variant="ghost" size="icon" aria-label="امسح النوع ده" onClick={() => setVariants(prev => prev.filter(x => x.key !== v.key))}>
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {lines.length > 0 && (
                                <div className="overflow-x-auto rounded-md border">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/40 text-xs text-muted-foreground">
                                            <tr>
                                                <th className="p-2 text-start font-medium">المنتج</th>
                                                <th className="w-20 p-2 text-start font-medium">العدد</th>
                                                <th className="w-28 p-2 text-start font-medium">سعر القطعة في الباندل</th>
                                                <th className="w-24 p-2 text-start font-medium">الإجمالي</th>
                                                <th className="w-10" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {lines.map(i => (
                                                <tr key={i.key} className="border-t">
                                                    <td className="p-2">
                                                        <div className="font-medium">{i.product?.product?.name ?? "منتج اتمسح"}</div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {i.product && i.product.title !== "Default" && <span>{i.product.title} · </span>}
                                                            {i.product?.sku && <span className="font-mono">{i.product.sku} · </span>}
                                                            سعره لوحده {formatCurrency(Number(i.product?.sale_price) || 0)}
                                                        </div>
                                                    </td>
                                                    <td className="p-2">
                                                        <Input type="number" min={1} className="h-8 w-16" value={i.quantity}
                                                            onChange={e => editVariant(v.key, x => ({ ...x, items: x.items.map(y => y.key === i.key ? { ...y, quantity: Math.max(1, parseInt(e.target.value) || 1) } : y) }))} />
                                                    </td>
                                                    <td className="p-2">
                                                        <Input type="number" min={0} step="0.01" className="h-8 w-24" value={i.price}
                                                            onChange={e => editVariant(v.key, x => ({ ...x, items: x.items.map(y => y.key === i.key ? { ...y, price: Math.max(0, parseFloat(e.target.value) || 0) } : y) }))} />
                                                    </td>
                                                    <td className="p-2 tabular-nums">{formatCurrency(i.price * i.quantity)}</td>
                                                    <td className="p-2">
                                                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="شيل المنتج"
                                                            onClick={() => editVariant(v.key, x => ({ ...x, items: x.items.filter(y => y.key !== i.key) }))}>
                                                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <ProductVariantPicker catalog={activeCatalog(catalog)} onPick={id => addProduct(v.key, id)} />

                            {lines.length > 0 && (
                                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-4">
                                    <div><dt className="text-xs text-muted-foreground">سعر الباندل</dt><dd className="text-base font-semibold tabular-nums">{formatCurrency(price)}</dd></div>
                                    <div>
                                        <dt className="text-xs text-muted-foreground">المنتجات لوحدها</dt>
                                        <dd className="tabular-nums">{formatCurrency(list)}{list > price && <span className="ms-1 text-xs text-emerald-700 dark:text-emerald-400">(توفير {formatCurrency(list - price)})</span>}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs text-muted-foreground">التكلفة والربح</dt>
                                        <dd className={cn("tabular-nums", price - cost < 0 && "text-destructive")}>{formatCurrency(cost)} · ربح {formatCurrency(price - cost)}</dd>
                                    </div>
                                    <div><dt className="text-xs text-muted-foreground">يكفي من المخزون</dt><dd className="tabular-nums">{canMake === null ? "مش متتبع" : `${canMake} باندل`}</dd></div>
                                </dl>
                            )}

                            {issues?.length ? (
                                <ul className="list-disc space-y-0.5 ps-5 text-sm text-destructive">{issues.map(p => <li key={p}>{p}</li>)}</ul>
                            ) : null}
                        </CardContent>
                    </Card>
                );
            })}
            {triedSave && problems.dupTitle && <p className="text-sm text-destructive">فيه نوعين بنفس الاسم.</p>}

            <Button type="button" variant="outline" onClick={() => addVariant()}>
                <Plus className="me-2 h-4 w-4" />نوع جديد
            </Button>

            <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
                {!isNew ? (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button type="button" variant="ghost" className="text-destructive" disabled={deleting}>
                                {deleting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}امسح الباندل
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent dir="rtl">
                            <AlertDialogHeader>
                                <AlertDialogTitle>تمسح «{name}»؟</AlertDialogTitle>
                                <AlertDialogDescription>
                                    مش هيظهر تاني في الأوردرات، وأوردرات EasyOrders اللي فيها كوده هتوصل «منتج مش متربط».
                                    الأوردرات القديمة بتفضل بمنتجاتها وأسعارها زي ما هي. المسح مالوش رجوع.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>رجوع</AlertDialogCancel>
                                <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">امسح</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                ) : <span />}
                <div className="flex gap-2">
                    <Button asChild variant="outline"><Link href="/products/bundles">إلغاء</Link></Button>
                    <Button type="button" onClick={save} disabled={saving || missing}>
                        {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{isNew ? "اعمل الباندل" : "احفظ"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
