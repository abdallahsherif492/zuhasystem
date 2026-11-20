/**
 * Text into Arabic with Google Translate's public endpoint, for product names
 * that have no Arabic description. What it cannot translate comes back as it
 * was, so nothing waits on it.
 */
export async function translateToArabic(text: string): Promise<string> {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return text;
        const data = await res.json() as unknown;
        const parts = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as unknown[][]) : [];
        const out = parts.map(p => (typeof p?.[0] === "string" ? p[0] : "")).join("").trim();
        return out || text;
    } catch {
        return text;
    }
}
