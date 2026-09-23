"use server";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Copy a merchant's EasyOrders catalogue into eCommerx.
 *
 * Adding products by hand was the step new signups never got past: 3 of 21
 * new stores added even one. Most of them already have every product on
 * EasyOrders, with its price and code, so this reads them from there using the
 * API key the store saved in settings.
 *
 * Additive only. It never edits or deletes anything, and skips any product
 * whose code or name the store already has, so running it twice, or on a store
 * that already set its catalogue up by hand, changes nothing that exists. The
 * code (SKU) is copied because it is what the order webhook matches incoming
 * items on; products without one on EasyOrders arrive unmapped, as today.
 */

const EO_API = "https://api.easy-orders.net/api/v1/external-apps";
/** Above this many products a store already has its catalogue; import is refused. */
const MAX_EXISTING_PRODUCTS = 15;
const MANAGER_ROLES = new Set(["owner", "admin", "platform admin", "super admin"]);
const FALLBACK_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";

export interface EasyOrdersImportResult {
    ok: boolean;
    error?: string;
    found?: number;
    imported?: number;
    skipped?: number;
    withoutCode?: number;
    failed?: number;
}

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const normSku = (s: unknown) => String(s ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

async function eoGet(path: string, apiKey: string) {
    const res = await fetch(`${EO_API}${path}`, {
        headers: { "Api-Key": apiKey, Accept: "application/json" },
        cache: "no-store",
    });
    if (!res.ok) throw Object.assign(new Error(`EasyOrders ${res.status}`), { status: res.status });
    return res.json();
}

/** Run `fn` over `items`, at most `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    }));
    return out;
}

export async function importEasyOrdersProducts(businessId: string): Promise<EasyOrdersImportResult> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return { ok: false, error: "إعدادات السيرفر ناقصة. كلّمنا وهنظبطها." };

    // Who is asking, from their own session.
    const cookieStore = await cookies();
    const session = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_ANON, {
        cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
    });
    const { data: { user } } = await session.auth.getUser();
    if (!user?.email) return { ok: false, error: "سجّل دخول تاني وجرّب." };

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: membership } = await admin
        .from("business_users")
        .select("role")
        .eq("business_id", businessId)
        .eq("user_email", user.email)
        .maybeSingle();
    const role = String(membership?.role || "").toLowerCase().trim().replace(/_/g, " ");
    if (!MANAGER_ROLES.has(role)) return { ok: false, error: "صاحب المتجر أو المدير بس اللي يقدر يستورد المنتجات." };

    const { data: business } = await admin.from("businesses").select("theme_config").eq("id", businessId).single();
    const tc = business?.theme_config || {};
    const apiKey = String(tc.integrations?.platforms?.easyorders?.apiKey || tc.easyorders_api_key || "").trim();
    if (!apiKey) return { ok: false, error: "حط الـ API Key بتاع EasyOrders في الخانة واحفظ الإعدادات الأول." };

    // Their catalogue.
    type EoProduct = { id?: string; name?: string; hidden?: boolean; sku?: string; price?: number; expense?: number; track_stock?: boolean; quantity?: number };
    let list: EoProduct[] = [];
    try {
        for (let page = 1; page <= 40; page++) {
            const body = await eoGet(`/products?page=${page}&limit=50`, apiKey);
            const rows: EoProduct[] = Array.isArray(body) ? body : (body?.data || []);
            list.push(...rows);
            const totalPages = Number(body?.totalPages) || 1;
            if (!rows.length || page >= totalPages || Array.isArray(body)) break;
        }
    } catch (e) {
        const status = (e as { status?: number })?.status;
        return {
            ok: false,
            error: status === 401 || status === 403
                ? "EasyOrders رفض الـ API Key. اتأكد إنك نسخته صح من إعدادات EasyOrders."
                : "مش قادرين نوصل لـ EasyOrders دلوقتي. جرّب كمان شوية.",
        };
    }
    list = list.filter(p => p && p.id && p.name && !p.hidden);

    // What the store already has, so nothing is duplicated.
    const [{ data: existingProducts }, { data: existingVariants }] = await Promise.all([
        admin.from("products").select("name").eq("business_id", businessId),
        admin.from("variants").select("sku").eq("business_id", businessId),
    ]);
    // Built for a store setting up, not for one with a catalogue already.
    // Names here and on EasyOrders often differ (English here, Arabic there),
    // so on a full catalogue name matching would miss and duplicate products.
    if ((existingProducts || []).length > MAX_EXISTING_PRODUCTS) {
        return { ok: false, error: "متجرك فيه منتجات بالفعل. الاستيراد ده للمتاجر الجديدة — لو محتاجه كلّمنا." };
    }
    const haveNames = new Set((existingProducts || []).map(p => norm(p.name)));
    const haveSkus = new Set((existingVariants || []).map(v => normSku(v.sku)).filter(Boolean));

    let imported = 0, skipped = 0, withoutCode = 0, failed = 0;
    await pool(list, 6, async (summary) => {
        try {
            // The list has no code or cost; the product itself does.
            const p: EoProduct = await eoGet(`/products/${summary.id}`, apiKey).catch(() => summary);
            const name = String(p.name || summary.name).trim();
            const sku = String(p.sku || "").trim();
            if (haveNames.has(norm(name)) || (sku && haveSkus.has(normSku(sku)))) { skipped++; return; }
            haveNames.add(norm(name));
            if (sku) haveSkus.add(normSku(sku));

            const { data: product, error: pErr } = await admin
                .from("products")
                .insert({ business_id: businessId, name })
                .select("id")
                .single();
            if (pErr || !product) { failed++; return; }

            const tracks = !!p.track_stock;
            const { error: vErr } = await admin.from("variants").insert({
                business_id: businessId,
                product_id: product.id,
                title: "Default",
                sku: sku || null,
                sale_price: Number(p.price) || 0,
                cost_price: Number(p.expense) || 0,
                track_inventory: tracks,
                stock_qty: tracks ? Math.max(0, Number(p.quantity) || 0) : 0,
            });
            if (vErr) {
                // No half-products: a product without a variant cannot be sold.
                await admin.from("products").delete().eq("id", product.id).eq("business_id", businessId);
                failed++;
                return;
            }
            imported++;
            if (!sku) withoutCode++;
        } catch {
            failed++;
        }
    });

    return { ok: true, found: list.length, imported, skipped, withoutCode, failed };
}
