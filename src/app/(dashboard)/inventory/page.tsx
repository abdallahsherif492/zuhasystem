"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Boxes, History, Loader2, Minus, Plus, Search, SlidersHorizontal } from "lucide-react";
import { supabase, fetchAll } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { cn, normalizeSearchText } from "@/lib/utils";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { egp, isMissingRpc, productError } from "@/lib/products";

/**
 * Stock: what is on the shelf, what it is worth, and changing it — add,
 * reduce, or set to a count — through adjust_stock (20261117), which works
 * against the number in the database at that moment and records the move.
 */

interface Item {
    id: string;
    title: string;
    sku: string | null;
    stock_qty: number;
    cost_price: number;
    sale_price: number;
    track_inventory: boolean;
    archived?: boolean;
    product: { id: string; name: string; archived?: boolean } | null;
}
interface Move {
    id: string;
    variant_id: string;
    quantity_change: number;
    transaction_type: string;
    note: string | null;
    created_at: string;
}

type Filter = "all" | "low" | "out" | "untracked";
type Mode = "add" | "reduce" | "set";
const LOW = 5;

const MOVE_LABEL: Record<string, string> = {
    sale: "اتشحن في أوردر", return: "رجع من أوردر", restock: "إضافة", manual_deduction: "خصم يدوي",
    manual_set: "جرد", manual_adjustment: "تعديل", damage: "تالف", initial: "رصيد أول المدة",
};
const REASONS: Record<Mode, string[]> = {
    add: ["مشتريات من مورد", "مرتجع رجع المخزن", "تصحيح جرد", "أخرى"],
    reduce: ["تالف", "جرد ناقص", "عينة أو هدية", "أخرى"],
    set: ["جرد"],
};

function InventoryContent() {
    const { activeBusiness, currentUser } = useBusiness();
    const businessId = activeBusiness?.id;
    const params = useSearchParams();
    const [items, setItems] = useState<{ key: string; rows: Item[] } | null>(null);
    const [moves, setMoves] = useState<Move[]>([]);
    const [q, setQ] = useState(params.get("q") || "");
    const [filter, setFilter] = useState<Filter>("all");
    const [sort, setSort] = useState<"stock" | "value" | "name">("stock");
    const [tab, setTab] = useState<"stock" | "history">("stock");
    const [adjusting, setAdjusting] = useState<Item | null>(null);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        Promise.all([
            fetchAll<Item>((a, b) => supabase.from("variants")
                .select("*, product:products!inner(id, name, business_id, archived)")
                .eq("products.business_id", businessId).range(a, b))
                .catch(() => fetchAll<Item>((a, b) => supabase.from("variants")
                    .select("*, product:products!inner(id, name, business_id)")
                    .eq("products.business_id", businessId).range(a, b))),
            supabase.from("inventory_transactions").select("id, variant_id, quantity_change, transaction_type, note, created_at")
                .eq("business_id", businessId).order("created_at", { ascending: false }).limit(200),
        ]).then(([rows, m]) => {
            if (gone) return;
            setItems({ key: businessId, rows: rows.filter(r => r.archived !== true && r.product?.archived !== true) });
            setMoves((m.data || []) as Move[]);
        });
        return () => { gone = true; };
    }, [businessId, reload]);

    const byId = useMemo(() => new Map((items?.rows || []).map(i => [i.id, i])), [items]);
    const label = (i: Item | undefined) => i ? `${i.product?.name || "منتج"}${i.title && i.title !== "Default" ? ` — ${i.title}` : ""}` : "منتج اتمسح";

    const view = useMemo(() => {
        const rows = items?.rows || [];
        const tracked = rows.filter(r => r.track_inventory);
        const kpi = {
            value: tracked.reduce((s, r) => s + Math.max(0, Number(r.stock_qty) || 0) * (Number(r.cost_price) || 0), 0),
            units: tracked.reduce((s, r) => s + Math.max(0, Number(r.stock_qty) || 0), 0),
            low: tracked.filter(r => r.stock_qty > 0 && r.stock_qty <= LOW).length,
            out: tracked.filter(r => r.stock_qty <= 0).length,
            untracked: rows.length - tracked.length,
        };
        const needle = normalizeSearchText(q);
        let list = rows.filter(r =>
            filter === "low" ? r.track_inventory && r.stock_qty > 0 && r.stock_qty <= LOW
                : filter === "out" ? r.track_inventory && r.stock_qty <= 0
                : filter === "untracked" ? !r.track_inventory
                : true);
        if (needle) list = list.filter(r => normalizeSearchText(`${r.product?.name || ""} ${r.title} ${r.sku || ""}`).includes(needle));
        list = [...list].sort((a, b) =>
            sort === "value" ? b.stock_qty * b.cost_price - a.stock_qty * a.cost_price
                : sort === "name" ? label(a).localeCompare(label(b), "ar")
                : (a.track_inventory === b.track_inventory ? a.stock_qty - b.stock_qty : a.track_inventory ? -1 : 1));
        return { list, kpi };
    }, [items, q, filter, sort]);

    const toggleTracking = async (item: Item) => {
        const next = !item.track_inventory;
        const { error } = await supabase.from("variants").update({ track_inventory: next }).eq("id", item.id);
        if (error) { toast.error(productError(error)); return; }
        setItems(prev => prev ? { ...prev, rows: prev.rows.map(r => (r.id === item.id ? { ...r, track_inventory: next } : r)) } : prev);
        logBusinessAction({ businessId: businessId!, userEmail: currentUser?.email || "Staff", actionType: "edit", entityType: "inventory", entityId: item.id, entityName: label(item), changes: [{ field: "Track inventory", old_value: !next, new_value: next }] });
        toast.success(next ? "بقى متتبّع: هيتخصم مع الأوردرات." : "مش متتبّع: مش هيتخصم مع الأوردرات.");
    };

    const loading = !items || items.key !== businessId;

    return (
        <div className="mx-auto max-w-6xl space-y-5" dir="rtl">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <h1 className="text-2xl font-bold">المخزون</h1>
                <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm"><Link href="/inventory/damages">التوالف</Link></Button>
                    <Button asChild variant="outline" size="sm"><Link href="/products">المنتجات</Link></Button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
                <Kpi label="قيمة المخزون (بالتكلفة)" value={loading ? "…" : egp(view.kpi.value)} />
                <Kpi label="قطع في المخزن" value={loading ? "…" : new Intl.NumberFormat("en-US").format(view.kpi.units)} />
                <Kpi label="قرب يخلص" value={loading ? "…" : String(view.kpi.low)} tone={view.kpi.low ? "text-amber-700 dark:text-amber-400" : ""} onClick={() => { setFilter("low"); setTab("stock"); }} />
                <Kpi label="خلص" value={loading ? "…" : String(view.kpi.out)} tone={view.kpi.out ? "text-rose-700 dark:text-rose-400" : ""} onClick={() => { setFilter("out"); setTab("stock"); }} />
            </div>

            <div className="flex gap-1 rounded-lg bg-muted p-1 sm:w-fit" role="tablist">
                {([["stock", "المخزون", Boxes], ["history", "حركة المخزون", History]] as const).map(([key, text, Icon]) => (
                    <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                        className={cn("flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-4 py-1.5 text-sm transition-colors", tab === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                        <Icon className="h-4 w-4" />{text}
                    </button>
                ))}
            </div>

            {tab === "stock" ? (
                <>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <div className="relative flex-1">
                            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input className="ps-9" placeholder="دوّر بالاسم أو الكود…" value={q} onChange={e => setQ(e.target.value)} />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {([["all", "الكل"], ["low", "قرب يخلص"], ["out", "خلص"], ["untracked", `مش متتبّع (${view.kpi.untracked})`]] as [Filter, string][]).map(([key, text]) => (
                                <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
                                    className={cn("rounded-full border px-3 py-1 text-sm transition-colors", filter === key ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>{text}</button>
                            ))}
                            <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="الترتيب">
                                <option value="stock">الأقل الأول</option>
                                <option value="value">القيمة الأعلى</option>
                                <option value="name">الاسم</option>
                            </select>
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border bg-card">
                        {loading ? (
                            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
                        ) : view.list.length === 0 ? (
                            <p className="p-10 text-center text-sm text-muted-foreground">مفيش منتجات بالبحث أو الفلتر ده.</p>
                        ) : (
                            <ul className="divide-y">
                                {view.list.map(i => {
                                    const qty = Number(i.stock_qty) || 0;
                                    return (
                                        <li key={i.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
                                            <div className="min-w-0 sm:flex-1">
                                                <Link href={i.product ? `/products/${i.product.id}` : "/products"} className="font-medium hover:underline">{label(i)}</Link>
                                                <p className="text-xs text-muted-foreground">
                                                    <span className="font-mono" dir="ltr">{i.sku || "بدون كود"}</span> · تكلفة {egp(Number(i.cost_price) || 0)}
                                                    {i.track_inventory && qty > 0 && <> · قيمة {egp(qty * (Number(i.cost_price) || 0))}</>}
                                                </p>
                                            </div>
                                            <div className="flex items-center justify-between gap-3 sm:justify-end">
                                            <div className="text-end sm:w-24">
                                                {i.track_inventory ? (
                                                    <span className={cn("text-xl font-bold tabular-nums", qty <= 0 ? "text-rose-700 dark:text-rose-400" : qty <= LOW ? "text-amber-700 dark:text-amber-400" : "")}>{qty}</span>
                                                ) : <span className="text-xs text-muted-foreground">مش متتبّع</span>}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Switch checked={i.track_inventory} onCheckedChange={() => toggleTracking(i)} aria-label="تتبّع المخزون" />
                                                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdjusting(i)} disabled={!i.track_inventory}>
                                                    <SlidersHorizontal className="h-3.5 w-3.5" />عدّل
                                                </Button>
                                            </div>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </>
            ) : (
                <div className="overflow-hidden rounded-xl border bg-card">
                    {moves.length === 0 ? (
                        <p className="p-10 text-center text-sm text-muted-foreground">مفيش حركة متسجلة.</p>
                    ) : (
                        <ul className="divide-y">
                            {moves.map(m => (
                                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                                    <span className={cn("w-14 shrink-0 text-end font-semibold tabular-nums", m.quantity_change < 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400")} dir="ltr">
                                        {m.quantity_change > 0 ? "+" : ""}{m.quantity_change}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate">{label(byId.get(m.variant_id))}</p>
                                        <p className="truncate text-xs text-muted-foreground">{MOVE_LABEL[m.transaction_type] || m.transaction_type}{m.note ? ` · ${m.note}` : ""}</p>
                                    </div>
                                    <span className="shrink-0 text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" })}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {adjusting && (
                <AdjustDialog item={adjusting} title={label(adjusting)} onClose={() => setAdjusting(null)}
                    onDone={() => { setAdjusting(null); setReload(n => n + 1); }} businessId={businessId!} userEmail={currentUser?.email || "Staff"} />
            )}
        </div>
    );
}

function Kpi({ label, value, tone, onClick }: { label: string; value: string; tone?: string; onClick?: () => void }) {
    const Tag = onClick ? "button" : "div";
    return (
        <Tag onClick={onClick} className={cn("bg-card p-4 text-start", onClick && "transition-colors hover:bg-muted/50")}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={cn("mt-1 text-xl font-semibold tabular-nums", tone)}>{value}</p>
        </Tag>
    );
}

function AdjustDialog({ item, title, onClose, onDone, businessId, userEmail }: {
    item: Item; title: string; onClose: () => void; onDone: () => void; businessId: string; userEmail: string;
}) {
    const [mode, setMode] = useState<Mode>("add");
    const [qty, setQty] = useState("");
    const [cost, setCost] = useState(String(item.cost_price ?? ""));
    const [reason, setReason] = useState(REASONS.add[0]);
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);
    const current = Number(item.stock_qty) || 0;
    const n = qty === "" ? NaN : Math.floor(Number(qty));
    const next = Number.isFinite(n) ? (mode === "add" ? current + n : mode === "reduce" ? current - n : n) : null;
    const valid = Number.isFinite(n) && n >= 0 && (mode === "set" || n > 0) && next !== current;

    const pick = (m: Mode) => { setMode(m); setReason(REASONS[m][0]); };

    const save = useCallback(async () => {
        if (!valid) return;
        setSaving(true);
        const costNum = cost === "" ? null : Number(cost);
        const costArg = mode !== "reduce" && costNum !== null && costNum !== Number(item.cost_price) ? costNum : null;
        let result: { old: number; new: number } | null = null;
        const { data, error } = await supabase.rpc("adjust_stock", { p_variant_id: item.id, p_mode: mode, p_qty: n, p_cost: costArg, p_reason: reason, p_note: note || null });
        if (error && isMissingRpc(error, "adjust_stock")) {
            // Before 20261117: read the number now, write the new one, record it.
            const { data: fresh } = await supabase.from("variants").select("stock_qty").eq("id", item.id).single();
            const old = Number(fresh?.stock_qty) || 0;
            const target = mode === "add" ? old + n : mode === "reduce" ? old - n : n;
            const { error: e2 } = await supabase.from("variants").update({ stock_qty: target, ...(costArg !== null ? { cost_price: costArg } : {}) }).eq("id", item.id);
            if (e2) { setSaving(false); toast.error(productError(e2)); return; }
            await supabase.from("inventory_transactions").insert({ business_id: businessId, variant_id: item.id, quantity_change: target - old, transaction_type: mode === "add" ? "restock" : mode === "reduce" ? "manual_deduction" : "manual_set", note: [reason, note].filter(Boolean).join(" — ") });
            result = { old, new: target };
        } else if (error) {
            setSaving(false); toast.error(productError(error)); return;
        } else result = data as { old: number; new: number };
        setSaving(false);
        logBusinessAction({
            businessId, userEmail, actionType: "stock_adjust", entityType: "inventory", entityId: item.id, entityName: title,
            changes: [
                { field: "Stock", old_value: result.old, new_value: result.new },
                ...(costArg !== null ? [{ field: "Unit cost", old_value: `${item.cost_price} EGP`, new_value: `${costArg} EGP` }] : []),
            ],
            metadata: { adjustment: mode, reason, note: note || null },
        });
        toast.success(`${title}: ${result.old} ← ${result.new}`);
        onDone();
    }, [valid, cost, mode, item, n, reason, note, businessId, userEmail, title, onDone]);

    return (
        <Dialog open onOpenChange={o => !o && onClose()}>
            <DialogContent className="sm:max-w-md" dir="rtl">
                <DialogHeader className="pr-6 text-start">
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>في المخزن دلوقتي <span className="font-semibold text-foreground">{current}</span></DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="نوع التعديل">
                        {([["add", "زوّد", Plus], ["reduce", "نقّص", Minus], ["set", "حط رقم (جرد)", SlidersHorizontal]] as const).map(([m, text, Icon]) => (
                            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => pick(m)}
                                className={cn("flex items-center justify-center gap-1 rounded-md px-2 py-2 text-sm transition-colors", mode === m ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}>
                                <Icon className="h-3.5 w-3.5" />{text}
                            </button>
                        ))}
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="adj-qty">{mode === "set" ? "العدد الفعلي في المخزن" : "الكمية"}</Label>
                        <Input id="adj-qty" type="number" inputMode="numeric" min={0} autoFocus value={qty} onChange={e => setQty(e.target.value)} className="h-12 text-xl font-semibold" placeholder="0" />
                        {next !== null && (
                            <p className={cn("text-sm", next < 0 ? "text-destructive" : "text-muted-foreground")}>
                                هيبقى <span className="font-semibold text-foreground tabular-nums">{next}</span> بدل {current}
                                {next < 0 && " (بالسالب)"}
                            </p>
                        )}
                    </div>
                    {mode !== "reduce" && (
                        <div className="space-y-1.5">
                            <Label htmlFor="adj-cost">تكلفة القطعة</Label>
                            <Input id="adj-cost" type="number" inputMode="decimal" min={0} value={cost} onChange={e => setCost(e.target.value)} />
                            <p className="text-xs text-muted-foreground">لو اتغيرت، هتتحدّث للمنتج كله وقيمة المخزون هتتحسب بيها.</p>
                        </div>
                    )}
                    <div className="space-y-1.5">
                        <Label>السبب</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {REASONS[mode].map(r => (
                                <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r}
                                    className={cn("rounded-full border px-3 py-1 text-sm", reason === r ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>{r}</button>
                            ))}
                        </div>
                        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="ملاحظة (اختياري): اسم المورد، رقم الفاتورة..." />
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:justify-between">
                    <Button variant="ghost" onClick={onClose}>رجوع</Button>
                    <Button onClick={save} disabled={!valid || saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}احفظ</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function InventoryPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <InventoryContent />
        </Suspense>
    );
}
