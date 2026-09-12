/**
 * The net profit of one order, after its share of everything the business pays.
 *
 * orders.profit is total − goods − courier: a gross margin that ignores ads,
 * salaries, rent and returns, and that reports a profit on a returned order
 * whose money never arrived. Summed over June–August it said 879,933 EGP; the
 * business actually netted 21,495 on those orders.
 *
 * Here every order carries its share of the month's costs — ads, operating
 * expenses and damages, divided across the month's confirmed orders, the same
 * way the expenses page computes cost per order — and each status is treated
 * for what it is:
 *
 *   delivered   what the customer paid, less goods, courier, collection fee, share
 *   returned    whatever deposit was kept, less the courier's return fee and the
 *               share; the goods too, if they did not go back on the shelf
 *   in transit  projected as if delivered, and marked so, since it is not final
 *   cancelled   nothing — no goods moved and it is not counted in the share
 *
 * Summed over a month these add up to that month's P&L, which is the test that
 * the number means what it says.
 */

export interface OverheadRow {
    month: string;               // first day of the month
    confirmed_count: number;
    overhead_total: number;
    per_order: number | null;
    is_complete: boolean;
}

export interface CourierFees {
    id: string;
    return_fee?: number | null;
    return_fee_percent?: number | null;
    cod_fee_percent?: number | null;
}

export interface NetProfitInput {
    status: string | null;
    total_amount: number | null;
    total_cost: number | null;
    actual_shipping_cost?: number | null;
    paid_amount?: number | null;
    created_at: string;
    shipping_company_id?: string | null;
    restock_on_return?: boolean | null;
}

export interface NetProfit {
    kind: "final" | "projected" | "none";
    value: number;
    /** Each term, in the order it is applied, so the number can be checked. */
    parts: { label: string; amount: number }[];
    /** The courier has no return fee configured, so the full rate was used. */
    returnFeeAssumed?: boolean;
}

const num = (v: unknown) => Number(v) || 0;
const norm = (s: string | null) => (s || "").trim().toLowerCase();

const DELIVERED = new Set(["collected", "delivered"]);
const NOT_CONFIRMED = new Set(["waiting", "cancelled"]);

/**
 * Month → cost share per order.
 *
 * A month that has not closed has not had its salaries and rent booked, so its
 * own rate would be far too low and every recent order would look profitable.
 * Those months use the average of the last three closed months instead.
 */
export function overheadRateFor(rows: OverheadRow[]): (createdAt: string) => number {
    const byMonth = new Map(rows.map(r => [String(r.month).slice(0, 7), r]));
    const closed = rows.filter(r => r.is_complete && num(r.confirmed_count) > 0)
        .sort((a, b) => String(a.month).localeCompare(String(b.month)))
        .slice(-3);
    const trailing = closed.length
        ? closed.reduce((a, r) => a + num(r.overhead_total), 0) / closed.reduce((a, r) => a + num(r.confirmed_count), 0)
        : 0;

    return (createdAt: string) => {
        const r = byMonth.get(String(createdAt).slice(0, 7));
        if (!r || !r.is_complete || !num(r.confirmed_count)) return trailing;
        return num(r.overhead_total) / num(r.confirmed_count);
    };
}

export function orderNetProfit(
    o: NetProfitInput,
    rateFor: (createdAt: string) => number,
    courier?: CourierFees | null,
): NetProfit {
    const status = norm(o.status);
    if (NOT_CONFIRMED.has(status)) return { kind: "none", value: 0, parts: [] };

    const share = rateFor(o.created_at);
    const total = num(o.total_amount);
    const goods = num(o.total_cost);
    const ship = num(o.actual_shipping_cost);
    const paid = num(o.paid_amount);

    if (status === "returned") {
        const flat = num(courier?.return_fee);
        const pct = num(courier?.return_fee_percent);
        // No fee configured means nobody has told the system what the courier
        // charges. Assume the full outbound rate rather than zero: a return
        // that looks free is the one mistake this column must not make.
        const assumed = flat === 0 && pct === 0;
        const fee = assumed ? ship : flat + ship * pct / 100;
        const parts = [
            { label: "عربون اتاخد", amount: paid },
            { label: assumed ? "رسوم الإرجاع (سعر الشحن كامل)" : "رسوم الإرجاع", amount: -fee },
        ];
        // restock_on_return = false: the goods came back unusable or were
        // written off, so their cost is lost as well.
        if (o.restock_on_return === false) parts.push({ label: "بضاعة مارجعتش للمخزون", amount: -goods });
        parts.push({ label: "نصيبه من المصاريف", amount: -share });
        return { kind: "final", value: parts.reduce((a, p) => a + p.amount, 0), parts, returnFeeAssumed: assumed };
    }

    // Delivered, or still on its way and projected as if it will be.
    const cod = Math.max(total - paid, 0) * num(courier?.cod_fee_percent) / 100;
    const parts = [
        { label: "قيمة الأوردر", amount: total },
        { label: "تكلفة البضاعة", amount: -goods },
        { label: "شركة الشحن", amount: -ship },
        ...(cod ? [{ label: "عمولة التحصيل", amount: -cod }] : []),
        { label: "نصيبه من المصاريف", amount: -share },
    ];
    return {
        kind: DELIVERED.has(status) ? "final" : "projected",
        value: parts.reduce((a, p) => a + p.amount, 0),
        parts,
    };
}
