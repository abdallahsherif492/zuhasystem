"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { activeCatalog } from "@/lib/products";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { orderLogName } from "@/lib/logs/order-log-name";
import { bundleLabel, expandBundle, loadBundles, type Bundle, type BundleVariant } from "@/lib/bundles";
import { itemsCost, type EditableItem, type EditableOrder, type OrderEditActions } from "@/components/orders/store-order-editor";
import { creditAdder } from "@/lib/orders/credit-adder";

/**
 * One order, editable with the same section as «New from stores»
 * (components/orders/store-order-editor.tsx), for the chats: it loads the
 * order, the catalogue and the bundles, and saves each change the way that
 * page does — the order's money re-derived from its lines, saves queued so a
 * slow one never lands after a newer one, nothing taken as saved when no row
 * changed.
 */

const ORDER_COLS = "id, status, customer_info, subtotal, total_amount, total_cost, shipping_cost, discount, payment_status, paid_amount, closed_by, notes, order_items(id, variant_id, quantity, price_at_sale, cost_at_sale, unmapped_name, unmapped_sku, bundle_variant_id, variants(title, sku, product_id, products(name)))";

export type ChatOrder = EditableOrder & { status: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
export function useOrderEditor(businessId: string | undefined, orderId: string | null, userEmail: string | null) {
    const [order, setOrder] = useState<ChatOrder | null>(null);
    const [products, setProducts] = useState<any[]>([]);
    const [bundles, setBundles] = useState<Bundle[]>([]);
    const [saveStatus, setSaveStatus] = useState("");
    const ref = useRef<ChatOrder | null>(null);
    const queue = useRef<Promise<unknown>>(Promise.resolve());
    const set = (o: ChatOrder) => { ref.current = o; setOrder(o); };

    useEffect(() => {
        if (!businessId || !orderId) return;
        let gone = false;
        (async () => {
            const [{ data: o }, { data: p }, b] = await Promise.all([
                supabase.from("orders").select(ORDER_COLS).eq("business_id", businessId).eq("id", orderId).maybeSingle(),
                supabase.from("products").select("*, variants(*)").eq("business_id", businessId).order("name"),
                loadBundles(supabase, businessId).then(r => r.bundles).catch(() => [] as Bundle[]),
            ]);
            if (gone) return;
            if (o) { ref.current = o as unknown as ChatOrder; setOrder(o as unknown as ChatOrder); }
            setProducts(activeCatalog(p || []));
            setBundles(b);
        })();
        return () => { gone = true; };
    }, [businessId, orderId]);

    const save = (write: () => Promise<void>) => {
        const next = queue.current.catch(() => {}).then(write);
        queue.current = next;
        return next;
    };
    const updateOrder = async (updates: Record<string, unknown>) => {
        const { data, error } = await supabase.from("orders").update(updates).eq("business_id", businessId!).eq("id", orderId!).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("لم يتم حفظ التعديل على الأوردر. حدّث الصفحة وجرّب تاني.");
    };
    const updateItem = async (itemId: string, updates: Record<string, unknown>) => {
        const { data, error } = await supabase.from("order_items").update(updates).eq("business_id", businessId!).eq("id", itemId).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("لم يتم حفظ المنتج على الأوردر.");
    };
    const log = (field: string, old_value: string | null, new_value: string) => {
        if (!businessId || !ref.current) return;
        logBusinessAction({
            businessId, userEmail: userEmail || "Staff", actionType: "edit", entityType: "order", entityId: ref.current.id,
            entityName: orderLogName(ref.current.id, ref.current.customer_info, "Platform Order"),
            changes: [{ field, old_value, new_value: `${new_value} (من الواتساب)` }],
        });
    };

    /** New lines, and the order's money from them. */
    const applyItemChange = async (mutate: (items: EditableItem[]) => EditableItem[]) => {
        const o = ref.current;
        if (!o) return;
        const items = mutate(o.order_items);
        const subtotal = items.reduce((sum, i) => sum + i.price_at_sale * i.quantity, 0);
        const total = Math.max(0, subtotal + Number(o.shipping_cost || 0) - (Number(o.discount) || 0));
        const cost = itemsCost(items);
        set({ ...o, order_items: items, subtotal, total_amount: total, total_cost: cost });
        try { await save(() => updateOrder({ subtotal, total_amount: total, total_cost: cost })); }
        catch { toast.error("ما اتحفظش، جرّب تاني."); }
    };

    const actions: OrderEditActions<ChatOrder> = {
        saveStatus,
        updateCustomerInfo: async (_o, field, value) => {
            const info = { ...(ref.current?.customer_info || {}), [field]: value };
            set({ ...ref.current!, customer_info: info });
            try { await save(() => updateOrder({ customer_info: info })); return true; }
            catch { toast.error("ما اتحفظش، جرّب تاني."); return false; }
        },
        handleAutoSaveNotes: async (o, text) => {
            setSaveStatus("جاري الحفظ...");
            const ok = await actions.updateCustomerInfo(o, "internal_workbench_notes", text);
            setSaveStatus(ok ? "تم الحفظ تلقائياً ✓" : "فشل الحفظ");
            if (ok) setTimeout(() => setSaveStatus(""), 2000);
        },
        updateOrderField: (o, field, value) => actions.updateOrderFields(o, { [field]: value }),
        updateOrderFields: async (_o, updates) => {
            set({ ...ref.current!, ...(updates as Partial<ChatOrder>) });
            try { await save(() => updateOrder(updates as Record<string, unknown>)); }
            catch { toast.error("ما اتحفظش، جرّب تاني."); }
        },
        updateOrderItem: async (_id, itemId, field, value) => {
            await applyItemChange(items => items.map(i => (i.id === itemId ? { ...i, [field]: value } : i)));
            try { await save(() => updateItem(itemId, { [field]: value })); }
            catch { toast.error("المنتج ما اتحفظش، جرّب تاني."); }
        },
        mapVariantToItem: async (_id, itemId, variantId) => {
            const prod = products.find(p => p.variants?.some((v: any) => v.id === variantId));
            const v = prod?.variants?.find((x: any) => x.id === variantId);
            if (!prod || !v) return;
            const old = ref.current?.order_items.find(i => i.id === itemId);
            await applyItemChange(items => items.map(i => (i.id === itemId ? {
                ...i, variant_id: v.id, price_at_sale: i.price_at_sale || v.sale_price, cost_at_sale: Number(v.cost_price) || 0,
                variants: { title: v.title, sku: v.sku, product_id: prod.id, products: { name: prod.name } },
            } : i)));
            try {
                await save(() => updateItem(itemId, { variant_id: v.id, cost_at_sale: Number(v.cost_price) || 0 }));
                log("Item Variant", old?.variants?.products?.name || old?.unmapped_name || "Unmapped Item", `${prod.name} (${v.title})`);
                toast.success("المنتج اتربط.");
            } catch { toast.error("ما اتربطش، جرّب تاني."); }
        },
        deleteItemFromOrder: async (_id, itemId) => {
            await applyItemChange(items => items.filter(i => i.id !== itemId));
            const { error } = await supabase.from("order_items").delete().eq("business_id", businessId!).eq("id", itemId);
            if (error) toast.error("ما اتشالش، جرّب تاني."); else toast.success("المنتج اتشال.");
        },
        addBundleToOrder: async (_id, bundle: Bundle, variant: BundleVariant, replace?: EditableItem) => {
            if (!businessId || !orderId) return;
            const lines = replace
                ? expandBundle(variant, Math.max(1, replace.quantity), replace.price_at_sale > 0 ? replace.price_at_sale : null)
                : expandBundle(variant, 1);
            const { data: inserted, error } = await supabase.from("order_items").insert(lines.map(l => ({
                business_id: businessId, order_id: orderId, variant_id: l.variant_id, quantity: l.quantity,
                price_at_sale: l.price_at_sale, cost_at_sale: l.cost_at_sale, bundle_variant_id: l.bundle_variant_id,
            }))).select("id");
            if (error || !inserted || inserted.length !== lines.length) { toast.error("الباندل ماتضافش، جرّب تاني."); return; }
            if (replace) await supabase.from("order_items").delete().eq("business_id", businessId).eq("id", replace.id);
            const added: EditableItem[] = lines.map((l, k) => ({
                id: inserted[k].id, variant_id: l.variant_id, quantity: l.quantity, price_at_sale: l.price_at_sale,
                cost_at_sale: l.cost_at_sale, bundle_variant_id: l.bundle_variant_id,
                variants: { title: l.variantTitle, sku: l.sku || "", product_id: "", products: { name: l.productName } },
            }));
            await applyItemChange(items => [...items.filter(i => i.id !== replace?.id), ...added]);
            log("Bundle", replace ? replace.unmapped_name || "Unmapped Item" : null, bundleLabel(bundle, variant));
            // Added, not a store line matched to its bundle: the order is theirs (commission).
            if (!replace) creditAdder(businessId, orderId, userEmail).catch(() => null);
            toast.success(`اتضاف ${bundleLabel(bundle, variant)}`);
        },
        addVariant: async (_o, prod, vari) => {
            const { data: row, error } = await supabase.from("order_items").insert({
                order_id: orderId, variant_id: vari.id, quantity: 1, price_at_sale: vari.sale_price,
                cost_at_sale: vari.cost_price || 0, business_id: businessId,
            }).select("id").single();
            if (error || !row) { toast.error("المنتج ماتضافش، جرّب تاني."); return false; }
            await applyItemChange(items => [...items, {
                id: row.id, variant_id: vari.id, quantity: 1, price_at_sale: vari.sale_price, cost_at_sale: vari.cost_price || 0,
                variants: { title: vari.title, sku: vari.sku || "", product_id: prod.id, products: { name: prod.name } },
            }]);
            log("Items", null, `+1 ${prod.name} (${vari.title})`);
            creditAdder(businessId, orderId!, userEmail).catch(() => null);
            return true;
        },
        currentSubtotal: () => ref.current?.subtotal,
    };

    /** Waits for every save to land (before closing). */
    const flush = useCallback(() => queue.current.catch(() => {}), []);
    return { order, products, bundles, actions, flush };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
