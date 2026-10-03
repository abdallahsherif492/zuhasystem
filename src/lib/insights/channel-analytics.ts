/**
 * Shapes for channel_analytics() (20261004_channel_analytics.sql) and the
 * arithmetic the Channels page does on them.
 */

export type AdGroup = "messages" | "website" | "tiktok" | "other";

export interface ChannelRow {
    channel: string;
    ad_group: AdGroup;
    orders: number;
    cancelled: number;
    delivered: number;
    returned: number;
    open: number;
    sales: number;            // not cancelled
    delivered_sales: number;
    delivered_profit: number;
    return_shipping: number;  // courier cost of returned orders
    customers: number;
    returning_orders: number;
    units: number;
}

export interface DailyRow { day: string; channel: string; orders: number; confirmed: number; sales: number }
export interface ProductRow { channel: string; product_id: string; name: string; units: number; sales: number; orders: number; delivered: number; returned: number }
export interface ModeratorRow { moderator: string | null; channel: string; orders: number; cancelled: number; delivered: number; returned: number; open: number; sales: number; delivered_sales: number }
export interface AdsRow { ad_group: AdGroup | "unassigned"; spend: number }

export interface ChannelAnalytics {
    channels: ChannelRow[];
    daily: DailyRow[];
    products: ProductRow[];
    moderators: ModeratorRow[];
    ads: AdsRow[];
}

export const AD_GROUP_LABEL: Record<AdGroup, { ar: string; en: string }> = {
    messages: { ar: "رسائل (فيسبوك / واتساب / إنستجرام)", en: "Messages (Facebook / WhatsApp / Instagram)" },
    website: { ar: "الموقع", en: "Website" },
    tiktok: { ar: "تيك توك", en: "TikTok" },
    other: { ar: "قنوات تانية", en: "Other channels" },
};

export const CHANNEL_COLORS: Record<string, string> = {
    Website: "#f97316",
    Facebook: "#1877f2",
    Instagram: "#e1306c",
    WhatsApp: "#22c55e",
    TikTok: "#0f172a",
    "TikTok Website": "#64748b",
    Shopify: "#84cc16",
    messages: "#1877f2",
    website: "#f97316",
    tiktok: "#0f172a",
    other: "#a3a3a3",
};
export const channelColor = (c: string, i = 0) =>
    CHANNEL_COLORS[c] ?? ["#f59e0b", "#14b8a6", "#a855f7", "#ef4444", "#a3a3a3"][i % 5];

const num = (v: unknown) => Number(v) || 0;

/** JSON numbers arrive as numbers or strings depending on the type; make them numbers. */
export function normalize(raw: ChannelAnalytics): ChannelAnalytics {
    const n = <T extends object>(rows: T[] | null | undefined, keys: (keyof T)[]) =>
        (rows || []).map(r => { const o = { ...r }; for (const k of keys) (o[k] as unknown) = num(r[k]); return o; });
    return {
        channels: n(raw.channels, ["orders", "cancelled", "delivered", "returned", "open", "sales", "delivered_sales", "delivered_profit", "return_shipping", "customers", "returning_orders", "units"]),
        daily: n(raw.daily, ["orders", "confirmed", "sales"]),
        products: n(raw.products, ["units", "sales", "orders", "delivered", "returned"]),
        moderators: n(raw.moderators, ["orders", "cancelled", "delivered", "returned", "open", "sales", "delivered_sales"]),
        ads: n(raw.ads, ["spend"]),
    };
}

const zero = (channel: string, ad_group: AdGroup): ChannelRow => ({
    channel, ad_group, orders: 0, cancelled: 0, delivered: 0, returned: 0, open: 0, sales: 0,
    delivered_sales: 0, delivered_profit: 0, return_shipping: 0, customers: 0, returning_orders: 0, units: 0,
});

const SUM_KEYS = ["orders", "cancelled", "delivered", "returned", "open", "sales", "delivered_sales", "delivered_profit", "return_shipping", "customers", "returning_orders", "units"] as const;

/** Channels, or channels merged into their ad group. */
export function byView(rows: ChannelRow[], view: "channel" | "group"): ChannelRow[] {
    if (view === "channel") return rows;
    const m = new Map<string, ChannelRow>();
    for (const r of rows) {
        const g = m.get(r.ad_group) ?? zero(r.ad_group, r.ad_group);
        for (const k of SUM_KEYS) g[k] += r[k];
        m.set(r.ad_group, g);
    }
    return [...m.values()].sort((a, b) => b.orders - a.orders);
}

export function totals(rows: ChannelRow[]): ChannelRow {
    const t = zero("all", "other");
    for (const r of rows) for (const k of SUM_KEYS) t[k] += r[k];
    return t;
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);

export function rates(r: ChannelRow) {
    const confirmed = r.orders - r.cancelled;
    return {
        confirmed,
        cancelRate: div(r.cancelled * 100, r.orders),
        /** Of the orders that reached an end: delivered against delivered + returned. */
        deliveryRate: div(r.delivered * 100, r.delivered + r.returned),
        aov: div(r.sales, confirmed),
        profitPerDelivered: div(r.delivered_profit, r.delivered),
        returningShare: div(r.returning_orders * 100, confirmed),
        /** Delivered profit less the courier cost of returns: what the channel made before ads. */
        net: r.delivered_profit - r.return_shipping,
    };
}

/** The same-length period just before [from, to]. */
export function previousPeriod(from: string, to: string) {
    const d = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
    const len = Math.round((d(to) - d(from)) / 86_400_000) + 1;
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    return { from: iso(d(from) - len * 86_400_000), to: iso(d(from) - 86_400_000) };
}

/** Percentage change, or null when there is nothing to compare with. */
export const change = (now: number, before: number) => (before ? ((now - before) / Math.abs(before)) * 100 : null);

export const moderatorName = (email: string | null) => (email ? email.split("@")[0] : null);
