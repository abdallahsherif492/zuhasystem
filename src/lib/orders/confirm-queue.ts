/**
 * The confirmation flow: every Waiting store order is at one of three steps,
 * each with what to do and what can happen (20261120_confirm_flow.sql).
 *
 *   step 1, new            call twice; no answer -> send a WhatsApp
 *   step 2, WhatsApp sent  4 hours later: check the WhatsApp, else call twice
 *   step 3, last chance    the next morning: check, call twice, else cancel
 *
 * The step is the number of times the customer did not answer
 * (orders.confirm_rounds): 0, 1, 2 or more. A wrong number, or an order older
 * than 3 days, is at the last step whatever it had. Anything else the
 * customer said ("call me at 8", "will send the deposit") keeps the step and
 * sets the time.
 *
 * No order leaves the queue while it is Waiting: an order whose time has come
 * stays in its step's list until someone calls, and one with a time to come is
 * under "scheduled". The rules match record_confirmation_attempt, so a page
 * running before the migration still sorts orders the same way.
 */

export type FlowStep = 1 | 2 | 3;
export type QueueState = "new" | "whatsapp" | "last" | "scheduled";

export interface QueueOrder {
    created_at: string;
    confirm_attempts?: number | null;
    last_attempt_at?: string | null;
    last_attempt_reason?: string | null;
    last_attempt_note?: string | null;
    next_attempt_at?: string | null;
    claimed_by?: string | null;
    claimed_at?: string | null;
    // 20261120_confirm_flow.sql
    confirm_rounds?: number | null;
    whatsapp_sent_by?: string | null;
    whatsapp_sent_at?: string | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** An order this old is at its last chance, however many tries it had. */
export const LAST_CHANCE_AFTER_MS = 3 * DAY;
/** A claim nobody refreshed is free again after this. */
export const CLAIM_MS = 10 * 60_000;

/** Attempts where the customer did not answer: each one moves the order a step on. */
export const ROUND_REASONS = new Set(["no_answer", "phone_off", "whatsapp_pending", "no_reply"]);
const WAITING_ON_CUSTOMER = new Set(["thinking", "wants_changes", "price"]);

/** Times the customer did not answer. Before the migration: every attempt but the last if it was not one. */
export function roundsOf(o: QueueOrder): number {
    if (o.confirm_rounds !== undefined && o.confirm_rounds !== null) return o.confirm_rounds;
    const n = o.confirm_attempts ?? 0;
    return o.last_attempt_reason && !ROUND_REASONS.has(o.last_attempt_reason) ? Math.max(0, n - 1) : n;
}

export function stepOf(o: QueueOrder, now = Date.now()): FlowStep {
    const r = roundsOf(o);
    if (r >= 2 || o.last_attempt_reason === "wrong_number") return 3;
    if (now - Date.parse(o.created_at) > LAST_CHANCE_AFTER_MS) return 3;
    return r === 1 ? 2 : 1;
}

/** When the order is due again; never null, so no order is left out. */
export function nextAttemptAt(o: QueueOrder): number {
    const n = o.confirm_attempts ?? 0;
    const created = Date.parse(o.created_at);
    if (n === 0) return created;
    const last = o.last_attempt_at ? Date.parse(o.last_attempt_at) : created;
    // undefined: the column is not there yet (migration not run); compute it.
    if (o.next_attempt_at !== undefined) return o.next_attempt_at ? Date.parse(o.next_attempt_at) : last;
    const r = o.last_attempt_reason;
    if (r === "wrong_number") return last;
    if (r === "call_later" || r === "deposit_pending") return last + 3 * HOUR;
    if (r === "whatsapp_pending") return last + 2 * HOUR;
    if (r && WAITING_ON_CUSTOMER.has(r)) return last + DAY;
    if (n === 1) return last + HOUR;
    if (n === 2) return last + 3 * HOUR;
    if (n === 3) return last + DAY;
    return last;
}

export function queueStateOf(o: QueueOrder, now = Date.now()): QueueState {
    if (nextAttemptAt(o) > now) return "scheduled";
    const step = stepOf(o, now);
    return step === 1 ? "new" : step === 2 ? "whatsapp" : "last";
}

/** Oldest-due first: whoever has waited longest gets the next call. */
export function byDue(a: QueueOrder, b: QueueOrder) {
    return nextAttemptAt(a) - nextAttemptAt(b);
}

export const QUEUE_TABS: { key: QueueState; label: string }[] = [
    { key: "new", label: "جديد" },
    { key: "whatsapp", label: "بعتلهم واتساب" },
    { key: "last", label: "آخر فرصة" },
    { key: "scheduled", label: "ليهم ميعاد" },
];

/** The order the "next" button works through the lists in. */
export const DUE_STATES: QueueState[] = ["new", "whatsapp", "last"];

/** Was a WhatsApp sent? Before the migration: only known if it was the last thing done. */
export const whatsappSent = (o: QueueOrder) =>
    !!o.whatsapp_sent_at || (o.whatsapp_sent_at === undefined && o.last_attempt_reason === "whatsapp_pending");

/** Did the WhatsApp go from someone else's phone? Their email, if so. */
export function whatsappFromOther(o: QueueOrder, me: string | null | undefined): string | null {
    if (!o.whatsapp_sent_by) return null;
    return me && o.whatsapp_sent_by.toLowerCase() === me.toLowerCase() ? null : o.whatsapp_sent_by;
}

/**
 * What to do with the order now: the thing to do first (`title`), then what
 * to do if it does not work (`detail`).
 */
export function instructionFor(o: QueueOrder, me: string | null | undefined, opts: { missed?: boolean } = {}, now = Date.now()): { title: string; detail: string } {
    const step = stepOf(o, now);
    const sent = whatsappSent(o);
    const other = whatsappFromOther(o, me);
    const checkWa = other
        ? `اسأل ${shortName(other)} العميل ردّ على الواتساب ولا لأ.`
        : "شوف العميل ردّ على الواتساب ولا لأ.";
    const ifNot = step === 3
        ? (sent ? "لو مردش اتصل بيه مرتين، ولو مفيش رد الغي الأوردر." : "لو مفيش رد، ابعتله واتساب والغي الأوردر.")
        : step === 2 && sent ? "لو مردش، اتصل بيه مرتين." : "لو مردش، ابعتله واتساب.";

    // Something the customer said last time comes first.
    switch (o.last_attempt_reason) {
        case "call_later": return { title: "العميل طلب نكلمه في الميعاد ده. اتصل بيه.", detail: ifNot };
        case "deposit_pending": return { title: "شوف الديبوزت وصل ولا لأ.", detail: `لو وصل أكّد الأوردر. لو موصلش كلّمه، و${ifNot}` };
        case "thinking": return { title: "العميل كان لسه بيفكر. كلّمه تاني.", detail: ifNot };
        case "wants_changes": return { title: "العميل كان عايز يعدّل في الطلب. كلّمه وعدّل وأكّد.", detail: ifNot };
        case "price": return { title: "العميل كان معترض على السعر أو الشحن. كلّمه تاني.", detail: ifNot };
        case "wrong_number": return { title: "الرقم متسجل غلط.", detail: "جرّب أي رقم تاني في الأوردر أو ابعت واتساب. لو مفيش فايدة، الغي الأوردر." };
    }
    if (step === 1) {
        return opts.missed
            ? { title: "العميل ماكملش الطلب على الموقع. كلّمه واسأله لسه عايزه؟", detail: "اتصل مرتين، ولو مردش ابعتله واتساب." }
            : { title: "اتصل بالعميل مرتين.", detail: ifNot };
    }
    if (step === 2) {
        return sent
            ? { title: checkWa, detail: ifNot + (other ? ` الواتساب اتبعت من موبايل ${shortName(other)}.` : "") }
            : { title: "اتصل بالعميل مرتين.", detail: ifNot };
    }
    return sent ? { title: checkWa, detail: ifNot } : { title: "اتصل بالعميل مرتين.", detail: ifNot };
}

export const STEP_NAME: Record<FlowStep, string> = { 1: "جديد", 2: "اتبعتله واتساب", 3: "آخر فرصة" };

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

/** What the moderator is told after an attempt is saved: where the order went. */
export function nextTryToast(o: QueueOrder) {
    const at = nextAttemptAt(o);
    const now = Date.now();
    if (at <= now + 60_000) {
        const step = stepOf(o, now);
        return step === 3 ? "اتسجلت. الأوردر في «آخر فرصة»." : "اتسجلت.";
    }
    const where = stepOf(o, at) === 2 ? "«بعتلهم واتساب»" : stepOf(o, at) === 3 ? "«آخر فرصة»" : "الدور";
    return `اتسجلت. هيرجع ${dueLabel(at, now)} في ${where}.`;
}
