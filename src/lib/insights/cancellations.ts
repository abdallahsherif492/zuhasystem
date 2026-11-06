/**
 * Cancellation analysis: every decided order of a period (confirmed or
 * cancelled; Waiting is not decided yet) described by what is known about it,
 * so cancellation rates can be compared across any of those facts and
 * combined as filters.
 *
 * The rate is cancelled ÷ decided. "Extra" cancellations of a group are how
 * many more it had than the period's average rate would give it: the size of
 * the problem there, which is what the findings are ranked by.
 */

import { governorateArabic } from "@/lib/governorates";
import { reasonLabel } from "@/components/orders/confirmation-attempts";

export interface RawOrder {
    id: string;
    created_at: string;
    status: string | null;
    order_type: string | null;
    channel: string | null;
    tags: unknown;
    total_amount: number | null;
    shipping_cost: number | null;
    discount: number | null;
    paid_amount: number | null;
    customer_info: { name?: string; phone?: string; governorate?: string; delivery_rate?: string } | null;
    confirm_attempts: number | null;
    last_attempt_reason: string | null;
    last_attempt_note: string | null;
    closed_by: string | null;
    easyorders_id: string | null;
    shopify_id: string | null;
}

export interface Row {
    id: string;
    createdAt: string;
    cancelled: boolean;
    value: number;
    name: string;
    phone: string;
    products: string[];
    moderator: string | null;
    lastReason: string | null;
    lastNote: string | null;
    facts: Record<DimensionKey, string[]>;
}

export type DimensionKey =
    | "governorate" | "product" | "moderator" | "value" | "units" | "attempts" | "reason"
    | "rating" | "duplicate" | "hour" | "weekday" | "shipping" | "source" | "deposit" | "discount";

export interface Dimension {
    key: DimensionKey;
    label: string;
    hint?: string;
    /** Values in this order instead of by size of the problem (bands, hours, days). */
    order?: string[];
}

const VALUE_BANDS = ["أقل من 300", "300 – 500", "500 – 700", "700 – 1000", "1000 – 1500", "1500 وأكتر"];
const HOURS = ["12 بالليل – 6 الصبح", "6 الصبح – 12 الضهر", "12 الضهر – 6 المغرب", "6 المغرب – 12 بالليل"];
const DAYS = ["السبت", "الحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة"];
const RATINGS: Record<string, string> = { high: "عالي", moderate: "متوسط", low: "ضعيف", unknown: "مش معروف عندهم" };
const NO_RATING = "مفيش تقييم";
const NO_ATTEMPT = "اتكلم من أول مرة";
export const UNKNOWN_MODERATOR = "مش معروف";

export const DIMENSIONS: Dimension[] = [
    { key: "product", label: "المنتج", hint: "الأوردر اللي فيه أكتر من منتج بيتحسب مع كل منتج فيه." },
    { key: "governorate", label: "المحافظة" },
    { key: "moderator", label: "المودريتور", hint: "اللي لغى الأوردر أو أكده. اللي لغى بيتعرف من سجل العمليات، وده بيتمسح بعد 30 يوم." },
    { key: "value", label: "قيمة الأوردر", order: VALUE_BANDS },
    { key: "units", label: "عدد القطع", order: ["1", "2", "3", "4 وأكتر"] },
    { key: "duplicate", label: "العميل عامل أوردر تاني", hint: "نفس الرقم طلب أوردر تاني قبله أو بعده بـ 3 أيام. الإلغاء هنا غالبًا مكرر مش خسارة.", order: ["أيوه", "لأ"] },
    { key: "attempts", label: "محاولات اتصال فاشلة", order: ["0", "1", "2", "3 وأكتر"] },
    { key: "reason", label: "آخر سبب فشل الاتصال" },
    { key: "rating", label: "تقييم الاستلام من EasyOrders", order: ["عالي", "متوسط", "ضعيف", "مش معروف عندهم", NO_RATING] },
    { key: "hour", label: "وقت الطلب", order: HOURS },
    { key: "weekday", label: "يوم الطلب", order: DAYS },
    { key: "shipping", label: "مصاريف الشحن على العميل" },
    { key: "source", label: "مصدر الطلب" },
    { key: "deposit", label: "دفع عربون", order: ["أيوه", "لأ"] },
    { key: "discount", label: "عليه خصم", order: ["أيوه", "لأ"] },
];

export const dimension = (key: DimensionKey) => DIMENSIONS.find(d => d.key === key)!;

const cairoHour = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Cairo" });
const cairoWeekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Africa/Cairo" });
const WEEKDAY_INDEX: Record<string, number> = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 };

const phoneKey = (p: string | undefined) => (p || "").replace(/\D/g, "").slice(-10);
const tagsOf = (t: unknown) => (t ? JSON.stringify(t).toLowerCase() : "");

function valueBand(v: number) {
    if (v < 300) return VALUE_BANDS[0];
    if (v < 500) return VALUE_BANDS[1];
    if (v < 700) return VALUE_BANDS[2];
    if (v < 1000) return VALUE_BANDS[3];
    if (v < 1500) return VALUE_BANDS[4];
    return VALUE_BANDS[5];
}

function sourceOf(o: RawOrder) {
    const tags = tagsOf(o.tags);
    if (o.easyorders_id || tags.includes("easyorders")) return "متجر EasyOrders";
    if (o.shopify_id || tags.includes("shopify")) return "متجر Shopify";
    return o.channel ? `يدوي (${o.channel})` : "يدوي";
}

/** Store forms people filled and left; not orders anyone placed. */
export const isMissedOrder = (o: RawOrder) => o.order_type === "missed" || tagsOf(o.tags).includes("missed-order");

export function buildRows(
    orders: RawOrder[],
    items: Map<string, { quantity: number; product: string }[]>,
    cancelledBy: Map<string, string>,
): Row[] {
    // Other orders from the same number, decided or not, to spot repeats.
    const byPhone = new Map<string, number[]>();
    for (const o of orders) {
        const p = phoneKey(o.customer_info?.phone);
        if (!p) continue;
        const list = byPhone.get(p) || [];
        list.push(new Date(o.created_at).getTime());
        byPhone.set(p, list);
    }
    const DAY = 864e5;

    return orders
        .filter(o => !isMissedOrder(o) && ["waiting"].indexOf(String(o.status || "").trim().toLowerCase()) === -1)
        .map(o => {
            const cancelled = String(o.status || "").trim().toLowerCase() === "cancelled";
            const lines = items.get(o.id) || [];
            const units = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
            const products = [...new Set(lines.map(l => l.product))];
            const value = Number(o.total_amount) || 0;
            const at = new Date(o.created_at);
            const h = Number(cairoHour.format(at)) % 24;
            const attempts = Number(o.confirm_attempts) || 0;
            const moderator = cancelled ? cancelledBy.get(o.id) || null : o.closed_by || null;
            const ship = Math.round(Number(o.shipping_cost) || 0);
            const p = phoneKey(o.customer_info?.phone);
            const t = at.getTime();
            let others = 0;
            for (const x of (p && byPhone.get(p)) || []) if (Math.abs(x - t) < 3 * DAY) others++;
            const rating = o.customer_info?.delivery_rate;

            const facts: Record<DimensionKey, string[]> = {
                governorate: [governorateArabic(o.customer_info?.governorate) || o.customer_info?.governorate || "من غير محافظة"],
                product: products.length ? products : ["من غير منتج"],
                moderator: [moderator ? moderator.split("@")[0] : UNKNOWN_MODERATOR],
                value: [valueBand(value)],
                units: [units >= 4 ? "4 وأكتر" : String(Math.max(units, 1))],
                attempts: [attempts >= 3 ? "3 وأكتر" : String(attempts)],
                reason: [attempts ? reasonLabel(o.last_attempt_reason) : NO_ATTEMPT],
                rating: [rating ? RATINGS[rating] || rating : NO_RATING],
                duplicate: [others > 1 ? "أيوه" : "لأ"],
                hour: [HOURS[Math.floor(h / 6)]],
                weekday: [DAYS[WEEKDAY_INDEX[cairoWeekday.format(at)] ?? 0]],
                shipping: [ship > 0 ? `${ship} جنيه` : "شحن مجاني"],
                source: [sourceOf(o)],
                deposit: [(Number(o.paid_amount) || 0) > 0 ? "أيوه" : "لأ"],
                discount: [(Number(o.discount) || 0) > 0 ? "أيوه" : "لأ"],
            };
            return {
                id: o.id,
                createdAt: o.created_at,
                cancelled,
                value,
                name: o.customer_info?.name || "",
                phone: o.customer_info?.phone || "",
                products,
                moderator,
                lastReason: attempts ? reasonLabel(o.last_attempt_reason) : null,
                lastNote: o.last_attempt_note,
                facts,
            };
        });
}

export type Filters = Partial<Record<DimensionKey, string[]>>;

/** Rows matching every filter, leaving one dimension's own filter out when asked. */
export function applyFilters(rows: Row[], filters: Filters, except?: DimensionKey): Row[] {
    const active = (Object.entries(filters) as [DimensionKey, string[]][]).filter(([k, v]) => k !== except && v && v.length);
    if (!active.length) return rows;
    return rows.filter(r => active.every(([k, vals]) => r.facts[k].some(f => vals.includes(f))));
}

export interface Group { value: string; orders: number; cancelled: number; rate: number; extra: number; lost: number }

export interface Summary { orders: number; cancelled: number; rate: number; lost: number }

export function summarize(rows: Row[]): Summary {
    const cancelled = rows.filter(r => r.cancelled);
    return {
        orders: rows.length,
        cancelled: cancelled.length,
        rate: rows.length ? cancelled.length / rows.length : 0,
        lost: cancelled.reduce((s, r) => s + r.value, 0),
    };
}

/** One dimension broken down, against the average rate of the same rows. */
export function breakdown(rows: Row[], dim: Dimension): Group[] {
    const avg = summarize(rows).rate;
    const m = new Map<string, { orders: number; cancelled: number; lost: number }>();
    for (const r of rows) {
        for (const v of r.facts[dim.key]) {
            const g = m.get(v) || { orders: 0, cancelled: 0, lost: 0 };
            g.orders++;
            if (r.cancelled) { g.cancelled++; g.lost += r.value; }
            m.set(v, g);
        }
    }
    const groups = [...m.entries()].map(([value, g]) => ({
        value, ...g, rate: g.orders ? g.cancelled / g.orders : 0, extra: g.cancelled - g.orders * avg,
    }));
    if (dim.order) {
        const pos = (v: string) => { const i = dim.order!.indexOf(v); return i === -1 ? 999 : i; };
        return groups.sort((a, b) => pos(a.value) - pos(b.value) || b.orders - a.orders);
    }
    return groups.sort((a, b) => b.extra - a.extra || b.orders - a.orders);
}

export interface Finding { dim: Dimension; group: Group; avg: number }

/**
 * Where the cancellations above the average are: groups big enough to mean
 * something and clearly above the average, largest excess first.
 */
export function findings(rows: Row[], limit = 6): Finding[] {
    const s = summarize(rows);
    if (s.orders < 30) return [];
    const minOrders = Math.max(15, Math.round(s.orders * 0.02));
    const out: Finding[] = [];
    for (const dim of DIMENSIONS) {
        for (const g of breakdown(rows, dim)) {
            if (g.orders < minOrders || g.orders === s.orders) continue;
            if (g.rate < s.rate + 0.08 || g.extra < 5) continue;
            if (dim.key === "moderator" && g.value === UNKNOWN_MODERATOR) continue;
            out.push({ dim, group: g, avg: s.rate });
        }
    }
    return out.sort((a, b) => b.group.extra - a.group.extra).slice(0, limit);
}
