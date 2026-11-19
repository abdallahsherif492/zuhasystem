/**
 * What each product in an order is called in Arabic, short: for the
 * confirmation message sent on WhatsApp.
 *
 * The product's description holds its Arabic name (lib/orders/product-label.ts);
 * the part before any dash is kept ("ثرو بلانكت جامبو فرو بالكرات — ١٧٥×٩٢ سم"
 * becomes "ثرو بلانكت جامبو فرو بالكرات"). A product without one, and an
 * English option name ("Havana"), is translated, with its code ("G22") left
 * out. Translations are remembered on this device.
 */

import { arabicProductLabel } from "@/lib/orders/product-label";

const ARABIC = /[؀-ۿ]/;
const CACHE_KEY = "arabic-names-v1";

export interface NamedItem {
    quantity: number | null;
    unmapped_name?: string | null;
    variants?: { title?: string | null; products?: { name?: string | null; description?: string | null } | null } | null;
}

/** "Multifunctional Grinder G22" -> "Multifunctional Grinder"; sizes after a dash go too. */
export function plainEnglish(name: string): string {
    return name
        .split(/\s[—–-]\s/)[0]
        .replace(/\s+\b(?=[A-Za-z]*\d)[A-Za-z0-9]{2,6}\b\s*$/, "")
        .replace(/\s+/g, " ")
        .trim();
}

const shortArabic = (s: string) => s.split(/\s[—–-]\s/)[0].replace(/…$/, "").trim();

const isDefault = (t: string | null | undefined) => !t || /^default/i.test(t.trim());

function readCache(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
}
function writeCache(c: Record<string, string>) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* private mode */ }
}

/** One label per item, in the order given: "مطحنة بن وتوابل - أسود". */
export async function arabicItemLabels(items: NamedItem[]): Promise<string[]> {
    const cache = readCache();
    const parts = items.map(it => {
        const product = it.variants?.products;
        const fromDescription = arabicProductLabel(product?.description);
        const name = fromDescription ? shortArabic(fromDescription) : plainEnglish(product?.name || it.unmapped_name || "منتج");
        const option = isDefault(it.variants?.title) ? null : String(it.variants!.title).trim();
        return { name, option };
    });

    const needed = [...new Set(parts.flatMap(p => [p.name, p.option]).filter((s): s is string => !!s && !ARABIC.test(s) && !cache[s]))];
    if (needed.length) {
        try {
            const res = await fetch("/api/translate", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ texts: needed }), signal: AbortSignal.timeout(6000),
            });
            const { translations } = await res.json() as { translations: string[] };
            needed.forEach((s, i) => { if (translations[i] && ARABIC.test(translations[i])) cache[s] = translations[i]; });
            writeCache(cache);
        } catch { /* the English name is still a name */ }
    }

    const ar = (s: string) => (ARABIC.test(s) ? s : cache[s] || s);
    return parts.map(p => (p.option ? `${ar(p.name)} - ${ar(p.option)}` : ar(p.name)));
}
