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
    payload?: { params?: string[]; buttons?: string[]; header_image?: string | null; cards?: { image: string; title: string; price: number; old_price: number; variant_id: string }[]; event?: string; reaction?: { emoji: string; message_id: string }; location?: { latitude: number; longitude: number }; document?: { filename?: string } } | null;
    template_name: string | null;
    status: string;
    error: unknown;
    sent_by: string | null;
    order_id: string | null;
    sent_at: string;
}

/**
 * The id behind a button the customer tapped: a reply button's
 * (interactive.button_reply.id), or a template's or a carousel card's
 * quick reply (button.payload).
 */
export function tappedButtonId(payload: unknown): string {
    const p = payload as { interactive?: { button_reply?: { id?: string } }; button?: { payload?: string } } | null;
    return p?.interactive?.button_reply?.id || p?.button?.payload || "";
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
    /** What the last template we sent was about: the confirmation, or a shipping problem. */
    topic: "confirm" | "shipping" | null;
}

const CONFIRM = new Set(["order_confirm", "order_confirm_photo", "order_confirmation", "confirmation_reminder"]);
const SHIPPING_PROBLEM = new Set(["delivery_failed", "delivery_failed_photo", "order_returning", "order_returning_photo"]);

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
        const lastT = [...list].reverse().find(m => m.direction === "out" && m.template_name);
        const tName = lastT?.template_name || "", ev = lastT?.payload?.event || "";
        const topic = CONFIRM.has(tName) || ev === "confirm" || ev === "reminder" ? "confirm"
            : SHIPPING_PROBLEM.has(tName) || ev === "hold" || ev === "returning" ? "shipping" : null;
        out.push({ phone, name, last, waiting, unread, lastIn, mine, topic });
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

const TOPIC_CONFIRM = new Set(["order_confirm", "order_confirm_photo", "order_confirmation", "confirmation_reminder"]);
const TOPIC_SHIPPING = new Set(["delivery_failed", "delivery_failed_photo", "order_returning", "order_returning_photo"]);
const topicOf = (m: Pick<WaMessage, "template_name" | "payload">): Chat["topic"] => {
    const ev = m.payload?.event || "";
    if (TOPIC_CONFIRM.has(m.template_name || "") || ev === "confirm" || ev === "reminder") return "confirm";
    if (TOPIC_SHIPPING.has(m.template_name || "") || ev === "hold" || ev === "returning") return "shipping";
    return null;
};

/** A row of whatsapp_chat_list (20261129): one chat, worked out in the database. */
export interface ChatListRow {
    customer_phone: string; contact_name: string | null; last: WaMessage;
    waiting: number; unread: number; mine: boolean; last_in_at: string | null; topic: Chat["topic"];
}
export const chatFromRow = (r: ChatListRow): Chat => ({
    phone: r.customer_phone, name: r.contact_name, last: r.last, waiting: r.waiting, unread: r.unread, mine: r.mine,
    lastIn: r.last_in_at ? ({ sent_at: r.last_in_at } as WaMessage) : null, topic: r.topic,
});

/**
 * A message from the live feed applied to the chats list, without reading
 * anything again: a new message moves its chat to the top and updates what
 * is waiting and unread; a changed one (ticks, read) updates its counts.
 */
export function applyToChats(chats: Chat[], m: WaMessage, isNew: boolean, me: string | null): Chat[] {
    if (m.type === "reaction") return chats;
    const i = chats.findIndex(c => c.phone === m.customer_phone);
    const c: Chat = i === -1
        ? { phone: m.customer_phone, name: m.contact_name, last: m, waiting: 0, unread: 0, lastIn: null, mine: false, topic: null }
        : { ...chats[i] };
    if (isNew) {
        const before = i === -1 ? null : chats[i].last.direction;
        if (Date.parse(m.sent_at) >= Date.parse(c.last.sent_at) || i === -1) c.last = m;
        if (m.direction === "in") {
            // Waiting: customer messages since our last reply.
            c.waiting = before === "in" ? c.waiting + 1 : 1;
            if (m.status === "received") c.unread += 1;
            c.lastIn = m;
            if (m.contact_name) c.name = m.contact_name;
        } else {
            c.waiting = 0;
            if (me && m.sent_by?.toLowerCase() === me) c.mine = true;
            if (m.template_name) c.topic = topicOf(m) ?? c.topic;
        }
    } else {
        if (c.last.id === m.id) c.last = { ...c.last, ...m };
        if (m.direction === "in" && m.status === "read" && c.unread > 0) c.unread -= 1;
    }
    const rest = i === -1 ? chats : chats.filter((_, j) => j !== i);
    return isNew ? [c, ...rest] : chats.map((x, j) => (j === i ? c : x));
}
