"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowRight, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { cn } from "@/lib/utils";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { egp, isMissingRpc, margin, productError, suggestSku, type ProductRow } from "@/lib/products";

interface Draft {
    key: string;
    id?: string;
    title: string;
    sku: string;
    sale_price: string;
    cost_price: string;
    track_inventory: boolean;
    /** New variants: opening stock. Existing: shown, never saved from here. */
    stock_qty: string;
    current_stock?: number;
}

let seq = 0;
const k = () => `v${++seq}`;
const num = (s: string) => (s === "" ? 0 : Number(s) || 0);

const blank = (title = "Default"): Draft => ({ key: k(), title, sku: "", sale_price: "", cost_price: "", track_inventory: true, stock_qty: "" });

/**
 * Add or edit a product. One product with one price, or several options
 * (colours, sizes), each with its own code, price, cost and stock.
 * Existing stock is shown, not edited: it moves with orders and the stock
 * page, and writing it back from a form open for a while undid real sales.
 */
export function ProductEditor({ productId }: { productId?: string }) {
    const { activeBusiness, currentUser } = useBusiness();
    const router = useRouter();
    const businessId = activeBusiness?.id;
    const isNew = !productId;

    const [loaded, setLoaded] = useState(isNew);
    const [notFound, setNotFound] = useState(false);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [archived, setArchived] = useState(false);
    const [hasOptions, setHasOptions] = useState(false);
    const [variants, setVariants] = useState<Draft[]>([blank()]);
    const [original, setOriginal] = useState<ProductRow | null>(null);
    const [saving, setSaving] = useState(false);
    const [tried, setTried] = useState(false);

    useEffect(() => {
        if (!businessId || !productId) return;
        let gone = false;
        supabase.from("products").select("*, variants(*)").eq("business_id", businessId).eq("id", productId).maybeSingle()
            .then(({ data }) => {
                if (gone) return;
                if (!data) { setNotFound(true); setLoaded(true); return; }
                const p = data as ProductRow;
                const vs = (p.variants || []).filter(v => v.archived !== true)
                    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
                setOriginal(p);
                setName(p.name);
                setDescription(p.description || "");
                setArchived(!!p.archived);
                setHasOptions(vs.length > 1 || (vs[0] && vs[0].title !== "Default"));
                setVariants(vs.length ? vs.map(v => ({
                    key: k(), id: v.id, title: v.title, sku: v.sku || "",
                    sale_price: String(v.sale_price ?? ""), cost_price: String(v.cost_price ?? ""),
                    track_inventory: !!v.track_inventory, stock_qty: "", current_stock: Number(v.stock_qty) || 0,
                })) : [blank()]);
                setLoaded(true);
            });
        return () => { gone = true; };
    }, [businessId, productId]);

    const edit = (key: string, patch: Partial<Draft>) => setVariants(vs => vs.map(v => (v.key === key ? { ...v, ...patch } : v)));

    const toggleOptions = (on: boolean) => {
        setHasOptions(on);
        if (on) setVariants(vs => vs.map((v, i) => (i === 0 && v.title === "Default" ? { ...v, title: "" } : v)));
        else setVariants(vs => [{ ...vs[0], title: "Default" }]);
    };

    const problems = useMemo(() => {
        const out: string[] = [];
        if (!name.trim()) out.push("اكتب اسم المنتج.");
        if (hasOptions && variants.some(v => !v.title.trim())) out.push("اكتب اسم لكل اختيار (مثلًا اللون).");
        const titles = variants.map(v => v.title.trim().toLowerCase());
        if (new Set(titles).size !== titles.length) out.push("فيه اختيارين بنفس الاسم.");
        const skus = variants.map(v => v.sku.trim().toLowerCase()).filter(Boolean);
        if (new Set(skus).size !== skus.length) out.push("فيه كود (SKU) متكرر.");
        if (variants.some(v => v.sale_price === "" || num(v.sale_price) < 0)) out.push("اكتب سعر البيع.");
        return out;
    }, [name, hasOptions, variants]);

    const zeroCost = variants.some(v => num(v.cost_price) === 0);

    const save = async () => {
        setTried(true);
        if (!businessId || problems.length) { toast.error(problems[0] || "فيه بيانات ناقصة."); return; }
        setSaving(true);
        const payload = {
            id: productId || null,
            name: name.trim(),
            description: description.trim() || null,
            archived,
            variants: variants.map(v => ({
                id: v.id || null,
                title: hasOptions ? v.title.trim() : "Default",
                sku: v.sku.trim() || null,
                sale_price: num(v.sale_price),
                cost_price: num(v.cost_price),
                track_inventory: v.track_inventory,
                stock_qty: v.id ? undefined : num(v.stock_qty),
            })),
        };
        let savedId: string | null = null;
        const { data, error } = await supabase.rpc("save_product", { p_business_id: businessId, p_product: payload });
        if (error && isMissingRpc(error, "save_product")) {
            try { savedId = await legacySave(businessId, payload, original); }
            catch (e) { setSaving(false); toast.error(productError(e as never)); return; }
        } else if (error) {
            setSaving(false);
            toast.error(productError(error));
            return;
        } else savedId = data as string;
        setSaving(false);

        logBusinessAction({
            businessId, userEmail: currentUser?.email || "Staff", actionType: isNew ? "create" : "edit",
            entityType: "product", entityId: savedId || "", entityName: payload.name,
            changes: diff(original, payload),
        });
        toast.success(isNew ? "المنتج اتضاف." : "اتحفظ.");
        if (zeroCost) toast.warning("فيه اختيار تكلفته صفر، الربح هيتحسب غلط لحد ما تكتبها.");
        router.push("/products");
    };

    const remove = async () => {
        if (!businessId || !productId) return;
        const { error } = await supabase.rpc("delete_product", { p_product_id: productId });
        if (error && isMissingRpc(error, "delete_product")) {
            const { error: e2 } = await supabase.from("products").delete().eq("business_id", businessId).eq("id", productId);
            if (e2) { toast.error(productError(e2)); return; }
        } else if (error) { toast.error(productError(error)); return; }
        logBusinessAction({ businessId, userEmail: currentUser?.email || "Staff", actionType: "delete", entityType: "product", entityId: productId, entityName: name, changes: [{ field: "Product", old_value: name, new_value: "Deleted" }] });
        toast.success("المنتج اتمسح.");
        router.push("/products");
    };

    const setArchive = async (value: boolean) => {
        if (!businessId || !productId) return;
        const { error } = await supabase.from("products").update({ archived: value }).eq("business_id", businessId).eq("id", productId);
        if (error) { toast.error(/archived/.test(error.message) ? "شغّل ملف المنتجات في Supabase الأول." : productError(error)); return; }
        setArchived(value);
        logBusinessAction({ businessId, userEmail: currentUser?.email || "Staff", actionType: "edit", entityType: "product", entityId: productId, entityName: name, changes: [{ field: "Archived", old_value: !value, new_value: value }] });
        toast.success(value ? "اتأرشف: مش هيظهر في الأوردرات." : "رجع للكتالوج.");
    };

    if (!loaded) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    if (notFound) return (
        <div className="space-y-4 p-6 text-center" dir="rtl">
            <p className="text-muted-foreground">المنتج ده مش موجود.</p>
            <Button asChild variant="outline"><Link href="/products">ارجع للمنتجات</Link></Button>
        </div>
    );

    return (
        <div className="mx-auto max-w-4xl space-y-6 pb-28" dir="rtl">
            <div className="flex items-center gap-3">
                <Button asChild variant="ghost" size="icon" aria-label="ارجع للمنتجات"><Link href="/products"><ArrowRight className="h-4 w-4" /></Link></Button>
                <h1 className="text-2xl font-bold">{isNew ? "منتج جديد" : name || "منتج"}</h1>
                {archived && <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">مؤرشف</span>}
            </div>

            {/* Basics */}
            <section className="space-y-4 rounded-2xl border bg-card p-5">
                <div className="space-y-1.5">
                    <Label htmlFor="p-name">اسم المنتج</Label>
                    <Input id="p-name" value={name} onChange={e => setName(e.target.value)} placeholder="مثلًا: Jumbo Faux Fur Throw Blanket JTB1"
                        className={cn("text-base", tried && !name.trim() && "border-destructive")} />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="p-desc">الوصف</Label>
                    <Textarea id="p-desc" rows={3} value={description} onChange={e => setDescription(e.target.value)}
                        placeholder="اختياري. أول سطر بالعربي بيظهر جنب اسم المنتج على البوليصة وفي شيت شركة الشحن." />
                </div>
            </section>

            {/* Prices, codes, stock */}
            <section className="space-y-4 rounded-2xl border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-semibold">السعر والكود والمخزون</h2>
                    <label className="flex items-center gap-2 text-sm">
                        <Switch checked={hasOptions} onCheckedChange={toggleOptions} />
                        ليه اختيارات (ألوان، مقاسات...)
                    </label>
                </div>

                <div className="space-y-3">
                    {variants.map((v, i) => (
                        <VariantCard key={v.key} v={v} index={i} hasOptions={hasOptions} productName={name} tried={tried}
                            onChange={patch => edit(v.key, patch)}
                            onRemove={variants.length > 1 ? () => setVariants(vs => vs.filter(x => x.key !== v.key)) : undefined} />
                    ))}
                </div>

                {hasOptions && (
                    <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" className="gap-1.5"
                            onClick={() => setVariants(vs => [...vs, { ...blank(""), sale_price: vs[vs.length - 1]?.sale_price || "", cost_price: vs[vs.length - 1]?.cost_price || "", track_inventory: vs[vs.length - 1]?.track_inventory ?? true }])}>
                            <Plus className="h-4 w-4" />اختيار جديد
                        </Button>
                        {variants.length > 1 && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => {
                                const f = variants[0];
                                setVariants(vs => vs.map(x => ({ ...x, sale_price: f.sale_price, cost_price: f.cost_price })));
                                toast.success("سعر وتكلفة أول اختيار اتطبقوا على الكل.");
                            }}>طبّق سعر وتكلفة الأول على الكل</Button>
                        )}
                    </div>
                )}

                {tried && problems.length > 0 && (
                    <ul className="list-disc space-y-0.5 ps-5 text-sm text-destructive">{problems.map(p => <li key={p}>{p}</li>)}</ul>
                )}
            </section>

            {/* Archive / delete */}
            {!isNew && (
                <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed p-4">
                    <p className="max-w-lg text-sm text-muted-foreground">
                        {archived ? "المنتج مؤرشف: مش ظاهر في صفحات الأوردرات ولا في الكتالوج، وتاريخه زي ما هو." :
                            "مش بتبيعه تاني؟ أرشفه: هيختفي من صفحات الأوردرات وتاريخه يفضل. المسح بس للمنتج اللي مالوش أوردرات."}
                    </p>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setArchive(!archived)}>
                            {archived ? <><ArchiveRestore className="h-4 w-4" />رجّعه</> : <><Archive className="h-4 w-4" />أرشف</>}
                        </Button>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-destructive"><Trash2 className="h-4 w-4" />امسح</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent dir="rtl">
                                <AlertDialogHeader className="text-start">
                                    <AlertDialogTitle>تمسح «{name}»؟</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        المسح مالوش رجوع. لو المنتج في أوردرات أو باندلز مش هيتمسح، وتقدر تأرشفه بدل كده.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>رجوع</AlertDialogCancel>
                                    <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">امسح</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </section>
            )}

            <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur md:sticky md:-mx-4 md:px-4">
                <div className="mx-auto flex max-w-4xl items-center justify-end gap-2 px-4 py-3 md:px-0">
                    <Button asChild variant="outline"><Link href="/products">إلغاء</Link></Button>
                    <Button onClick={save} disabled={saving} className="min-w-28">
                        {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{isNew ? "ضيف المنتج" : "احفظ"}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function VariantCard({ v, index, hasOptions, productName, tried, onChange, onRemove }: {
    v: Draft; index: number; hasOptions: boolean; productName: string; tried: boolean;
    onChange: (p: Partial<Draft>) => void; onRemove?: () => void;
}) {
    const m = margin(num(v.sale_price), num(v.cost_price));
    return (
        <div className={cn("space-y-3 rounded-xl border p-4", hasOptions && "bg-muted/20")}>
            {hasOptions && (
                <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1.5">
                        <Label className="text-xs">اسم الاختيار {index + 1}</Label>
                        <Input value={v.title} onChange={e => onChange({ title: e.target.value })} placeholder="مثلًا: بيج"
                            className={cn(tried && !v.title.trim() && "border-destructive")} />
                    </div>
                    {onRemove && (
                        <Button type="button" variant="ghost" size="icon" aria-label="شيل الاختيار" onClick={onRemove}>
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                    )}
                </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="space-y-1.5">
                    <Label className="text-xs">سعر البيع</Label>
                    <Input type="number" inputMode="decimal" min={0} value={v.sale_price} onChange={e => onChange({ sale_price: e.target.value })}
                        placeholder="0" className={cn(tried && v.sale_price === "" && "border-destructive")} />
                </div>
                <div className="space-y-1.5">
                    <Label className="text-xs">التكلفة</Label>
                    <Input type="number" inputMode="decimal" min={0} value={v.cost_price} onChange={e => onChange({ cost_price: e.target.value })} placeholder="0" />
                </div>
                <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs">الكود (SKU)</Label>
                    <div className="flex gap-1.5">
                        <Input dir="ltr" className="font-mono" value={v.sku} onChange={e => onChange({ sku: e.target.value })} placeholder="نفس الكود اللي على EasyOrders" />
                        <Button type="button" variant="outline" size="icon" title="اقترح كود" aria-label="اقترح كود"
                            onClick={() => onChange({ sku: suggestSku(productName, hasOptions ? v.title : undefined) })}>
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className={cn("text-xs", m === null ? "text-muted-foreground" : m < 0 ? "text-destructive" : m < 20 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
                    {m === null ? "اكتب السعر عشان يظهر الهامش" : `ربح القطعة ${egp(num(v.sale_price) - num(v.cost_price))} (${m}%)`}
                    {num(v.cost_price) === 0 && v.sale_price !== "" && " · التكلفة صفر"}
                </span>
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs">
                        <Switch checked={v.track_inventory} onCheckedChange={c => onChange({ track_inventory: c })} />
                        تتبّع المخزون
                    </label>
                    {v.track_inventory && (v.id ? (
                        <Link href={`/inventory?q=${encodeURIComponent(v.sku || productName)}`} className="text-xs text-primary underline-offset-4 hover:underline">
                            في المخزن {v.current_stock} · عدّله من المخزون
                        </Link>
                    ) : (
                        <span className="flex items-center gap-1.5 text-xs">
                            رصيد أول المدة
                            <Input type="number" min={0} value={v.stock_qty} onChange={e => onChange({ stock_qty: e.target.value })} placeholder="0" className="h-8 w-20" />
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------

type Payload = {
    id: string | null; name: string; description: string | null; archived: boolean;
    variants: { id: string | null; title: string; sku: string | null; sale_price: number; cost_price: number; track_inventory: boolean; stock_qty?: number }[];
};

/** Before 20261117 is run: the older writes, minus writing stale stock back. */
async function legacySave(businessId: string, p: Payload, original: ProductRow | null): Promise<string> {
    let id = p.id;
    if (!id) {
        const { data, error } = await supabase.from("products").insert({ business_id: businessId, name: p.name, description: p.description }).select("id").single();
        if (error) throw error;
        id = data.id as string;
    } else {
        const { error } = await supabase.from("products").update({ name: p.name, description: p.description }).eq("business_id", businessId).eq("id", id);
        if (error) throw error;
    }
    for (const v of p.variants) {
        const row = { title: v.title, sku: v.sku, sale_price: v.sale_price, cost_price: v.cost_price, track_inventory: v.track_inventory };
        if (v.id) {
            const { error } = await supabase.from("variants").update(row).eq("business_id", businessId).eq("id", v.id);
            if (error) throw error;
        } else {
            const { error } = await supabase.from("variants").insert({ ...row, business_id: businessId, product_id: id, stock_qty: v.track_inventory ? v.stock_qty || 0 : 0 });
            if (error) throw error;
        }
    }
    const keep = new Set(p.variants.map(v => v.id).filter(Boolean));
    const gone = (original?.variants || []).filter(v => !keep.has(v.id)).map(v => v.id);
    if (gone.length) {
        const { error } = await supabase.from("variants").delete().eq("business_id", businessId).in("id", gone);
        if (error) throw error;
    }
    return id!;
}

function diff(original: ProductRow | null, p: Payload) {
    if (!original) return [{ field: "Product", old_value: null, new_value: `${p.name} (${p.variants.length} options)` }];
    const out: { field: string; old_value: unknown; new_value: unknown }[] = [];
    if (original.name !== p.name) out.push({ field: "Name", old_value: original.name, new_value: p.name });
    if ((original.description || "") !== (p.description || "")) out.push({ field: "Description", old_value: original.description, new_value: p.description });
    for (const v of p.variants) {
        const o = original.variants.find(x => x.id === v.id);
        const label = v.title === "Default" ? "" : `${v.title}: `;
        if (!o) { out.push({ field: `${label}New option`, old_value: null, new_value: `${v.sale_price} EGP` }); continue; }
        if (Number(o.sale_price) !== v.sale_price) out.push({ field: `${label}Price`, old_value: o.sale_price, new_value: v.sale_price });
        if (Number(o.cost_price) !== v.cost_price) out.push({ field: `${label}Cost`, old_value: o.cost_price, new_value: v.cost_price });
        if ((o.sku || null) !== v.sku) out.push({ field: `${label}SKU`, old_value: o.sku, new_value: v.sku });
        if (o.title !== v.title) out.push({ field: "Option name", old_value: o.title, new_value: v.title });
    }
    for (const o of original.variants) if (o.archived !== true && !p.variants.some(v => v.id === o.id)) out.push({ field: "Removed option", old_value: o.title, new_value: null });
    return out.length ? out : [{ field: "Product", old_value: null, new_value: "Saved, no changes" }];
}
