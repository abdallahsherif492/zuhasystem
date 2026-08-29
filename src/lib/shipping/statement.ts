/**
 * Reading a courier's account statement, and comparing it to ours.
 *
 * Couriers export a ledger, not a report: one row per movement, with what they
 * credited us and what they charged us, and the order written into a free-text
 * description. Telegraf's puts it between hashes — "# 5F33B2FB # تسليم كلى" —
 * and that eight-character code is the same order reference the orders list,
 * the CSV export and the waybill barcode all show. Every one of its 5,109
 * delivery lines matched an order on the first attempt, which is what makes
 * this worth doing automatically instead of by eye.
 *
 * Nothing here keys off a courier's particular wording. A row is classified by
 * whether it names an order and which way the money went, so a statement from
 * another company reconciles without a code change:
 *
 *   names an order, credits us   -> they owe us for that delivery
 *   names an order, charges us   -> a fee on that parcel (return, pickup)
 *   names no order, charges us   -> cash they actually transferred
 *   names no order, credits us   -> something else, reported and not guessed
 */

/** The eight hex characters an order is known by everywhere in this system. */
const REF = /\b([0-9a-fA-F]{8})\b/;

export type Movement = "delivery" | "order_fee" | "cash" | "other";

export interface StatementRow {
    index: number;
    date: string | null;
    reference: string | null;
    description: string;
    debit: number;
    credit: number;
    /** Positive when the courier owes us more because of this row. */
    net: number;
    movement: Movement;
}

/** Header names seen in the wild, per column we need. */
const HEADERS: Record<string, string[]> = {
    date: ["التاريخ", "تاريخ", "date", "transaction date"],
    description: ["وصف الحركة", "الوصف", "البيان", "description", "details", "narration"],
    debit: ["مدين", "debit"],
    credit: ["دائن", "credit"],
};

const clean = (v: any) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function toNumber(v: any): number {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    const s = String(v ?? "").replace(/[,\s]/g, "").replace(/[٠-٩]/g, d =>
        String(d.charCodeAt(0) - 0x0660));
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
}

/**
 * Find the header row and which column is which.
 *
 * Debit and credit are often repeated — the statement carries a running
 * balance in a second pair of columns under the same two names. The first
 * occurrence is the movement; the later one is the balance and must not be
 * summed, or every figure comes out as a cumulative total.
 */
function locateColumns(rows: any[][]): { header: number; cols: Record<string, number> } | null {
    for (let r = 0; r < Math.min(rows.length, 25); r++) {
        const cells = (rows[r] || []).map(clean);
        const cols: Record<string, number> = {};
        for (const [key, names] of Object.entries(HEADERS)) {
            const i = cells.findIndex(c => c && names.some(n => c === n || c.includes(n)));
            if (i >= 0) cols[key] = i;
        }
        if (cols.description !== undefined && cols.debit !== undefined && cols.credit !== undefined) {
            return { header: r, cols };
        }
    }
    return null;
}

export function parseStatement(rows: any[][]): { rows: StatementRow[]; error?: string } {
    const found = locateColumns(rows);
    if (!found) {
        return {
            rows: [],
            error: "مش لاقي أعمدة الوصف والمدين والدائن في الملف. اتأكد إنه كشف حساب من شركة الشحن.",
        };
    }
    const { header, cols } = found;
    const out: StatementRow[] = [];

    for (let r = header + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const description = String(row[cols.description] ?? "").replace(/\s+/g, " ").trim();
        const debit = toNumber(row[cols.debit]);
        const credit = toNumber(row[cols.credit]);
        if (!description && !debit && !credit) continue;

        // Opening and closing balance lines carry a total, not a movement.
        const first = clean(row[0]);
        if (first.includes("رصيد") || first.includes("balance")) continue;

        const m = description.match(REF);
        const reference = m ? m[1].toLowerCase() : null;
        const net = credit - debit;

        let movement: Movement;
        if (reference) movement = net >= 0 ? "delivery" : "order_fee";
        else movement = net < 0 ? "cash" : "other";

        out.push({
            index: r,
            date: cols.date !== undefined && row[cols.date] != null ? String(row[cols.date]) : null,
            reference, description, debit, credit, net, movement,
        });
    }
    return { rows: out };
}

export interface OrderLike {
    id: string;
    status: string | null;
    total_amount: number | null;
    paid_amount: number | null;
    actual_shipping_cost: number | null;
    shipping_company_id: string | null;
    created_at: string;
    customer_info: any;
}

const num = (v: any) => Number(v) || 0;
const isDelivered = (s: string | null) =>
    ["collected", "delivered"].includes((s || "").trim().toLowerCase());

/** What this system says the courier owes for one order. Mirrors v_courier_payouts. */
export function ourPayout(o: OrderLike): number {
    const collected = Math.max(num(o.total_amount) - num(o.paid_amount), 0);
    return isDelivered(o.status) ? collected - num(o.actual_shipping_cost) : 0;
}

export interface Reconciliation {
    /** Delivered here, credited there — the shipping deduction may still differ. */
    matched: { order: OrderLike; theirs: number; ours: number; gap: number }[];
    /** Delivered here, but the statement charges us for it instead of paying. */
    chargedNotCredited: { order: OrderLike; theirs: number; ours: number }[];
    /** Delivered here, and the statement has never heard of it. */
    unlisted: OrderLike[];
    /** Charges on parcels this system already knows came back. Real costs. */
    settledFees: { order: OrderLike | null; amount: number }[];
    /** References the statement names that match no order in this business. */
    unknownRefs: { reference: string; net: number; description: string }[];
    /** Every charge line grouped by the courier's own wording, for reading. */
    fees: { label: string; count: number; amount: number }[];
    totals: {
        theirCash: number;
        ourCollections: number;
        cashGap: number;            // we recorded this much more than they paid
        shippingGap: number;        // we deduct this much less than they take
        chargedValue: number;
        unlistedValue: number;
        settledFeesValue: number;
        unknownValue: number;
        ourDue: number;
        ourOutstanding: number;
        theirBalance: number;
        residual: number;           // zero when the bridge is complete
    };
}

/**
 * Bridge our outstanding balance to the courier's own closing balance.
 *
 * Every term below is a difference between the two ledgers over the same
 * orders, so the bridge is an identity rather than an estimate and a residual
 * that is not zero means something real was missed. Netting happens per order
 * reference first: a courier posts corrections as extra lines against the same
 * parcel, and reading each line on its own turns one delivery into a delivery
 * plus a fee.
 */
export function reconcile(
    stmt: StatementRow[],
    orders: OrderLike[],
    ourCollectionsRecorded: number,
): Reconciliation {
    const byRef = new Map(orders.map(o => [o.id.slice(0, 8), o]));

    const withRef = stmt.filter(r => r.reference);
    const noRef = stmt.filter(r => !r.reference);

    const netByRef = new Map<string, number>();
    const labelByRef = new Map<string, string>();
    for (const r of withRef) {
        netByRef.set(r.reference!, (netByRef.get(r.reference!) || 0) + r.net);
        if (r.net < 0) labelByRef.set(r.reference!, r.description);
    }

    const matched: Reconciliation["matched"] = [];
    const chargedNotCredited: Reconciliation["chargedNotCredited"] = [];
    const settledFees: Reconciliation["settledFees"] = [];
    const unknownRefs: Reconciliation["unknownRefs"] = [];

    for (const [ref, net] of netByRef) {
        const o = byRef.get(ref);
        if (!o) {
            unknownRefs.push({ reference: ref, net, description: labelByRef.get(ref) || "" });
            continue;
        }
        if (!isDelivered(o.status)) {
            // The two ledgers agree this parcel did not deliver. Whatever the
            // courier charged for it is a real cost, not a discrepancy.
            if (net !== 0) settledFees.push({ order: o, amount: -net });
            continue;
        }
        if (net > 0) matched.push({ order: o, theirs: net, ours: ourPayout(o), gap: ourPayout(o) - net });
        else chargedNotCredited.push({ order: o, theirs: net, ours: ourPayout(o) });
    }

    const seen = new Set(netByRef.keys());
    const unlisted = orders.filter(o => isDelivered(o.status) && !seen.has(o.id.slice(0, 8)));

    const feeGroups = new Map<string, { count: number; amount: number }>();
    for (const r of withRef.filter(x => x.net < 0)) {
        const label = r.description.replace(REF, "").replace(/#/g, " ")
            .replace(/\s+/g, " ").trim() || "رسوم";
        const g = feeGroups.get(label) || { count: 0, amount: 0 };
        g.count++; g.amount += -r.net;
        feeGroups.set(label, g);
    }

    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const theirCash = -sum(noRef.map(r => r.net));
    const cashGap = ourCollectionsRecorded - theirCash;
    const shippingGap = sum(matched.map(m => m.gap));
    const chargedValue = sum(chargedNotCredited.map(c => c.ours - c.theirs));
    const unlistedValue = sum(unlisted.map(ourPayout));
    const settledFeesValue = sum(settledFees.map(s => s.amount));
    const unknownValue = -sum(unknownRefs.map(u => u.net));

    const ourDue = sum(orders.filter(o => isDelivered(o.status)).map(ourPayout));
    const ourOutstanding = ourDue - ourCollectionsRecorded;
    const theirBalance = sum(stmt.map(r => r.net));

    // ourOutstanding minus every difference must land on their closing balance.
    const residual = ourOutstanding
        - shippingGap - chargedValue - unlistedValue
        - settledFeesValue - unknownValue
        + cashGap
        - theirBalance;

    return {
        matched, chargedNotCredited, unlisted, settledFees, unknownRefs,
        fees: [...feeGroups.entries()].map(([label, g]) => ({ label, ...g }))
            .sort((a, b) => b.amount - a.amount),
        totals: {
            theirCash, ourCollections: ourCollectionsRecorded, cashGap,
            shippingGap, chargedValue, unlistedValue, settledFeesValue, unknownValue,
            ourDue, ourOutstanding, theirBalance, residual,
        },
    };
}
