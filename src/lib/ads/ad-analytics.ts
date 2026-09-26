/**
 * What each product's ads cost, and what each of its orders cost.
 *
 * Spend comes from the uploaded ad reports, orders from the orders table, and
 * the two meet at the product: an ad is linked to a product by its name, an
 * order line to a product through its variant. Only orders from the channels
 * the ads bring are counted — message ads against Facebook, WhatsApp and
 * Instagram orders, website ads against website orders — since that is the
 * only attribution the data allows: nothing in an order says which ad sent it.
 *
 * An order with two advertised products counts as an order for each of them;
 * its revenue is split by line, so revenue and profit still add up.
 */

import { adKey } from "./ad-report";

export const CANCELLED = new Set(["Cancelled"]);
export const DELIVERED = new Set(["Delivered", "Collected"]);
export const RETURNED = new Set(["Returned", "Returning"]);

/** Dates are compared in Cairo time: that is the day the ad account reports in and the day the order came in. */
const cairoDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
export const toCairoDate = (iso: string) => cairoDay.format(new Date(iso));

export interface SpendRow {
    ad_name: string;
    date_from: string;
    date_to: string;
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    results: number;
}

export interface OrderRow {
    id: string;
    created_at: string;
    status: string;
    items: { quantity: number; price_at_sale: number; cost_at_sale: number | null; product_id: string | null }[];
}

/** product id, null for "not a product", undefined for not linked yet. */
export type LinkMap = Map<string, string | null>;

export interface Totals {
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    results: number;
    orders: number;
    cancelled: number;
    confirmed: number;
    delivered: number;
    returned: number;
    units: number;
    revenue: number;   // confirmed orders' lines
    cogs: number;
}

export interface ProductStats extends Totals {
    productId: string;
    ads: string[];
}

export interface AdStats {
    key: string;
    name: string;
    productId: string | null | undefined;
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    results: number;
    days: number;
    firstDay: string;
    lastDay: string;
}

export interface DayStats {
    day: string;
    /** Inside a date range some uploaded report covers. Orders on other days are not counted. */
    covered: boolean;
    spend: number;
    results: number;
    orders: number;
    confirmed: number;
}

const zero = (): Totals => ({ spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0, orders: 0, cancelled: 0, confirmed: 0, delivered: 0, returned: 0, units: 0, revenue: 0, cogs: 0 });

const dayCount = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

export function eachDay(from: string, to: string): string[] {
    const out: string[] = [];
    for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
}

/**
 * The share of a report row inside [from, to]. A daily row is in or out; a
 * row covering a range counts for the days of it inside the period.
 */
function share(r: SpendRow, from: string, to: string): number {
    const a = r.date_from > from ? r.date_from : from;
    const b = r.date_to < to ? r.date_to : to;
    if (a > b) return 0;
    return dayCount(a, b) / dayCount(r.date_from, r.date_to);
}

export interface AdAnalytics {
    total: Totals;
    /** Spend on ads not linked to a product yet, and on ads marked as not for one product. */
    unlinkedSpend: number;
    generalSpend: number;
    products: ProductStats[];
    /** Products that had orders in these channels and no ad spend. */
    organic: ProductStats[];
    ads: AdStats[];
    days: DayStats[];
    /** Days in the period no report covers: their orders were left out. */
    uncoveredDays: number;
    daysByProduct: Map<string, DayStats[]>;
}

/**
 * `covered`: the date ranges of the uploaded reports. Orders on a day no
 * report covers are left out — without the spend of that day they would only
 * make orders look cheaper. A covered day with no spend is a day the ads were
 * off, and its orders do count.
 */
export function computeAdAnalytics(
    spendRows: SpendRow[], orders: OrderRow[], links: LinkMap, from: string, to: string,
    covered: { date_from: string; date_to: string }[],
): AdAnalytics {
    const days = eachDay(from, to);
    const dayIndex = new Map(days.map((d, i) => [d, i]));
    const isCovered = (d: string) => covered.some(c => c.date_from <= d && d <= c.date_to);
    const coveredDays = days.map(isCovered);
    const blankDays = () => days.map((day, i) => ({ day, covered: coveredDays[i], spend: 0, results: 0, orders: 0, confirmed: 0 }));

    const products = new Map<string, ProductStats>();
    const daysByProduct = new Map<string, DayStats[]>();
    const product = (id: string) => {
        if (!products.has(id)) {
            products.set(id, { ...zero(), productId: id, ads: [] });
            daysByProduct.set(id, blankDays());
        }
        return products.get(id)!;
    };

    const total = zero();
    const allDays = blankDays();
    const ads = new Map<string, AdStats>();
    let unlinkedSpend = 0;
    let generalSpend = 0;

    // Spend
    for (const r of spendRows) {
        const f = share(r, from, to);
        if (!f) continue;
        const key = adKey(r.ad_name);
        const link = links.get(key);
        const s = { spend: r.spend * f, impressions: r.impressions * f, reach: r.reach * f, clicks: r.clicks * f, results: r.results * f };

        const ad = ads.get(key) ?? { key, name: r.ad_name, productId: link, spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0, days: 0, firstDay: r.date_from, lastDay: r.date_to };
        ad.spend += s.spend; ad.impressions += s.impressions; ad.reach += s.reach; ad.clicks += s.clicks; ad.results += s.results;
        if (s.spend > 0) ad.days += dayCount(r.date_from > from ? r.date_from : from, r.date_to < to ? r.date_to : to);
        if (r.date_from < ad.firstDay) ad.firstDay = r.date_from;
        if (r.date_to > ad.lastDay) ad.lastDay = r.date_to;
        ads.set(key, ad);

        for (const k of ["spend", "impressions", "reach", "clicks", "results"] as const) total[k] += s[k];

        // Spread over the days of the row that fall in the period.
        const rowDays = eachDay(r.date_from > from ? r.date_from : from, r.date_to < to ? r.date_to : to);
        const perDay = (v: number) => v / rowDays.length;
        for (const d of rowDays) {
            const i = dayIndex.get(d)!;
            allDays[i].spend += perDay(s.spend);
            allDays[i].results += perDay(s.results);
        }

        if (link === undefined) { unlinkedSpend += s.spend; continue; }
        if (link === null) { generalSpend += s.spend; continue; }
        const p = product(link);
        for (const k of ["spend", "impressions", "reach", "clicks", "results"] as const) p[k] += s[k];
        if (!p.ads.includes(r.ad_name)) p.ads.push(r.ad_name);
        const pd = daysByProduct.get(link)!;
        for (const d of rowDays) {
            const i = dayIndex.get(d)!;
            pd[i].spend += perDay(s.spend);
            pd[i].results += perDay(s.results);
        }
    }

    // Orders
    for (const o of orders) {
        const day = toCairoDate(o.created_at);
        const i = dayIndex.get(day);
        if (i === undefined || !coveredDays[i]) continue;
        const cancelled = CANCELLED.has(o.status);
        const delivered = DELIVERED.has(o.status);
        const returned = RETURNED.has(o.status);

        const bump = (t: Totals, lines: OrderRow["items"]) => {
            t.orders++;
            if (cancelled) t.cancelled++; else t.confirmed++;
            if (delivered) t.delivered++;
            if (returned) t.returned++;
            if (cancelled) return;
            for (const l of lines) {
                t.units += l.quantity;
                t.revenue += l.quantity * Number(l.price_at_sale || 0);
                t.cogs += l.quantity * Number(l.cost_at_sale || 0);
            }
        };
        bump(total, o.items);
        allDays[i].orders++;
        if (!cancelled) allDays[i].confirmed++;

        const byProduct = new Map<string, OrderRow["items"]>();
        for (const l of o.items) {
            if (!l.product_id) continue;
            byProduct.set(l.product_id, [...(byProduct.get(l.product_id) ?? []), l]);
        }
        for (const [pid, lines] of byProduct) {
            bump(product(pid), lines);
            const pd = daysByProduct.get(pid)!;
            pd[i].orders++;
            if (!cancelled) pd[i].confirmed++;
        }
    }

    const all = [...products.values()];
    return {
        total, unlinkedSpend, generalSpend,
        products: all.filter(p => p.spend > 0).sort((a, b) => b.spend - a.spend),
        organic: all.filter(p => p.spend <= 0 && p.orders > 0).sort((a, b) => b.orders - a.orders),
        ads: [...ads.values()].sort((a, b) => b.spend - a.spend),
        days: allDays,
        uncoveredDays: coveredDays.filter(c => !c).length,
        daysByProduct,
    };
}

// ---------------------------------------------------------------------------
// The numbers a media buyer reads
// ---------------------------------------------------------------------------

const div = (a: number, b: number) => (b > 0 ? a / b : null);

export function metrics(t: Totals) {
    const grossProfit = t.revenue - t.cogs;
    const closed = t.delivered + t.returned;
    return {
        cpm: div(t.spend * 1000, t.impressions),
        ctr: t.clicks > 0 ? div(t.clicks * 100, t.impressions) : null,
        costPerResult: div(t.spend, t.results),
        /** Orders per conversation / purchase the platform reported. */
        conversionRate: t.results > 0 ? div(t.orders * 100, t.results) : null,
        cpo: div(t.spend, t.orders),
        cpoConfirmed: div(t.spend, t.confirmed),
        cpoDelivered: div(t.spend, t.delivered),
        cancelRate: div(t.cancelled * 100, t.orders),
        deliveryRate: div(t.delivered * 100, closed),
        aov: div(t.revenue, t.confirmed),
        roas: div(t.revenue, t.spend),
        /** Gross profit per confirmed order: the most an order can cost in ads before it loses money. */
        breakEvenCpo: div(grossProfit, t.confirmed),
        profitAfterAds: grossProfit - t.spend,
        spendShareOfRevenue: div(t.spend * 100, t.revenue),
    };
}

export type Verdict = "winning" | "marginal" | "losing" | "no-orders";

/**
 * Winning when orders cost at most 60% of what one earns, marginal up to
 * break-even, losing past it. Uses confirmed orders: cancelled ones never
 * earned anything.
 */
export function verdict(t: Totals): Verdict | null {
    if (t.spend <= 0) return null;
    if (t.confirmed === 0) return "no-orders";
    const m = metrics(t);
    if (m.breakEvenCpo === null || m.breakEvenCpo <= 0) return "losing";
    const cpo = m.cpoConfirmed!;
    if (cpo <= m.breakEvenCpo * 0.6) return "winning";
    if (cpo <= m.breakEvenCpo) return "marginal";
    return "losing";
}
