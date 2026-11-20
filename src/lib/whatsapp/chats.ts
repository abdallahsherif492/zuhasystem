/**
 * The conversations page's model: messages grouped into one chat per
 * customer, and what each chat needs to show (who wrote last, how many are
 * waiting, whether the 24-hour window for free text is open).
 */

export interface WaMessage {
    id: string;
    business_id: string;
    wa_message_id: string | null;
    direction: "in" | "out";
    customer_phone: string;
    contact_name: string | null;
    type: string;
    body: string | null;
    media_id: string | null;
    media_mime: string | null;
    context_id?: string | null;
    payload?: { params?: string[]; buttons?: string[]; header_image?: string | null; reaction?: { emoji: string; message_id: string }; location?: { latitude: number; longitude: number }; document?: { filename?: string } } | null;
    template_name: string | null;
    status: string;
    error: unknown;
    sent_by: string | null;
    order_id: string | null;
    sent_at: string;
}

export interface Chat {
    phone: string;
    name: string | null;
    last: WaMessage;
    /** Customer messages since our last reply. */
    waiting: number;
    /** Customer messages nobody on the team opened yet. */
    unread: number;
    lastIn: WaMessage | null;
    mine: boolean;
}

const DAY = 24 * 3_600_000;

export function chatsOf(messages: WaMessage[], me: string | null): Chat[] {
    const by = new Map<string, WaMessage[]>();
    for (const m of messages) {
        if (m.type === "reaction") continue;
        const list = by.get(m.customer_phone) || [];
        list.push(m);
        by.set(m.customer_phone, list);
    }
    const out: Chat[] = [];
    for (const [phone, list] of by) {
        list.sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at));
        const last = list[list.length - 1];
        let waiting = 0;
        for (let i = list.length - 1; i >= 0 && list[i].direction === "in"; i--) waiting++;
        const unread = list.filter(m => m.direction === "in" && m.status === "received").length;
        const lastIn = [...list].reverse().find(m => m.direction === "in") || null;
        const name = [...list].reverse().find(m => m.contact_name)?.contact_name || null;
        const mine = !!me && list.some(m => m.direction === "out" && m.sent_by?.toLowerCase() === me.toLowerCase());
        out.push({ phone, name, last, waiting, unread, lastIn, mine });
    }
    return out.sort((a, b) => Date.parse(b.last.sent_at) - Date.parse(a.last.sent_at));
}

/** Until when free text can be sent: 24 hours after the customer last wrote. */
export function windowUntil(chat: Pick<Chat, "lastIn">): number | null {
    if (!chat.lastIn) return null;
    return Date.parse(chat.lastIn.sent_at) + DAY;
}

export const preview = (m: WaMessage) =>
    m.body || ({ image: "📷 صورة", audio: "🎤 رسالة صوتية", video: "🎬 فيديو", document: "📄 ملف", sticker: "ملصق", location: "📍 موقع" } as Record<string, string>)[m.type] || "رسالة";

/** Replies the team sends most, one tap each. */
export const QUICK_REPLIES = [
    "تمام، طلبك اتأكد وهيتشحن قريب 🌸",
    "العنوان ده مظبوط؟ ابعتلنا علامة مميزة جنبه لو سمحت.",
    "الطلب ده محتاج ديبوزت قبل الشحن. تحب نبعتلك تفاصيل التحويل؟",
    "هنبلّغ المندوب بالميعاد اللي يناسبك.",
    "تحت أمرك في أي وقت 🌸",
];
