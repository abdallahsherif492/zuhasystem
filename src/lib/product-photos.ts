import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Product photos from the EasyOrders store, saved on our products
 * (products.image_url) for the WhatsApp confirmation and the chats.
 *
 * EasyOrders' product list has no SKUs, so each product is read on its own
 * (it carries its SKU and its variants' SKUs) and matched to our variants by
 * SKU, the same way the order webhook matches items. The main picture
 * (`thumb`, read from the product itself: the product list cuts its link
 * short, which then answers 403) comes first.
 */

const API = "https://api.easy-orders.net/api/v1/external-apps";
const norm = (s: unknown) => String(s ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

interface EoProduct {
    id: string; name: string; sku?: string | null; thumb?: string | null; images?: string[] | null;
    variants?: { sku?: string | null; taager_code?: string | null }[] | null;
}

/** The first link that opens as an image. */
export async function firstWorkingImage(urls: (string | null | undefined)[]): Promise<string | null> {
    for (const url of urls) {
        if (typeof url !== "string" || !/^https:\/\//.test(url)) continue;
        try {
            const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
            if (res.ok && /^image\//.test(res.headers.get("content-type") || "")) return url;
        } catch { /* the next one */ }
    }
    return null;
}

/**
 * The product's main picture first (`thumb`, the one the store shows), then
 * its other pictures — those are often details (a measure, a close-up) that
 * confuse a customer who sees them alone.
 */
export const productPhotoCandidates = (p: { images?: unknown; thumb?: unknown } | null | undefined) =>
    [p?.thumb as string | undefined, ...(Array.isArray(p?.images) ? p!.images as string[] : [])];

/** One read, retried when EasyOrders says to slow down (429) or hiccups (5xx). */
async function eo<T>(path: string, key: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${API}/${path}`, { headers: { "Api-Key": key }, signal: AbortSignal.timeout(20000) });
        if (res.ok) return res.json() as Promise<T>;
        if (attempt >= 5 || !(res.status === 429 || res.status >= 500)) throw new Error(`EasyOrders ${res.status}`);
        const wait = Number(res.headers.get("retry-after")) * 1000 || 1500 * 2 ** attempt;
        await new Promise(r => setTimeout(r, Math.min(wait, 20000)));
    }
}

export interface PhotoSyncResult { products: number; matched: number; saved: number; unmatched: string[]; failed: number }

export async function syncProductPhotos(businessId: string, opts: { overwrite?: boolean; db?: SupabaseClient } = {}): Promise<PhotoSyncResult> {
    const db = opts.db || createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data: b } = await db.from("businesses").select("theme_config").eq("id", businessId).single();
    const key = b?.theme_config?.integrations?.platforms?.easyorders?.apiKey || b?.theme_config?.easyorders_api_key;
    if (!key) throw new Error("مفتاح ايزي اوردرز مش متسجل في إعدادات الربط.");

    // Our variants by SKU → their product, and which products already have a photo.
    const { data: variants } = await db.from("variants").select("sku, product_id, products!inner(business_id, image_url)")
        .eq("products.business_id", businessId);
    const bySku = new Map<string, { product_id: string; has: boolean }>();
    for (const v of (variants || []) as unknown as { sku: string | null; product_id: string; products: { image_url: string | null } }[]) {
        if (v.sku) bySku.set(norm(v.sku), { product_id: v.product_id, has: !!v.products?.image_url });
    }

    // Every product in the store.
    const list: { id: string; name: string }[] = [];
    for (let page = 1; page < 100; page++) {
        const r = await eo<{ data: { id: string; name: string }[]; totalPages: number }>(`products?page=${page}&limit=50`, key);
        list.push(...(r.data || []));
        if (page >= (r.totalPages || 1)) break;
    }

    const result: PhotoSyncResult = { products: list.length, matched: 0, saved: 0, unmatched: [], failed: 0 };
    const done = new Set<string>();
    const queue = list.slice();
    const worker = async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
            let p: EoProduct;
            try { p = await eo<EoProduct>(`products/${item.id}`, key); } catch { result.failed++; continue; }
            const skus = [p.sku, ...(p.variants || []).flatMap(v => [v.sku, v.taager_code])].map(norm).filter(Boolean);
            const targets = [...new Set(skus.map(s => bySku.get(s)).filter(Boolean).map(t => t!))]
                .filter(t => !done.has(t.product_id));
            if (!skus.some(s => bySku.has(s))) { result.unmatched.push(p.name?.trim()); continue; }
            result.matched++;
            const todo = targets.filter(t => opts.overwrite || !t.has);
            if (!todo.length) continue;
            const url = await firstWorkingImage(productPhotoCandidates(p));
            if (!url) continue;
            for (const t of todo) {
                if (done.has(t.product_id)) continue;
                done.add(t.product_id);
                const { error } = await db.from("products").update({ image_url: url }).eq("id", t.product_id).eq("business_id", businessId);
                if (!error) result.saved++;
            }
        }
    };
    await Promise.all(Array.from({ length: 2 }, worker));
    return result;
}
