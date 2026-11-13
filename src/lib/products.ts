/**
 * Products and stock (20261117_products_inventory.sql).
 *
 * save_product saves a product with its variants in one go and never touches
 * existing stock; adjust_stock adds, reduces or sets stock against the number
 * in the database at that moment; delete_product deletes, or explains why not
 * and the product is archived instead. Before the migration the pages fall
 * back to the older writes (still never writing back stale stock).
 */

export const PRODUCTS_MIGRATION = "supabase/migrations/20261117_products_inventory.sql";

export interface VariantRow {
    id: string;
    product_id?: string;
    title: string;
    sku: string | null;
    sale_price: number;
    cost_price: number;
    track_inventory: boolean;
    stock_qty: number;
    archived?: boolean;
}

export interface ProductRow {
    id: string;
    name: string;
    description: string | null;
    created_at?: string;
    archived?: boolean;
    variants: VariantRow[];
}

/** Products and variants that should be offered on order pages. */
export function activeCatalog<T extends { archived?: boolean; variants?: { archived?: boolean }[] }>(products: T[]): T[] {
    return products
        .filter(p => p.archived !== true)
        .map(p => (p.variants ? { ...p, variants: p.variants.filter(v => v.archived !== true) } : p))
        .filter(p => !p.variants || p.variants.length > 0);
}

export const isMissingRpc = (e: { code?: string; message?: string } | null | undefined, name: string) =>
    !!e && (e.code === "PGRST202" || new RegExp(`${name}|schema cache`, "i").test(e.message || ""));

/** A readable message for a failed product or stock write. */
export function productError(e: { code?: string; message?: string; hint?: string } | null | undefined): string {
    const msg = e?.message || "";
    if (e?.hint && /[؀-ۿ]/.test(msg)) return msg; // our own Arabic messages
    if (/bundle_sku_is_product|product_sku_is_bundle|already a bundle/i.test(msg)) return "الكود ده مستخدم لباندل. اختار كود تاني.";
    if (e?.code === "23503") return "مينفعش يتمسح لأنه مستخدم في أوردرات أو باندلز. أرشفه بدل كده.";
    if (e?.code === "23505") return "الكود (SKU) ده مستخدم قبل كده.";
    if (/row-level security|permission/i.test(msg)) return "مش مسموحلك تعمل ده.";
    return "ماتحفظش، جرّب تاني.";
}

export const margin = (price: number, cost: number) => (price > 0 ? Math.round(((price - cost) / price) * 100) : null);

export const egp = (v: number) =>
    `⁦${Math.round(v) < 0 ? "−" : ""}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Math.abs(v))}⁩ ج.م`;

/** A short SKU suggestion from the product name. */
export function suggestSku(name: string, title?: string): string {
    const letters = (s: string) => s.normalize("NFKD").replace(/[^A-Za-z0-9 ]/g, "").trim().split(/\s+/).filter(Boolean);
    const base = letters(name).map(w => w[0]).join("").toUpperCase().slice(0, 4) || "P";
    const opt = title && title !== "Default" ? letters(title).map(w => w.slice(0, 2)).join("").toUpperCase().slice(0, 4) : "";
    const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
    return [base, opt, rand].filter(Boolean).join("-");
}
