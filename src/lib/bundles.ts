/**
 * Bundles (20261108_bundles.sql): products sold together, each at a price the
 * bundle sets. On an order a bundle is written as its products, each line
 * remembering the bundle it came from (order_items.bundle_variant_id), so
 * stock, cost and every report keep reading real products.
 *
 * Shared by the bundle editor, the three order pages and the EasyOrders
 * webhook, so it takes the Supabase client it should use.
 */

export const BUNDLES_MIGRATION = "supabase/migrations/20261108_bundles.sql";

export interface BundleProduct {
    id: string;
    title: string;
    sku: string | null;
    sale_price: number;
    cost_price: number;
    stock_qty: number;
    track_inventory: boolean;
    product: { name: string } | null;
}

export interface BundleItem {
    id?: string;
    variant_id: string;
    quantity: number;
    /** One piece, inside the bundle. */
    price: number;
    sort?: number;
    variant: BundleProduct | null;
}

export interface BundleVariant {
    id: string;
    bundle_id?: string;
    title: string;
    sku: string | null;
    sort?: number;
    items: BundleItem[];
}

export interface Bundle {
    id: string;
    name: string;
    description: string | null;
    active: boolean;
    created_at?: string;
    variants: BundleVariant[];
}

export const BUNDLE_SELECT =
    "id, name, description, active, created_at, " +
    "variants:bundle_variants(id, bundle_id, title, sku, sort, " +
    "items:bundle_variant_items(id, variant_id, quantity, price, sort, " +
    "variant:variants(id, title, sku, sale_price, cost_price, stock_qty, track_inventory, product:products(name))))";

/** The webhook's rule for comparing codes: letters and digits, any case. */
export const skuKey = (sku: unknown) => String(sku ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const bySort = <T extends { sort?: number }>(a: T, b: T) => (a.sort ?? 0) - (b.sort ?? 0);

function tidy(raw: Bundle): Bundle {
    return {
        ...raw,
        variants: [...(raw.variants || [])].sort(bySort).map(v => ({
            ...v,
            items: [...(v.items || [])].sort(bySort).map(i => ({
                ...i,
                quantity: Number(i.quantity) || 1,
                price: Number(i.price) || 0,
            })),
        })),
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the browser and service clients differ in type
type Client = { from: (table: string) => any };

/**
 * The business's bundles, newest first. `missing` is true when the migration
 * has not been run yet (then there are none, and the pages carry on as before).
 */
export async function loadBundles(client: Client, businessId: string): Promise<{ bundles: Bundle[]; missing: boolean; error?: string }> {
    const { data, error } = await client
        .from("bundles")
        .select(BUNDLE_SELECT)
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
    if (error) {
        const missing = ["42P01", "PGRST205", "PGRST200"].includes(error.code) || /bundle/i.test(error.message || "") && /schema cache|does not exist/i.test(error.message || "");
        return { bundles: [], missing, error: missing ? undefined : error.message };
    }
    return { bundles: ((data || []) as Bundle[]).map(tidy), missing: false };
}

export const bundleLabel = (bundle: Pick<Bundle, "name">, variant: Pick<BundleVariant, "title">) =>
    variant.title && variant.title !== "Default" ? `${bundle.name} - ${variant.title}` : bundle.name;

/** What the customer pays for one bundle. */
export const bundlePrice = (v: Pick<BundleVariant, "items">) =>
    v.items.reduce((s, i) => s + i.price * i.quantity, 0);

/** What one bundle costs us. */
export const bundleCost = (v: Pick<BundleVariant, "items">) =>
    v.items.reduce((s, i) => s + (Number(i.variant?.cost_price) || 0) * i.quantity, 0);

/** Its products at their own prices, to show the saving. */
export const bundleListPrice = (v: Pick<BundleVariant, "items">) =>
    v.items.reduce((s, i) => s + (Number(i.variant?.sale_price) || 0) * i.quantity, 0);

/**
 * How many whole bundles the shelf can make. null when none of its products
 * is stock-tracked.
 */
export function bundleStock(v: Pick<BundleVariant, "items">): number | null {
    let min: number | null = null;
    for (const i of v.items) {
        if (!i.variant?.track_inventory) continue;
        const can = Math.floor((Number(i.variant.stock_qty) || 0) / i.quantity);
        min = min === null ? can : Math.min(min, can);
    }
    return min === null ? null : Math.max(0, min);
}

export interface BundleLine {
    variant_id: string;
    quantity: number;
    price_at_sale: number;
    cost_at_sale: number;
    bundle_variant_id: string;
    productName: string;
    variantTitle: string;
    sku: string | null;
    sale_price: number;
    stock_qty: number;
    track_inventory: boolean;
}

/**
 * `count` bundles as order lines. With `unitPrice` (what one bundle actually
 * sold for, e.g. EasyOrders' price or one the moderator typed), each product's
 * price is scaled so the lines add up to it; otherwise the bundle's own prices.
 */
export function expandBundle(variant: BundleVariant, count: number, unitPrice?: number | null): BundleLine[] {
    const base = bundlePrice(variant);
    const target = unitPrice !== undefined && unitPrice !== null && Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : base;
    const prices = variant.items.map(i => {
        if (Math.abs(target - base) < 0.005) return i.price;
        if (base > 0) return Math.round(i.price * (target / base) * 100) / 100;
        // A bundle priced at 0 sold for something: spread it by piece.
        const pieces = variant.items.reduce((s, x) => s + x.quantity, 0) || 1;
        return Math.round((target / pieces) * 100) / 100;
    });
    // Rounding leaves a few piastres; they go on a single-piece line so the
    // bundle still totals exactly what it sold for.
    const drift = Math.round((target - prices.reduce((s, p, k) => s + p * variant.items[k].quantity, 0)) * 100) / 100;
    if (Math.abs(drift) >= 0.01) {
        const k = variant.items.findIndex(i => i.quantity === 1);
        if (k >= 0) prices[k] = Math.round((prices[k] + drift) * 100) / 100;
    }
    return variant.items.map((i, k) => ({
        variant_id: i.variant_id,
        quantity: i.quantity * count,
        price_at_sale: prices[k],
        cost_at_sale: Number(i.variant?.cost_price) || 0,
        bundle_variant_id: variant.id,
        productName: i.variant?.product?.name || "منتج",
        variantTitle: i.variant?.title || "Default",
        sku: i.variant?.sku ?? null,
        sale_price: Number(i.variant?.sale_price) || 0,
        stock_qty: Number(i.variant?.stock_qty) || 0,
        track_inventory: !!i.variant?.track_inventory,
    }));
}

/** Every bundle variant by id, with its bundle, for labelling order lines. */
export function bundleVariantIndex(bundles: Bundle[]) {
    const map = new Map<string, { bundle: Bundle; variant: BundleVariant; label: string }>();
    for (const b of bundles) for (const v of b.variants) map.set(v.id, { bundle: b, variant: v, label: bundleLabel(b, v) });
    return map;
}

/** Bundle variants by SKU key, for EasyOrders and unmapped lines. */
export function bundleSkuIndex(bundles: Bundle[]) {
    const map = new Map<string, { bundle: Bundle; variant: BundleVariant }>();
    for (const b of bundles) for (const v of b.variants) {
        const k = skuKey(v.sku);
        if (k) map.set(k, { bundle: b, variant: v });
    }
    return map;
}

/** Readable message for a failed save_bundle. */
export function bundleSaveError(e: { message?: string; hint?: string; code?: string } | null | undefined): string {
    const hint = e?.hint || "";
    const msg = e?.message || "";
    if (hint === "bundle_sku_is_product") return `الكود ${msg.match(/SKU (.+?) is/)?.[1] ?? ""} مستخدم لمنتج. كل باندل لازم يبقى ليه كود مش متكرر.`;
    if (e?.code === "23505" || /bundle_variants_sku_unique/.test(msg)) return "فيه باندل تاني بنفس الكود (SKU). غيّر الكود.";
    if (hint === "bundle_no_name") return "اكتب اسم الباندل.";
    if (hint === "bundle_no_variant") return "الباندل محتاج نوع واحد على الأقل.";
    if (hint === "bundle_variant_empty") return "كل نوع في الباندل لازم يبقى فيه منتج واحد على الأقل.";
    if (hint === "bundle_not_found") return "الباندل ده اتمسح أو اتغيّر من مكان تاني. افتح الصفحة تاني.";
    if (/save_bundle|schema cache/i.test(msg)) return `شغّل ملف ${BUNDLES_MIGRATION} في Supabase الأول.`;
    return "ماتحفظش، جرّب تاني.";
}
