/**
 * EasyOrders rates every order's customer on how likely they are to accept
 * the parcel, from their history across EasyOrders stores. It arrives in the
 * order's `metadata`, keyed by the customer's phone:
 *
 *   { "01013640177": { delivery_rate_status: "completed", rate_result: "high" }, tracking: {...} }
 *
 * The rating can still be running when the order is placed; then it is
 * fetched later from the order API. It is kept on the order as
 * `customer_info.delivery_rate`, so it needs no column of its own.
 */

export type DeliveryRate = "high" | "moderate" | "low" | "unknown";

const RATES: DeliveryRate[] = ["high", "moderate", "low", "unknown"];

/** The rating in an EasyOrders order's metadata, or null while it is not ready. */
export function readDeliveryRate(metadata: unknown): DeliveryRate | null {
    if (!metadata || typeof metadata !== "object") return null;
    for (const [key, entry] of Object.entries(metadata as Record<string, unknown>)) {
        if (key === "tracking" || !entry || typeof entry !== "object") continue;
        const e = entry as { delivery_rate_status?: unknown; rate_result?: unknown };
        if (e.rate_result === undefined) continue;
        if (e.delivery_rate_status && e.delivery_rate_status !== "completed") return null;
        const r = String(e.rate_result).toLowerCase() as DeliveryRate;
        return RATES.includes(r) ? r : "unknown";
    }
    return null;
}

export function deliveryRateOf(customerInfo: unknown): DeliveryRate | null {
    const r = (customerInfo as { delivery_rate?: unknown } | null)?.delivery_rate;
    return RATES.includes(r as DeliveryRate) ? (r as DeliveryRate) : null;
}
