/**
 * The short Arabic name of a product, for a courier.
 *
 * Product names are English catalogue names ("Eccoco Toilet tissue box TT3")
 * and couriers read Arabic, so each product's description holds what the
 * thing is in a few Arabic words, and the waybill and the courier sheet print
 * it beside the name.
 *
 * Only the first line, only if it is actually Arabic, and never long: some
 * descriptions are several lines of ad copy with emoji, and an English one
 * would only repeat the name it sits next to.
 */
const ARABIC = /[؀-ۿ]/;
const MAX = 45;

export function arabicProductLabel(description: string | null | undefined): string | null {
    const first = String(description ?? "")
        .split(/\r?\n/)
        .map(line => line.replace(/\p{Extended_Pictographic}|‍|️/gu, "").replace(/\s+/g, " ").trim())
        .find(Boolean);
    if (!first || !ARABIC.test(first)) return null;
    if (first.length <= MAX) return first;
    const cut = first.slice(0, MAX);
    const space = cut.lastIndexOf(" ");
    return `${(space > 20 ? cut.slice(0, space) : cut).trim()}…`;
}
