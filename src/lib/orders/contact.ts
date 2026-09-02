/**
 * Reaching the customer from an order card.
 *
 * A phone field is typed by whoever took the order, so it holds whatever they
 * had: two numbers separated by a slash, a landline with an area code, spaces,
 * Arabic-Indic digits. A tel: link built from that string dials nothing, which
 * is how a call button ends up looking present and being useless.
 */

/** Arabic-Indic digits are digits; everything else is a separator. */
const toAscii = (s: string) =>
    (s || "")
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));

/**
 * Every number in a phone field, split apart and cleaned.
 *
 * Seven digits is the shortest real Egyptian landline, so anything below that
 * is a fragment rather than a number and is dropped instead of dialled.
 */
export function phoneNumbers(raw: string | null | undefined): string[] {
    return toAscii(raw || "")
        .split(/[^0-9]+/)
        .map(x => x.trim())
        .filter(x => x.length >= 7);
}

/**
 * WhatsApp link for a number, or null when it cannot be one.
 *
 * Only an Egyptian mobile — 01 followed by nine digits — is offered. A landline
 * has no WhatsApp, and guessing a country code for anything else produces a
 * link to a stranger.
 */
export function whatsappLink(num: string, text?: string): string | null {
    const n = toAscii(num).replace(/\D/g, "");
    if (!/^01\d{9}$/.test(n)) return null;
    const url = `https://wa.me/2${n}`;
    return text ? `${url}?text=${encodeURIComponent(text)}` : url;
}

export const telLink = (num: string) => `tel:${toAscii(num).replace(/[^\d+]/g, "")}`;

export interface ConfirmationOrder {
    id: string;
    total_amount: number | null;
    paid_amount?: number | null;
    customer_info: any;
    order_items?: {
        quantity: number | null;
        unmapped_name?: string | null;
        variants?: { title?: string | null; products?: { name?: string | null } | null } | null;
    }[] | null;
}

const money = (n: number) =>
    `${Math.round(n).toLocaleString("en-US")} جنيه`;

/**
 * The confirmation message a moderator sends after the call.
 *
 * Written to be read back against, not just received: the customer checks the
 * address and the items and says yes, and the moderator has that in writing.
 * The order number is the eight-character reference the rest of the system
 * shows, so a reply quoting it can be found.
 *
 * Names the outstanding amount rather than the total whenever a deposit has
 * been taken — telling someone who already paid 100 that they owe the full 500
 * on delivery is how a parcel gets refused at the door.
 */
export function confirmationMessage(order: ConfirmationOrder, storeName: string): string {
    const info = order.customer_info || {};
    const name = (info.name || "").trim();
    const total = Number(order.total_amount) || 0;
    const paid = Number(order.paid_amount) || 0;
    const due = Math.max(total - paid, 0);

    const items = (order.order_items || []).map(it => {
        const label = it.variants?.products?.name
            ? `${it.variants.products.name}${it.variants.title ? ` - ${it.variants.title}` : ""}`
            : (it.unmapped_name || "منتج");
        const qty = Number(it.quantity) || 1;
        return `• ${label}${qty > 1 ? ` × ${qty}` : ""}`;
    });

    const address = [info.address, info.governorate].filter(Boolean).join(" - ");

    const lines = [
        `أهلاً${name ? ` ${name}` : ""} 👋`,
        `تم تأكيد طلبك من ${storeName}.`,
        "",
        `رقم الطلب: ${order.id.slice(0, 8).toUpperCase()}`,
    ];

    if (items.length) lines.push("", "الطلب:", ...items);
    if (address) lines.push("", `العنوان: ${address}`);

    lines.push("", `الإجمالي: ${money(total)}`);
    if (paid > 0) {
        lines.push(`مدفوع مقدماً: ${money(paid)}`, `المطلوب عند الاستلام: ${money(due)}`);
    }

    lines.push(
        "",
        "هيتم الشحن خلال 2 إلى 4 أيام عمل، وهيتواصل معك المندوب قبل التسليم.",
        "لو فيه أي تعديل في العنوان أو الطلب ابعتلنا هنا في أي وقت 🌸",
    );

    return lines.join("\n");
}
