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
        variants?: { title?: string | null; products?: { name?: string | null; description?: string | null } | null } | null;
    }[] | null;
}

const money = (n: number) =>
    `${Math.round(n).toLocaleString("en-US")} جنيه`;

/**
 * The message a moderator sends on WhatsApp asking the customer to confirm:
 * a greeting from the store, what they ordered in Arabic with how many of
 * each, what they pay, and to reply «تأكيد». Short on purpose, so it is read.
 *
 * `labels` are the items' Arabic names (lib/orders/arabic-names.ts), in the
 * order of order_items. With a deposit taken it says what is left to pay:
 * telling someone who paid 100 that they owe the full 500 gets a parcel
 * refused at the door.
 */
export function confirmationMessage(order: ConfirmationOrder, storeName: string, labels?: string[]): string {
    const info = order.customer_info || {};
    const first = String(info.name || "").trim().split(/\s+/)[0] || "";
    const total = Number(order.total_amount) || 0;
    const paid = Number(order.paid_amount) || 0;
    const due = Math.max(total - paid, 0);

    const items = (order.order_items || []).map((it, i) => {
        const label = labels?.[i] || it.variants?.products?.name || it.unmapped_name || "منتج";
        return `• ${label} (عدد ${Number(it.quantity) || 1})`;
    });

    const lines = [`أهلاً${first ? ` ${first}` : ""} 👋`, `شكراً إنك طلبت من ${storeName}.`, "", "برجاء تأكيد طلبك:"];
    lines.push(...items);
    lines.push("", paid > 0
        ? `المطلوب عند الاستلام: ${money(due)} (دفعت ${money(paid)} مقدّم)`
        : `الإجمالي عند الاستلام: ${money(total)}`);
    lines.push("", "الرجاء الرد بكلمة «تأكيد» لتأكيد الأوردر.");
    return lines.join("\n");
}
