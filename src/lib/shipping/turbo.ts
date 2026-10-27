/**
 * Turbo (turbo-eg) courier API: sending orders as shipments, and reading their
 * statuses back. Docs: documenter.getpostman.com/view/15418034/2sBXc7L4mN.
 *
 * Every call carries the account's authentication_key and main_client_code
 * in its body. Governorates and areas are Turbo's own lists, by id; an order
 * here has a governorate but no area, so the area is guessed from the address
 * and confirmed by whoever sends it.
 */

export const TURBO_BASE = "https://platform.turbo.info";

export interface TurboConfig {
    enabled: boolean;
    apiKey: string;          // authentication_key
    accountId: string;       // main_client_code
    followupPhone?: string;  // api_followup_phone: who Turbo calls about a shipment
    shippingCompanyId?: string;
    autoSync?: boolean;
    autoSyncIntervalMinutes?: number;
}

export interface TurboPlace { id: number; name: string; status?: string }

/** The app's governorate names (English) → Turbo's governorate ids. */
export const TURBO_GOVERNORATE: Record<string, number> = {
    "Cairo": 1, "New Cairo": 1, "Giza": 2, "Sharkia": 3, "Dakahlia": 4, "Beheira": 5, "Minya": 6,
    "Qaliubiya": 7, "Alexandria": 8, "Gharbiya": 9, "Sohag": 10, "Assiut": 11, "Monufia": 12,
    "Kafr Al Sheikh": 13, "Fayoum": 14, "Qena": 15, "Beni Suef": 16, "Aswan": 17, "Damietta": 18,
    "Ismailia": 19, "Luxor": 20, "Port Said": 21, "Suez": 22, "Matrouh": 23, "North Sinai": 24,
    "Red Sea": 25, "New Valley": 26, "South Sinai": 27,
};
/** Turbo files the edges of Cairo and Giza under a governorate of their own. */
export const TURBO_CAIRO_GIZA_OUTSKIRTS = 28;

const cache = new Map<string, { at: number; data: TurboPlace[] }>();
const CACHE_MS = 6 * 60 * 60 * 1000;

async function getList(path: string): Promise<TurboPlace[]> {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    const res = await fetch(`${TURBO_BASE}${path}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) throw new Error(json?.message || `Turbo ${path} failed (${res.status})`);
    const data = ((json.feed || []) as TurboPlace[]).map(p => ({ id: Number(p.id), name: String(p.name), status: p.status }));
    cache.set(path, { at: Date.now(), data });
    return data;
}

export const getTurboGovernments = () => getList("/external-api/get-government");
export const getTurboAreas = (governmentId: number) => getList(`/external-api/get-area/${governmentId}`);

/** Arabic as people type it: no diacritics, one alef, ة as ه, ى and ئ as ي, ؤ as و. */
export function normalizeArabic(s: string) {
    return (s || "")
        .replace(/[ً-ْـ]/g, "")
        .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[ىئ]/g, "ي").replace(/ؤ/g, "و")
        .replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}

/**
 * The area named in the address. An address usually opens with the district
 * and then gives landmarks ("المقطم، شارع الصفا، أمام معهد الجزيرة"), so the
 * area mentioned first wins, and of two starting at the same place the longer
 * ("كورنيش المعادي" over "المعادي"). Names that are only digits match too
 * easily and are skipped; uncovered areas are never suggested.
 */
export function guessTurboArea(address: string, areas: TurboPlace[]): TurboPlace | null {
    const a = ` ${normalizeArabic(address)} `;
    let best: TurboPlace | null = null;
    let bestPos = Infinity, bestLen = 0;
    for (const area of areas) {
        if (area.status === "غير مغطاة") continue;
        const n = normalizeArabic(area.name);
        if (n.length < 3 || /^\d+$/.test(n)) continue;
        const pos = a.indexOf(` ${n} `);
        if (pos < 0) continue;
        if (pos < bestPos || (pos === bestPos && n.length > bestLen)) { best = area; bestPos = pos; bestLen = n.length; }
    }
    return best;
}

export interface TurboOrderPayload {
    government: number;
    area: number;
    address: string;
    amount_to_be_collected: number;
    order_summary: string;
    notes: string;
    remote_order_id: string;
    invoice_number: string;
    receiver: string;
    phone1: string;
    phone2?: string;
}

export async function addTurboOrder(config: TurboConfig, order: TurboOrderPayload): Promise<{ ok: true; code: string; barCode: string | null } | { ok: false; message: string }> {
    const body = {
        authentication_key: config.apiKey,
        main_client_code: Number(config.accountId) || config.accountId,
        ...order,
        api_followup_phone: config.followupPhone || undefined,
        weight: 1,
        delivery_type: 0,   // to the door; 1 is collection from a Turbo office
        is_order: "0",
        is_fragile: 0,
        phone2: order.phone2 || undefined,
    };
    try {
        const res = await fetch(`${TURBO_BASE}/external-api/add-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(body),
            cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (json?.success && (json.result?.code || json.result?.bar_code)) {
            return { ok: true, code: String(json.result.code ?? json.result.bar_code), barCode: json.result.bar_code ? String(json.result.bar_code) : null };
        }
        const errors = json?.errors ? Object.values(json.errors).flat().join("، ") : "";
        return { ok: false, message: [json?.message, errors].filter(Boolean).join(": ") || `Turbo answered ${res.status}` };
    } catch (e) {
        return { ok: false, message: (e as Error).message || "Turbo could not be reached" };
    }
}

export interface TurboStatus {
    code: string;
    bar_code: string | null;
    status: string;
    status_code: number | null;
    returned_inventory_status: string | null;
    return_reason: string | null;
    delay_reason: string | null;
    /** What we sent as the invoice number: the order's 8-character reference. */
    invoice_number?: string | null;
}

/** Every shipment's current status, for shipments in a date range (YYYY-MM-DD). */
export async function getTurboStatuses(config: TurboConfig, from: string, to: string): Promise<TurboStatus[]> {
    const res = await fetch(`${TURBO_BASE}/external-api/get-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ authentication_key: config.apiKey, main_client_code: Number(config.accountId) || config.accountId, from, to }),
        cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    // With nothing in progress Turbo answers 404 "Shipment not found" rather
    // than an empty list. That is an empty list, not a failure: treating it as
    // one stopped every send to Turbo whenever all shipments were waiting for
    // pickup or delivered.
    if (res.status === 404 || /shipment not found/i.test(String(json?.message || ""))) return [];
    if (!res.ok || !json?.success) throw new Error(json?.message || `Turbo get-status failed (${res.status})`);
    return (json.data || []) as TurboStatus[];
}

/**
 * Statuses that are known and deliberately leave the order as it is
 * (waiting for pickup, accepted) — so the sync does not report them as
 * unrecognised on every run.
 */
export function turboLeavesAlone(s: Pick<TurboStatus, "status"> & { status_code?: number | null }): boolean {
    return [1, 3].includes(Number(s.status_code)) || /قيد الانتظار|قيد التنفيذ/.test(normalizeArabic(s.status || ""));
}

/**
 * One shipment by its Turbo code. The date-range feed above leaves out
 * shipments still waiting for pickup (status 1, "قيد الإنتظار"), so a shipment
 * sent today is found this way until it shows up there.
 */
export async function searchTurboShipment(config: TurboConfig, code: string): Promise<TurboStatus | null> {
    const res = await fetch(`${TURBO_BASE}/external-api/search-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ authentication_key: config.apiKey, main_client_code: Number(config.accountId) || config.accountId, search_key: code }),
        cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!json?.success) return null;
    const list = (Array.isArray(json.result) ? json.result : [json.result]).filter(Boolean) as TurboStatus[];
    return list.find(s => String(s.code) === String(code)) || list[0] || null;
}

/**
 * Turbo's status → the order's. Only statuses that clearly say where the
 * parcel is move an order; anything else (a new or accepted request, a
 * cancelled one, a name not seen before) leaves it alone and is logged by
 * the sync, so the list can grow from what Turbo actually sends.
 */
export function mapTurboStatusToZuha(s: Pick<TurboStatus, "status" | "returned_inventory_status"> & { status_code?: number | null }): string | null {
    const t = normalizeArabic(`${s.status || ""}`);
    // Seen from Turbo so far: 1 "قيد الإنتظار" (waiting for pickup), 3 "قيد
    // التنفيذ" (accepted, not yet moving), 4 "مسلمة للمندوب" (handed to the
    // courier to deliver: on the road, not yet with the customer) and
    // 7 "تم التسليم" (delivered to the customer).
    if (Number(s.status_code) === 7) return "Delivered";
    if (/قيد الانتظار|قيد التنفيذ/.test(t)) return null;
    if (/مسلمه للمندوب|مسلمه للكابتن/.test(t)) return "Shipped";
    if (s.returned_inventory_status) return "Returned";
    if (/تم التسليم|تم التوصيل|delivered|تم تسليم/.test(t)) return "Delivered";
    if (/تم الارتجاع|مرتجع للمخزن|مرتجع للتاجر|تم رد|returned/.test(t)) return "Returned";
    if (/مرتجع|ارتجاع|رفض|return|refus/.test(t)) return "Returning";
    if (/موجل|تاجيل|postpon|delay|hold/.test(t)) return "Hold To redeliver";
    if (/تحت التوصيل|جاري التوصيل|مع المندوب|مع الكابتن|خرج للتوصيل|في الطريق|under delivery|out for delivery|in transit|shipped|picked/.test(t)) return "Shipped";
    return null;
}
