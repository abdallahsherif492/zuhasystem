/**
 * Where each Waiting order stands in the confirmation queue, worked out from
 * its attempts (20261006_confirmation_attempts.sql) and the time it is due to
 * be called again (20261119_confirm_queue.sql).
 *
 *   now        call it now: new, or its next try is due
 *   scheduled  a time is set: "call me later", WhatsApp sent, or a retry not due yet
 *   customer   the customer is deciding (thinking, wants changes, price) — back in a day
 *   decide     4 tries without an answer, or a wrong number: cancel or one last try
 *   old        older than 3 days and never called — left alone for now
 *
 * The rules match record_confirmation_attempt, so a page running before the
 * migration (no next_attempt_at yet) still sorts orders the same way.
 */

export type QueueState = "now" | "scheduled" | "customer" | "decide" | "old";

export interface QueueOrder {
    created_at: string;
    confirm_attempts?: number | null;
    last_attempt_at?: string | null;
    last_attempt_reason?: string | null;
    next_attempt_at?: string | null;
    claimed_by?: string | null;
    claimed_at?: string | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Tries without an answer before the order needs a decision. */
export const DECIDE_AT = 4;
/** A new order no one called for this long is "old". */
export const OLD_AFTER_MS = 3 * DAY;
/** A claim nobody refreshed is free again after this. */
export const CLAIM_MS = 10 * 60_000;

const WAITING_ON_CUSTOMER = new Set(["thinking", "wants_changes", "price"]);

/** When the order is due again, by the same rules as the database. */
export function nextAttemptAt(o: QueueOrder): number | null {
    const n = o.confirm_attempts ?? 0;
    if (n === 0) return Date.parse(o.created_at);
    // undefined: the column is not there yet (migration not run); compute it.
    if (o.next_attempt_at !== undefined) return o.next_attempt_at ? Date.parse(o.next_attempt_at) : null;
    const last = o.last_attempt_at ? Date.parse(o.last_attempt_at) : Date.parse(o.created_at);
    const r = o.last_attempt_reason;
    if (r === "wrong_number") return null;
    if (r === "call_later") return last + 3 * HOUR;
    if (r === "whatsapp_pending") return last + 2 * HOUR;
    if (r && WAITING_ON_CUSTOMER.has(r)) return last + DAY;
    if (n === 1) return last + HOUR;
    if (n === 2) return last + 3 * HOUR;
    if (n === 3) return last + DAY;
    return null;
}

export function queueStateOf(o: QueueOrder, now = Date.now()): QueueState {
    const n = o.confirm_attempts ?? 0;
    if (n === 0) return now - Date.parse(o.created_at) > OLD_AFTER_MS ? "old" : "now";
    // No next time: a wrong number, or the 4th try without an answer. A
    // customer who set a time, or was sent a WhatsApp, keeps theirs.
    const at = nextAttemptAt(o);
    if (at === null) return "decide";
    if (at <= now) return "now";
    return o.last_attempt_reason && WAITING_ON_CUSTOMER.has(o.last_attempt_reason) ? "customer" : "scheduled";
}

/** Oldest-due first: whoever has waited longest gets the next call. */
export function byDue(a: QueueOrder, b: QueueOrder) {
    return (nextAttemptAt(a) ?? Infinity) - (nextAttemptAt(b) ?? Infinity);
}

export const QUEUE_TABS: { key: QueueState; label: string }[] = [
    { key: "now", label: "اتصل دلوقتي" },
    { key: "scheduled", label: "ليهم ميعاد" },
    { key: "customer", label: "مستني العميل" },
    { key: "decide", label: "محتاج قرار" },
    { key: "old", label: "قديم" },
];

/** Who holds the order, if it is someone else and the claim is fresh. */
export function claimedByOther(o: QueueOrder, me: string | null | undefined, now = Date.now()): string | null {
    if (!o.claimed_by || !o.claimed_at) return null;
    if (me && o.claimed_by.toLowerCase() === me.toLowerCase()) return null;
    return now - Date.parse(o.claimed_at) < CLAIM_MS ? o.claimed_by : null;
}

export const isMine = (o: QueueOrder, me: string | null | undefined, now = Date.now()) =>
    !!(o.claimed_by && me && o.claimed_by.toLowerCase() === me.toLowerCase() && o.claimed_at && now - Date.parse(o.claimed_at) < CLAIM_MS);

export const shortName = (email: string | null | undefined) => (email ? email.split("@")[0] : "");

/** "3:40 م" in Cairo time, with "بكرة" or the day when it is not today. */
export function clockLabel(ms: number, now = Date.now()) {
    const tz = "Africa/Cairo";
    const day = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: tz });
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(ms));
    const h = parts.find(p => p.type === "hour")?.value ?? "";
    const m = parts.find(p => p.type === "minute")?.value ?? "";
    const pm = parts.find(p => p.type === "dayPeriod")?.value?.toUpperCase() === "PM";
    const time = `${h}:${m} ${pm ? "م" : "ص"}`;
    if (day(ms) === day(now)) return time;
    if (day(ms) === day(now + DAY)) return `بكرة ${time}`;
    return `${new Date(ms).toLocaleDateString("ar-EG-u-nu-latn", { timeZone: tz, weekday: "long", day: "numeric", month: "numeric" })} ${time}`;
}

/** "بعد 40 دقيقة" / "بعد 3 ساعات" / "بكرة 11:00 ص". */
export function dueLabel(ms: number, now = Date.now()) {
    const diff = ms - now;
    if (diff <= 0) return "دلوقتي";
    const min = Math.round(diff / 60_000);
    if (min < 60) return `بعد ${min} دقيقة`;
    if (diff < 6 * HOUR) {
        const h = Math.round(diff / HOUR);
        return h === 1 ? "بعد ساعة" : h === 2 ? "بعد ساعتين" : `بعد ${h} ساعات`;
    }
    return clockLabel(ms, now);
}

/** Times offered for "call me later", as timestamps from now. */
export function callLaterChoices(now = Date.now()): { label: string; at: number }[] {
    const cairoHour = (t: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", hour: "numeric", hour12: false }).format(new Date(t))) % 24;
    // The next time the Cairo clock shows `hour`:00, starting from `from`.
    const nextAt = (hour: number, from: number) => {
        const start = Math.ceil(from / HOUR) * HOUR;
        for (let t = start; t < start + 2 * DAY; t += HOUR) if (cairoHour(t) === hour) return t;
        return from + DAY;
    };
    const out = [
        { label: "بعد ساعة", at: now + HOUR },
        { label: "بعد 3 ساعات", at: now + 3 * HOUR },
    ];
    const evening = nextAt(20, now);
    if (evening - now < 20 * HOUR && evening - now > 3.5 * HOUR) out.push({ label: `بالليل ${clockLabel(evening, now)}`, at: evening });
    const morning = nextAt(11, now + 6 * HOUR);
    out.push({ label: clockLabel(morning, now), at: morning });
    return out;
}

/** What the order's card says about the next try, after an attempt is saved. */
export function nextTryToast(o: QueueOrder) {
    const st = queueStateOf(o);
    if (st === "decide") return o.last_attempt_reason === "wrong_number"
        ? "اتسجلت. الرقم غلط — الأوردر في «محتاج قرار»."
        : `اتسجلت. ${o.confirm_attempts} محاولات من غير رد — الأوردر في «محتاج قرار».`;
    const at = nextAttemptAt(o);
    return at ? `اتسجلت. هيرجعلك ${dueLabel(at)}.` : "اتسجلت.";
}
