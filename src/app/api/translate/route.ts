import { NextResponse } from "next/server";

/**
 * English product names into Arabic, for the confirmation message a
 * moderator sends on WhatsApp (lib/orders/arabic-names.ts). Uses Google
 * Translate's public endpoint; a name it cannot translate comes back as it
 * was, so a message is never held up by this.
 */

const MAX_TEXTS = 30;
const MAX_LEN = 200;

async function translate(text: string): Promise<string> {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return text;
    const data = await res.json() as unknown;
    const parts = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as unknown[][]) : [];
    const out = parts.map(p => (typeof p?.[0] === "string" ? p[0] : "")).join("").trim();
    return out || text;
}

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { texts?: unknown } | null;
    const texts = Array.isArray(body?.texts)
        ? body!.texts.filter((t): t is string => typeof t === "string" && !!t.trim()).slice(0, MAX_TEXTS).map(t => t.slice(0, MAX_LEN))
        : [];
    const translations = await Promise.all(texts.map(t => translate(t).catch(() => t)));
    return NextResponse.json({ translations });
}
