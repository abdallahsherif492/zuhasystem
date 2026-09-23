/**
 * How an order is named in the actions log.
 *
 * The platform-orders screen named orders by their EasyOrders id — a 36
 * character UUID nobody in the team has ever seen — and sometimes without the
 * customer at all, so "Platform Order #3f2a…c91" told you nothing about which
 * order it was. The log now names every order the way the rest of the system
 * does: its eight-character reference, the customer, and the phone, which is
 * what people actually search by.
 */
export function orderLogName(
    orderId: string,
    customer?: { name?: string | null; phone?: string | null } | null,
    prefix = "Order",
): string {
    const name = String(customer?.name || "").trim();
    const phone = String(customer?.phone || "").trim();
    const who = [name, phone].filter(Boolean).join(" · ");
    return `${prefix} #${orderId.slice(0, 8)}${who ? ` (${who})` : ""}`;
}
