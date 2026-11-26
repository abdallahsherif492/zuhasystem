import { createHash } from "crypto";
import { admin, uploadImageBytes, type WaAccount } from "@/lib/whatsapp/server";
import { productCollage } from "@/lib/whatsapp/collage";

/**
 * Meta media ids for pictures sent in templates, kept in
 * whatsapp_media_cache (20261203) and used again for 20 days (Meta keeps an
 * upload for 30): a product's picture, or several side by side. Without it
 * every message downloaded, combined and uploaded them again — seconds of
 * paid function time each. Before the migration it simply uploads each time.
 */

const FRESH_MS = 20 * 86_400_000;
const memory = new Map<string, { id: string; at: number }>();

async function remembered(account: WaAccount, key: string): Promise<string | null> {
    const k = `${account.phone_number_id}:${key}`;
    const hit = memory.get(k);
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.id;
    const { data } = await admin.from("whatsapp_media_cache").select("media_id, uploaded_at")
        .eq("phone_number_id", account.phone_number_id).eq("key", key).maybeSingle();
    if (data && Date.now() - Date.parse(data.uploaded_at) < FRESH_MS) {
        memory.set(k, { id: data.media_id, at: Date.parse(data.uploaded_at) });
        return data.media_id;
    }
    return null;
}

async function remember(account: WaAccount, key: string, id: string) {
    memory.set(`${account.phone_number_id}:${key}`, { id, at: Date.now() });
    await admin.from("whatsapp_media_cache").upsert({ phone_number_id: account.phone_number_id, key, media_id: id, uploaded_at: new Date().toISOString() })
        .then(() => undefined, () => undefined);
}

/** One picture by its link. */
export async function cachedImageId(account: WaAccount, url: string): Promise<string | null> {
    const known = await remembered(account, url);
    if (known) return known;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return null;
        const id = await uploadImageBytes(account, new Uint8Array(await res.arrayBuffer()));
        if (id) await remember(account, url, id);
        return id;
    } catch {
        return null;
    }
}

/** Several products' pictures side by side (up to four), as one; one picture alone when only one. */
export async function cachedCollageId(account: WaAccount, urls: string[]): Promise<string | null> {
    const list = [...new Set(urls.filter(Boolean))].slice(0, 4);
    if (list.length < 2) return list[0] ? cachedImageId(account, list[0]) : null;
    const key = `collage:${createHash("sha1").update(list.join("|")).digest("hex")}`;
    const known = await remembered(account, key);
    if (known) return known;
    const bytes = await productCollage(list);
    if (!bytes) return cachedImageId(account, list[0]);
    const id = await uploadImageBytes(account, bytes);
    if (id) await remember(account, key, id);
    return id;
}

/**
 * The daily warm-up: products with a picture whose upload is missing or due
 * (new products, or 20 days old) are uploaded ahead, a few a run, so their
 * first confirmation or offer goes out without the wait.
 */
export async function warmProductPictures(limit = 25): Promise<number> {
    const { data: accounts } = await admin.from("whatsapp_accounts").select("business_id");
    let done = 0;
    const { accountOf } = await import("@/lib/whatsapp/server");
    for (const businessId of new Set((accounts || []).map(a => a.business_id as string))) {
        const account = await accountOf(businessId);
        if (!account) continue;
        const { data: products } = await admin.from("products").select("image_url").eq("business_id", businessId)
            .not("image_url", "is", null).or("archived.is.null,archived.eq.false").limit(1000);
        const urls = [...new Set((products || []).map(p => p.image_url as string))];
        const { data: cached } = await admin.from("whatsapp_media_cache").select("key, uploaded_at").eq("phone_number_id", account.phone_number_id).in("key", urls.slice(0, 1000));
        const fresh = new Set((cached || []).filter(c => Date.now() - Date.parse(c.uploaded_at) < FRESH_MS - 86_400_000).map(c => c.key));
        for (const url of urls.filter(u => !fresh.has(u)).slice(0, limit - done)) {
            memory.delete(`${account.phone_number_id}:${url}`);
            await admin.from("whatsapp_media_cache").delete().eq("phone_number_id", account.phone_number_id).eq("key", url);
            if (await cachedImageId(account, url)) done++;
        }
        if (done >= limit) break;
    }
    return done;
}
