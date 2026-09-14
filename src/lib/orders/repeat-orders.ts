/**
 * Orders placed on the same number close together.
 *
 * A customer who hears nothing orders again, a form sent twice arrives twice,
 * a parcel still on the road gets ordered a second time. Each one lands as a
 * fresh order that looks like any other, and if both are confirmed both ship:
 * from June to mid-September, 42 pairs sharing a product were both confirmed
 * within a week of each other, and 18 of those ended in a return.
 *
 * The number is the key. Matching the stored string exactly finds 474 of the
 * 476 pairs that normalising it finds, so the query asks for exact values and
 * the comparison after it normalises both sides.
 *
 * Which orders count as related:
 *   within 7 days, in any state — a cancelled attempt, a delivery, a return
 *   are all worth knowing before the call;
 *   within 14 days while both orders are still open, because that pair can
 *   still become two parcels, and three days to two weeks is exactly when
 *   someone whose first order has not arrived tries again.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneNumbers } from "@/lib/orders/contact";
import { normalizeSearchText } from "@/lib/utils";

export const REPEAT_WINDOW_DAYS = 7;
export const OPEN_REPEAT_WINDOW_DAYS = 14;

const DAY = 86_400_000;
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Finished one way or the other: nothing more will ship on these. */
const CLOSED = new Set(["cancelled", "delivered", "collected", "returned", "returning"]);
export const isOpenOrder = (status: string | null | undefined) => !CLOSED.has(norm(status));

/** An exchange or a return is meant to share a number with the order it follows. */
const FOLLOW_UP_TYPES = new Set(["replacement", "return"]);

/** +20, 0020 or a dropped leading zero: the same Egyptian mobile. */
export function canonicalPhone(n: string): string {
    if (/^(?:0020|20)1\d{9}$/.test(n)) return n.replace(/^(?:0020|20)/, "0");
    if (/^1\d{9}$/.test(n)) return `0${n}`;
    return n;
}

/** Every number on an order, from both fields, in one canonical form. */
export function phoneKeys(info: any): string[] {
    const out = new Set<string>();
    for (const raw of [info?.phone, info?.phone2]) {
        for (const n of phoneNumbers(raw)) out.add(canonicalPhone(n));
    }
    return [...out];
}

const productKey = (name: string | null | undefined) => normalizeSearchText(String(name ?? "").trim());

export interface RepeatSubject {
    id: string;
    created_at: string;
    status: string | null;
    customer_info: any;
    order_type?: string | null;
    /** Product names on the order, to spot the same thing ordered twice. */
    productNames?: string[];
}

export interface RelatedOrder {
    id: string;
    created_at: string;
    status: string;
    total_amount: number;
    /** EasyOrders, Shopify, or the channel a manual order was entered under. */
    source: string;
    items: { name: string; quantity: number }[];
    /** Its time minus the subject's: negative means it came first. */
    gapMs: number;
    open: boolean;
    /**
     * Shares a product with the subject. Only ever claimed, never denied: a
     * name as the store sent it and the name in the catalogue do not always
     * agree, so no match is not proof of a different purchase.
     */
    sameProduct: boolean;
}

export interface RepeatInfo {
    /** Open orders first, then nearest in time. */
    related: RelatedOrder[];
    /** This order and at least one related one can both still ship. */
    doubleRisk: boolean;
}

export interface RepeatCandidate {
    id: string;
    created_at: string;
    status: string | null;
    total_amount: number | null;
    channel: string | null;
    order_type: string | null;
    easyorders_id: string | null;
    tags: unknown;
    customer_info: any;
    order_items: {
        quantity: number | null;
        unmapped_name: string | null;
        variants: { title: string | null; products: { name: string | null } | null } | null;
    }[] | null;
}

const CANDIDATE_COLUMNS =
    "id, created_at, status, total_amount, channel, order_type, easyorders_id, tags, customer_info, " +
    "order_items(quantity, unmapped_name, variants(title, products(name)))";

/** Orders per request, which keeps the list of numbers in the URL to a couple of KB. */
const BATCH = 60;

/**
 * Every order sharing a number with one of the subjects, inside the widest
 * window around them. What actually counts is decided in findRepeats, so this
 * may fetch a little more than is shown but never less.
 */
export async function fetchRepeatCandidates(
    client: SupabaseClient,
    businessId: string,
    subjects: RepeatSubject[],
): Promise<RepeatCandidate[]> {
    const batches: RepeatSubject[][] = [];
    for (let i = 0; i < subjects.length; i += BATCH) batches.push(subjects.slice(i, i + BATCH));

    const results = await Promise.all(batches.map(async batch => {
        const values = new Set<string>();
        for (const s of batch) {
            for (const k of phoneKeys(s.customer_info)) values.add(k);
            // The stored string as well, for a number saved as +20… or 20….
            for (const raw of [s.customer_info?.phone, s.customer_info?.phone2]) {
                const v = String(raw ?? "").trim();
                if (/^\+?\d{7,15}$/.test(v)) values.add(v);
            }
        }
        const times = batch.map(s => new Date(s.created_at).getTime()).filter(Number.isFinite);
        if (!values.size || !times.length) return [];

        const list = [...values].map(v => `"${v}"`).join(",");
        const span = OPEN_REPEAT_WINDOW_DAYS * DAY;
        const { data, error } = await client
            .from("orders")
            .select(CANDIDATE_COLUMNS)
            .eq("business_id", businessId)
            .gte("created_at", new Date(Math.min(...times) - span).toISOString())
            .lte("created_at", new Date(Math.max(...times) + span).toISOString())
            .or(`customer_info->>phone.in.(${list}),customer_info->>phone2.in.(${list})`)
            .order("created_at", { ascending: false })
            .order("id")
            .limit(1000);
        if (error) throw error;
        return (data || []) as unknown as RepeatCandidate[];
    }));

    const byId = new Map<string, RepeatCandidate>();
    for (const rows of results) for (const r of rows) byId.set(r.id, r);
    return [...byId.values()];
}

function sourceOf(c: RepeatCandidate): string {
    const tags = JSON.stringify(c.tags ?? []).toLowerCase();
    if (c.easyorders_id || tags.includes("easyorders")) return "EasyOrders";
    if (tags.includes("shopify")) return "Shopify";
    return String(c.channel ?? "").trim() || "—";
}

/** For each subject with related orders: those orders, and whether two can still ship. */
export function findRepeats(subjects: RepeatSubject[], candidates: RepeatCandidate[]): Map<string, RepeatInfo> {
    const byNumber = new Map<string, RepeatCandidate[]>();
    for (const c of candidates) {
        if (FOLLOW_UP_TYPES.has(norm(c.order_type))) continue;
        for (const k of phoneKeys(c.customer_info)) {
            const list = byNumber.get(k);
            if (list) list.push(c);
            else byNumber.set(k, [c]);
        }
    }

    const out = new Map<string, RepeatInfo>();
    for (const s of subjects) {
        if (FOLLOW_UP_TYPES.has(norm(s.order_type))) continue;
        const at = new Date(s.created_at).getTime();
        if (!Number.isFinite(at)) continue;
        const subjectOpen = isOpenOrder(s.status);
        const mine = new Set((s.productNames || []).map(productKey).filter(Boolean));

        const seen = new Set<string>([s.id]);
        const related: RelatedOrder[] = [];
        for (const k of phoneKeys(s.customer_info)) {
            for (const c of byNumber.get(k) || []) {
                if (seen.has(c.id)) continue;
                seen.add(c.id);

                const gapMs = new Date(c.created_at).getTime() - at;
                const days = Math.abs(gapMs) / DAY;
                const open = isOpenOrder(c.status);
                const counts = days <= REPEAT_WINDOW_DAYS
                    || (days <= OPEN_REPEAT_WINDOW_DAYS && open && subjectOpen);
                if (!counts) continue;

                const items = (c.order_items || []).map(it => {
                    const product = it.variants?.products?.name;
                    const variant = it.variants?.title;
                    return {
                        name: product ? (variant ? `${product} - ${variant}` : product) : (it.unmapped_name || "?"),
                        key: productKey(product || it.unmapped_name),
                        quantity: Number(it.quantity) || 1,
                    };
                });

                related.push({
                    id: c.id,
                    created_at: c.created_at,
                    status: String(c.status ?? ""),
                    total_amount: Number(c.total_amount) || 0,
                    source: sourceOf(c),
                    items: items.map(({ name, quantity }) => ({ name, quantity })),
                    gapMs,
                    open,
                    sameProduct: items.some(i => i.key && mine.has(i.key)),
                });
            }
        }

        if (!related.length) continue;
        // Open ones first: they are why a box is red, and a run of cancelled
        // attempts must not push them out of sight.
        related.sort((a, b) => (Number(b.open) - Number(a.open)) || (Math.abs(a.gapMs) - Math.abs(b.gapMs)));
        out.set(s.id, { related, doubleRisk: subjectOpen && related.some(r => r.open) });
    }
    return out;
}
