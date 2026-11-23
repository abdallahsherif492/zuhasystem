/**
 * Moderators' daily targets, set by what the business needs rather than by
 * what the team usually does (20261113_moderator_daily_targets.sql).
 *
 * Each moderator is measured over their own shift (business_users.shift_start
 * / shift_end / weekend_days, in Cairo time; a shift ending before it starts
 * runs past midnight). What the shift owes is worked out from the shift's
 * hours; what they did counts over the whole day of the shift (creditWindow):
 * Cairo midnight to midnight, or, for a shift past midnight, from its start
 * until just before the next day's shift starts. Four things are asked:
 *
 *  1. Confirmation speed. Every store order must leave Waiting (confirmed or
 *     cancelled) within `confirm_within_hours` of arriving. The work that puts
 *     on a shift is the orders that arrived during it early enough to be due
 *     before it ends, plus the orders already Waiting when it started (no
 *     older than `backlog_days`; older ones are a cleanup job, not a day's
 *     work). The moderator's target is their share of that, by how much of
 *     the staffing on duty during their shift was theirs.
 *  2. Orders from messages: at least `min_message_orders` orders entered by
 *     hand (Facebook, WhatsApp...) and credited to them.
 *  3. Courier follow-up. Every stuck shipment (Returning, Hold to redeliver,
 *     Shipped for `stale_days`+) must be followed up every
 *     `followup_every_days`. The ones due at the start of the shift, shared
 *     like confirmations.
 *  4. Confirmation rate: confirmed ÷ (confirmed + cancelled) of the store
 *     orders they handled, at least `min_confirm_rate`%, once they handled
 *     `min_handled_for_rate` or more.
 *  5. WhatsApp replies: every time a customer writes and no automatic answer
 *     covers it, someone has to reply. Those that came in during the shift
 *     (or were still unanswered when it started), shared like confirmations.
 *
 * Since the company number confirms on its own (Nov 2026), «confirm» counts
 * only the orders that need a call: the number has no WhatsApp, the
 * confirmation never reached them, or they have not answered it after
 * `call_after_hours`. A business without the company number: every order.
 *
 * Monthly bonus (monthBonus): the moderator met every target on
 * `bonus_days_pct`% of the days measured, and `bonus_delivery_rate`% of the
 * orders they confirmed were delivered.
 *
 * A target missed costs the amount set for it (0 = shown, never deducted).
 * Pure: the caller loads the data, so the nightly run and the live view on a
 * moderator's screen compute the same thing.
 */

import { cairoDate, cairoDayStart, nextDay } from "@/lib/cairo-day";

export const DAILY_TARGETS_MIGRATION = "supabase/migrations/20261113_moderator_daily_targets.sql";

export type MetricKey = "confirm" | "messages" | "followups" | "rate" | "whatsapp";

export interface TargetSettings {
    enabled: boolean;
    apply_to_payroll: boolean;
    members: string[];
    confirm_within_hours: number;
    backlog_days: number;
    min_message_orders: number;
    followup_every_days: number;
    stale_days: number;
    min_confirm_rate: number;
    min_handled_for_rate: number;
    deduct_confirm: number;
    deduct_messages: number;
    deduct_followups: number;
    deduct_rate: number;
    monthly_cap: number | null;
    starts_on: string | null;
    /** Minutes of slack before a late arrival or an early leave counts. */
    grace_minutes: number;
    deduct_late: number;
    deduct_early: number;
    deduct_no_clockout: number;
    deduct_no_clockin: number;
    /** An order whose confirmation was not answered after this many hours needs a call. */
    call_after_hours: number;
    deduct_whatsapp: number;
    bonus_amount: number;
    bonus_days_pct: number;
    bonus_delivery_rate: number;
}

export const DEFAULT_SETTINGS: TargetSettings = {
    enabled: false,
    apply_to_payroll: true,
    members: [],
    confirm_within_hours: 2,
    backlog_days: 1,
    min_message_orders: 0,
    followup_every_days: 1,
    stale_days: 5,
    min_confirm_rate: 0,
    min_handled_for_rate: 10,
    deduct_confirm: 0,
    deduct_messages: 0,
    deduct_followups: 0,
    deduct_rate: 0,
    monthly_cap: null,
    starts_on: null,
    grace_minutes: 10,
    deduct_late: 0,
    deduct_early: 0,
    deduct_no_clockout: 0,
    deduct_no_clockin: 0,
    call_after_hours: 3,
    deduct_whatsapp: 0,
    bonus_amount: 0,
    bonus_days_pct: 90,
    bonus_delivery_rate: 82,
};

export const METRIC_LABEL: Record<MetricKey, string> = {
    confirm: "الاتصال باللي محتاجين اتصال",
    whatsapp: "الرد على الواتساب",
    messages: "أوردرات الرسايل وميتا",
    followups: "متابعة الشحن",
    rate: "نسبة التأكيد",
};

export const deductionFor = (s: TargetSettings, k: MetricKey) =>
    Number(k === "confirm" ? s.deduct_confirm : k === "messages" ? s.deduct_messages : k === "followups" ? s.deduct_followups : k === "whatsapp" ? s.deduct_whatsapp : s.deduct_rate) || 0;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface Member {
    user_email: string;
    shift_start: string | null;   // "HH:MM:SS", Cairo
    shift_end: string | null;
    weekend_days: string[] | null; // "Friday", ...
}

/** A store order (EasyOrders, Shopify, or a missed order in the queue). */
export interface StoreOrder {
    id: string;
    created_at: string;
    status: string;
    confirmed_at: string | null;
    confirmed_by: string | null;
    cancelled_at: string | null;
    cancelled_by: string | null;
    /** The status it was cancelled from; only a cancel from Waiting is handling it. */
    cancelled_from: string | null;
    customer_phone?: string | null;
}

/**
 * A WhatsApp message on the company number. Out: sent_by is a person's
 * email, "system" (an automatic answer or template) or null with `by` (a
 * «مش محتاج رد» note).
 */
export interface WaMsg {
    customer_phone: string;
    direction: "in" | "out";
    sent_at: string;
    sent_by: string | null;
    type: string;
    order_id: string | null;
    template_name: string | null;
    status: string;
    error: unknown;
    event: string | null;
    by: string | null;
}

/** An order entered by hand, credited to closed_by. */
export interface ManualOrder { id: string; created_at: string; closed_by: string | null }

/** A shipment stuck with the courier now. */
export interface StuckOrder { id: string; status: string; status_changed_at: string | null }

export interface Followup { order_id: string; created_by: string | null; created_at: string }

export interface Leave { user_email: string; start_time: string | null; end_time: string | null }

/** A logged call on a Waiting order (order_confirmation_attempts). */
export interface Attempt { order_id: string; attempted_by: string | null; created_at: string }

export interface Clocking { user_email: string; date: string; clock_in_time: string | null; clock_out_time: string | null }

/**
 * The clock-in that belongs to the member's shift on `day`: by when it
 * happened, not by attendance_logs.date (My HR files a night clock-in under a
 * "shift date" that can be the day before).
 */
export function clockingFor(member: Member, day: string, clockings: Clocking[]): Clocking | null {
    const mine = clockings.filter(c => c.clock_in_time && c.user_email.toLowerCase() === member.user_email.toLowerCase());
    const sched = scheduledShift(member, day);
    if (sched) {
        const hit = mine.find(c => { const t = Date.parse(c.clock_in_time!); return t >= sched.start - 6 * HOUR && t < sched.end; });
        if (hit) return hit;
    }
    // Not a scheduled day, or far off the schedule: the one clocked in on that Cairo day.
    return mine.find(c => cairoDate(new Date(c.clock_in_time!)) === day
        && !(sched && Date.parse(c.clock_in_time!) >= sched.end)) || null;
}

export interface TargetData {
    members: Member[];
    storeOrders: StoreOrder[];
    manualOrders: ManualOrder[];
    stuck: StuckOrder[];
    followups: Followup[];
    leaves: Leave[];
    attempts: Attempt[];
    /** Clock-ins by Cairo day and email. When present they set the shift. */
    clockings: Clocking[];
    /** The company number's messages (empty when the business has none). */
    whatsapp: WaMsg[];
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOUR = 3_600_000;

const minutesOf = (t: string | null, fallback: number) => {
    if (!t) return fallback;
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
};

export interface Shift { email: string; day: string; start: number; end: number }

/**
 * The member's shift on Cairo day `day`, or null on their weekend. When they
 * clocked in that day, the real hours count rather than the schedule: a
 * schedule can be out of date, a clock-in is what happened.
 */
export function shiftOn(member: Member, day: string, clocking?: Clocking | null): Shift | null {
    const scheduled = scheduledShift(member, day);
    if (clocking?.clock_in_time) {
        const start = Date.parse(clocking.clock_in_time);
        const length = scheduled ? scheduled.end - scheduled.start : 8 * HOUR;
        // Not clocked out (yet, or forgotten): a shift of the usual length, and
        // never ending before the scheduled end (someone who came in early
        // still works until then).
        const end = clocking.clock_out_time ? Date.parse(clocking.clock_out_time) : Math.max(start + length, scheduled?.end ?? 0);
        if (end > start) return { email: member.user_email.toLowerCase(), day, start, end };
    }
    return scheduled;
}

export function scheduledShift(member: Member, day: string): Shift | null {
    const weekday = WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
    if ((member.weekend_days || []).includes(weekday)) return null;
    const startMin = minutesOf(member.shift_start, 9 * 60);
    const endMin = minutesOf(member.shift_end, 17 * 60);
    const dayStart = Date.parse(cairoDayStart(day));
    const start = dayStart + startMin * 60_000;
    let end = Date.parse(cairoDayStart(endMin > startMin ? day : nextDay(day))) + endMin * 60_000;
    if (end <= start) end = start + 8 * HOUR;
    return { email: member.user_email.toLowerCase(), day, start, end };
}

/**
 * The hours whose work counts for the member's shift on `day`: the whole
 * Cairo day, or, for a shift that runs past midnight, from its scheduled
 * start until the same time the next day, just before the next one starts.
 * A real shift reaching outside that (an early clock-in) is covered too.
 */
export function creditWindow(member: Member, day: string, shift?: Shift | null): { start: number; end: number } {
    const startMin = minutesOf(member.shift_start, 9 * 60);
    const endMin = minutesOf(member.shift_end, 17 * 60);
    const dayStart = Date.parse(cairoDayStart(day));
    const next = Date.parse(cairoDayStart(nextDay(day)));
    let start = dayStart;
    let end = next;
    if (endMin <= startMin) {
        start = dayStart + startMin * 60_000;
        end = next + startMin * 60_000;
    }
    if (shift) {
        start = Math.min(start, shift.start);
        end = Math.max(end, shift.end);
    }
    return { start, end };
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// ---------------------------------------------------------------------------
// The scorecard
// ---------------------------------------------------------------------------

export interface MetricResult {
    key: MetricKey;
    /** What the business needed from this shift. null: not asked today. */
    target: number | null;
    done: number;
    met: boolean;
    /** Plain-language account, for the moderator and the manager. */
    detail: string;
    /** For "confirm": what the work was. */
    parts?: { confirmed: number; cancelled: number; attempted: number };
}

export type AttendanceKey = "late" | "early" | "no_clockout" | "no_clockin";

export const ATTENDANCE_LABEL: Record<AttendanceKey, string> = {
    late: "تأخير",
    early: "خروج بدري",
    no_clockout: "نسيان تسجيل الانصراف",
    no_clockin: "من غير تسجيل حضور",
};

export interface Attendance {
    scheduled_start: string;
    scheduled_end: string;
    clock_in: string | null;
    clock_out: string | null;
    late_minutes: number;
    early_minutes: number;
    /** What counted against them, each with what it costs. */
    items: { key: AttendanceKey; amount: number; detail: string }[];
}

export interface Scorecard {
    user_email: string;
    work_date: string;
    shift_start: string;
    shift_end: string;
    /** 'evaluated', 'absent' (no activity at all on a working day), 'leave'. */
    status: "evaluated" | "absent" | "leave";
    share: number;
    metrics: MetricResult[];
    missed: MetricKey[];
    /** Targets missed plus attendance, before any monthly cap. */
    deduction: number;
    attendance: Attendance | null;
    /** Until when this was measured (now, while work still counts). */
    measured_until: string;
    /** The hours whose work counts for this shift (creditWindow). */
    counts_from: string;
    counts_until: string;
}

const attendanceCost = (s: TargetSettings, k: AttendanceKey) =>
    Number(k === "late" ? s.deduct_late : k === "early" ? s.deduct_early : k === "no_clockout" ? s.deduct_no_clockout : s.deduct_no_clockin) || 0;

const mins = (ms: number) => Math.round(ms / 60_000);

/**
 * Late, early or forgotten, against the scheduled shift. While the shift is
 * still running only what has already happened counts (being late); leaving
 * early and forgetting to clock out are known once it ends.
 */
export function attendanceFor(member: Member, day: string, clocking: Clocking | null, settings: TargetSettings, now = Date.now(), worked = true): Attendance | null {
    const sched = scheduledShift(member, day);
    if (!sched) return null;
    const grace = Math.max(0, Number(settings.grace_minutes) || 0) * 60_000;
    const over = now >= sched.end;
    const clockIn = clocking?.clock_in_time ? Date.parse(clocking.clock_in_time) : null;
    const clockOut = clocking?.clock_out_time ? Date.parse(clocking.clock_out_time) : null;
    const out: Attendance = {
        scheduled_start: new Date(sched.start).toISOString(),
        scheduled_end: new Date(sched.end).toISOString(),
        clock_in: clockIn ? new Date(clockIn).toISOString() : null,
        clock_out: clockOut ? new Date(clockOut).toISOString() : null,
        late_minutes: 0, early_minutes: 0, items: [],
    };
    if (clockIn === null) {
        // Only when they worked: a day with no activity at all is for the
        // manager to call (absence or leave), not a missed clock-in.
        if (over && worked) out.items.push({ key: "no_clockin", amount: attendanceCost(settings, "no_clockin"), detail: "اشتغلت من غير ما تسجّل حضور." });
        return out;
    }
    if (clockIn > sched.start + grace) {
        out.late_minutes = mins(clockIn - sched.start);
        out.items.push({ key: "late", amount: attendanceCost(settings, "late"), detail: `سجّلت حضور متأخر ${out.late_minutes} دقيقة.` });
    }
    if (clockOut !== null && clockOut < sched.end - grace) {
        out.early_minutes = mins(sched.end - clockOut);
        out.items.push({ key: "early", amount: attendanceCost(settings, "early"), detail: `سجّلت انصراف قبل آخر الشيفت بـ ${out.early_minutes} دقيقة.` });
    }
    if (clockOut === null && over && now >= sched.end + 30 * 60_000) {
        out.items.push({ key: "no_clockout", amount: attendanceCost(settings, "no_clockout"), detail: "الشيفت خلص ومسجلتش انصراف." });
    }
    return out;
}

const cancelledFromWaiting = (o: StoreOrder) => !!o.cancelled_at && (!o.cancelled_from || o.cancelled_from.toLowerCase() === "waiting");
const handledAt = (o: StoreOrder) => {
    const t = [o.confirmed_at, cancelledFromWaiting(o) ? o.cancelled_at : null].filter(Boolean).map(x => Date.parse(x as string));
    return t.length ? Math.min(...t) : null;
};
const lower = (s: string | null | undefined) => (s || "").toLowerCase();

const last10 = (p: string | null | undefined) => (p || "").replace(/\D/g, "").slice(-10);
const ASK_TEMPLATES = new Set(["order_confirm_v2", "order_confirm", "order_confirm_photo", "order_confirmation", "confirmation_reminder", "confirmation_reminder_v2"]);
const isAsk = (m: WaMsg) => m.direction === "out" && !!m.order_id && (ASK_TEMPLATES.has(m.template_name || "") || m.event === "confirm" || m.event === "reminder");
const noWhatsApp = (m: WaMsg) => m.status === "failed" && JSON.stringify(m.error || "").includes("131026");

/**
 * When a store order came to need a call (null: it never did, the customer
 * answered on WhatsApp). With the company number: when its confirmation
 * failed for a number with no WhatsApp; half an hour after it arrived when no
 * confirmation reached them; `callAfter` after the confirmation when they have
 * not answered by then. Without it: as soon as it arrived.
 */
export function callNeededFrom(o: StoreOrder, data: TargetData, callAfter: number, index = waIndex(data)): number | null {
    const created = Date.parse(o.created_at);
    if (!index.active) return created;
    const asks = index.asks.get(o.id) || [];
    const failed = asks.find(noWhatsApp);
    if (failed) return Date.parse(failed.sent_at);
    const reached = asks.filter(a => a.status !== "failed").map(a => Date.parse(a.sent_at)).sort((a, b) => a - b);
    if (!reached.length) return created + 30 * 60_000;
    const first = reached[0];
    const answered = (index.inbound.get(last10(o.customer_phone)) || []).find(t => t >= first);
    return answered !== undefined && answered < first + callAfter ? null : first + callAfter;
}

/** A customer writing, until someone (or the system) answers. */
export interface Burst { phone: string; start: number; answeredAt: number | null; answeredBy: string | null }

function waIndex(data: TargetData) {
    const asks = new Map<string, WaMsg[]>();
    const inbound = new Map<string, number[]>();
    const byPhone = new Map<string, WaMsg[]>();
    for (const m of data.whatsapp || []) {
        if (m.type === "reaction") continue;
        if (isAsk(m)) { const l = asks.get(m.order_id!) || []; l.push(m); asks.set(m.order_id!, l); }
        const k = last10(m.customer_phone);
        if (m.direction === "in") { const l = inbound.get(k) || []; l.push(Date.parse(m.sent_at)); inbound.set(k, l); }
        const l = byPhone.get(k) || []; l.push(m); byPhone.set(k, l);
    }
    for (const l of inbound.values()) l.sort((a, b) => a - b);
    // Bursts: what a customer sent until the next message of ours. Answered
    // by the system (an automatic reply): no one needed. Answered by a person
    // or a «مش محتاج رد» note: theirs. Never answered: still waiting.
    const bursts: Burst[] = [];
    for (const [phone, list] of byPhone) {
        list.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
        let open: Burst | null = null;
        for (const m of list) {
            if (m.direction === "in") { if (!open) open = { phone, start: Date.parse(m.sent_at), answeredAt: null, answeredBy: null }; continue; }
            if (!open) continue;
            const who = m.sent_by && m.sent_by.includes("@") ? m.sent_by.toLowerCase() : m.type === "note" && m.by ? m.by.toLowerCase() : "system";
            open.answeredAt = Date.parse(m.sent_at);
            open.answeredBy = who;
            bursts.push(open);
            open = null;
        }
        if (open) bursts.push(open);
    }
    return { active: (data.whatsapp || []).some(isAsk), asks, inbound, bursts: bursts.filter(b => b.answeredBy !== "system") };
}

/**
 * Scorecards for every included member working on `day`. With `now` inside a
 * shift, that shift is measured up to now (the live view).
 */
export function scoreDay(day: string, settings: TargetSettings, data: TargetData, now = Date.now()): Scorecard[] {
    const included = new Set(settings.members.map(lower));
    const members = data.members.filter(m => included.has(lower(m.user_email)));
    const memberOf = new Map(members.map(m => [lower(m.user_email), m]));
    const clockOf = (email: string) => { const m = memberOf.get(lower(email)); return m ? clockingFor(m, day, data.clockings) : null; };
    const shifts = members.map(m => shiftOn(m, day, clockOf(m.user_email))).filter((s): s is Shift => !!s && s.start < now);
    const H = Math.max(0, Number(settings.confirm_within_hours) || 0) * HOUR;
    const backlog = Math.max(0, Number(settings.backlog_days) || 0) * 24 * HOUR;
    const followEvery = Math.max(1, Number(settings.followup_every_days) || 1) * 24 * HOUR;
    const callAfter = Math.max(0.5, Number(settings.call_after_hours) || 3) * HOUR;
    const wa = waIndex(data);
    // When each order came to need a call (null: never), worked out once.
    const needFrom = new Map(data.storeOrders.map(o => [o.id, callNeededFrom(o, data, callAfter, wa)]));

    const onLeave = (email: string, s: Shift) => data.leaves.some(l =>
        lower(l.user_email) === email && l.start_time && l.end_time
        && overlap(Date.parse(l.start_time), Date.parse(l.end_time), s.start, s.end) >= (s.end - s.start) / 2);
    const working = shifts.filter(s => !onLeave(s.email, s));

    // Courier follow-up: when, and by whom, each stuck order was followed up.
    const lastFollow = new Map<string, { t: number; by: string }[]>();
    for (const f of data.followups) {
        const list = lastFollow.get(f.order_id) || [];
        list.push({ t: Date.parse(f.created_at), by: lower(f.created_by) });
        lastFollow.set(f.order_id, list);
    }

    return shifts.map(shift => {
        const end = Math.min(shift.end, now);
        const member = memberOf.get(shift.email)!;
        // What they did counts over the whole day of the shift, not only its hours.
        const win = creditWindow(member, day, shift);
        const until = Math.min(win.end, now);
        const base = {
            user_email: shift.email,
            work_date: day,
            shift_start: new Date(shift.start).toISOString(),
            shift_end: new Date(shift.end).toISOString(),
            measured_until: new Date(until).toISOString(),
            counts_from: new Date(win.start).toISOString(),
            counts_until: new Date(win.end).toISOString(),
        };
        if (!working.includes(shift)) {
            return { ...base, status: "leave" as const, share: 0, metrics: [], missed: [], deduction: 0, attendance: null };
        }

        // This moderator's share of the staffing on duty during their shift.
        const mine = end - shift.start;
        const staffed = working.reduce((s, o) => s + overlap(o.start, Math.min(o.end, now), shift.start, end), 0);
        const share = staffed > 0 ? mine / staffed : 1;
        const counts = (t: string | null) => !!t && Date.parse(t) >= win.start && Date.parse(t) < until;

        // 1. Confirmation speed
        const confirmedIds = data.storeOrders.filter(o => lower(o.confirmed_by) === shift.email && counts(o.confirmed_at)).map(o => o.id);
        const cancelledIds = data.storeOrders.filter(o => lower(o.cancelled_by) === shift.email && cancelledFromWaiting(o) && counts(o.cancelled_at)).map(o => o.id);
        const closedIds = new Set([...confirmedIds, ...cancelledIds]);
        // From when each order needed a call (not when it arrived: most are
        // confirmed on WhatsApp and never need one). Closed before that moment
        // (by the customer's answer, or anyone): not needed.
        const needs = (o: StoreOrder) => {
            const a = needFrom.get(o.id);
            if (a === null || a === undefined) return null;
            const h = handledAt(o);
            return h !== null && h < a && !closedIds.has(o.id) ? null : a;
        };
        const arrivedDue = data.storeOrders.filter(o => {
            const a = needs(o);
            return a !== null && a >= shift.start && a + H <= end;
        }).length;
        // Needing a call when the shift started; one they closed themselves
        // earlier that day stays in, since it counts as done.
        const waitingAtStart = data.storeOrders.filter(o => {
            const a = needs(o);
            if (a === null || a >= shift.start || a < shift.start - backlog) return false;
            const h = handledAt(o);
            return h === null || h >= shift.start || closedIds.has(o.id);
        }).length;
        const confirmed = confirmedIds.length;
        const cancelled = cancelledIds.length;
        const handled = confirmed + cancelled;
        // A logged call on an order still Waiting is work done on it too:
        // the customer did not answer, or asked to be called later.
        const calledIds = new Set(data.attempts.filter(t => lower(t.attempted_by) === shift.email && counts(t.created_at) && !closedIds.has(t.order_id)).map(t => t.order_id));
        const worked = handled + calledIds.size;
        const needed = arrivedDue + waitingAtStart;
        const confirmTarget = Math.ceil(needed * share);
        const confirm: MetricResult = {
            key: "confirm", target: confirmTarget, done: worked, met: worked >= confirmTarget,
            parts: { confirmed, cancelled, attempted: calledIds.size },
            detail: `${wa.active ? "اللي محتاجين اتصال (مش عليهم واتساب، أو الرسالة ماوصلتش، أو مردوش عليها)" : "الأوردرات اللي محتاجة تتشتغل"} في الشيفت ${needed} (${waitingAtStart} من قبل الشيفت + ${arrivedDue} جم وعدّى عليهم ${settings.confirm_within_hours} ساعة)، نصيبك ${Math.round(share * 100)}% = ${confirmTarget}. اشتغلت على ${worked}: ${confirmed} تأكيد، ${cancelled} إلغاء، ${calledIds.size} محاولة متسجلة.`,
        };

        // 2. Orders from messages
        const messages = data.manualOrders.filter(o => lower(o.closed_by) === shift.email && counts(o.created_at)).length;
        const minMsg = Math.max(0, Number(settings.min_message_orders) || 0);
        const msg: MetricResult = {
            key: "messages", target: minMsg > 0 ? minMsg : null, done: messages, met: minMsg <= 0 || messages >= minMsg,
            detail: minMsg > 0 ? `المطلوب ${minMsg} أوردر من الرسايل، عملت ${messages}.` : `عملت ${messages} أوردر من الرسايل (مفيش حد أدنى).`,
        };

        // 3. Courier follow-up
        const staleMs = Math.max(0, Number(settings.stale_days) || 0) * 24 * HOUR;
        const stuckIds = new Set(data.stuck
            .filter(o => lower(o.status) !== "shipped" || (o.status_changed_at && Date.parse(o.status_changed_at) <= shift.start - staleMs))
            .map(o => o.id));
        // Due when the shift started; one they followed up themselves earlier
        // that day stays due, since it counts as done.
        const due = [...stuckIds].filter(id => {
            const before = (lastFollow.get(id) || [])
                .filter(f => f.t < shift.start && !(f.by === shift.email && f.t >= win.start)).map(f => f.t);
            return !before.length || Math.max(...before) <= shift.start - followEvery;
        }).length;
        // Every shipment they followed up counts, whatever it is now: one that
        // got delivered or returned since, or one shipped too recently to be
        // "stuck", was still work done. (Counting only the ones stuck right
        // now made the number drop as their shipments moved on.)
        const followed = new Set(data.followups.filter(f => lower(f.created_by) === shift.email && counts(f.created_at)).map(f => f.order_id)).size;
        const followTarget = Math.ceil(due * share);
        const follow: MetricResult = {
            key: "followups", target: followTarget, done: followed, met: followed >= followTarget,
            detail: `${due} شحنة متعطلة كان لازم تتتابع، نصيبك ${followTarget}. تابعت ${followed}.`,
        };

        // 4. Confirmation rate
        const minRate = Math.max(0, Number(settings.min_confirm_rate) || 0);
        const minHandled = Math.max(1, Number(settings.min_handled_for_rate) || 1);
        const rate = handled ? Math.round((confirmed / handled) * 100) : 0;
        // With the company number the easy orders confirm themselves and a
        // person gets the hard ones: their rate falls for no fault of theirs,
        // so it is shown, not asked.
        const asked = minRate > 0 && handled >= minHandled && !wa.active;
        const rateM: MetricResult = {
            key: "rate", target: asked ? minRate : null, done: rate, met: !asked || rate >= minRate,
            detail: minRate <= 0 ? `نسبة التأكيد ${rate}% (مفيش حد أدنى).`
                : wa.active ? `نسبة التأكيد ${rate}% (${confirmed} من ${handled}). للمتابعة بس: السهل بيتأكد لوحده من الواتساب، فاللي بيوصلك الأصعب.`
                : handled < minHandled ? `نسبة التأكيد ${rate}% من ${handled} أوردر، أقل من ${minHandled} فمش محسوبة.`
                : `المطلوب ${minRate}% على الأقل، نسبتك ${rate}% (${confirmed} من ${handled}).`,
        };

        // 5. WhatsApp replies: a customer's messages that needed a person.
        const REPLY_GRACE = 15 * 60_000;
        const chatBacklog = 12 * HOUR;
        const mineAnswered = wa.bursts.filter(b => b.answeredBy === shift.email && b.answeredAt !== null && b.answeredAt >= win.start && b.answeredAt < until);
        const chatsArrived = wa.bursts.filter(b => b.start >= shift.start && b.start + REPLY_GRACE <= end).length;
        const chatsWaiting = wa.bursts.filter(b => b.start < shift.start && b.start >= shift.start - chatBacklog
            && (b.answeredAt === null || b.answeredAt >= shift.start || (b.answeredBy === shift.email && b.answeredAt >= win.start))).length;
        const chatsNeeded = chatsArrived + chatsWaiting;
        const chatTarget = Math.ceil(chatsNeeded * share);
        const replied = mineAnswered.length;
        const waits = mineAnswered.map(b => (b.answeredAt! - b.start) / 60_000).sort((a, b) => a - b);
        const medianWait = waits.length ? Math.round(waits[Math.floor(waits.length / 2)]) : null;
        const whatsapp: MetricResult | null = wa.active ? {
            key: "whatsapp", target: chatTarget, done: replied, met: replied >= chatTarget,
            detail: `${chatsNeeded} مرة عميل كتب ومحتاج رد من حد (${chatsWaiting} مستنيين من قبل الشيفت + ${chatsArrived} في الشيفت)، نصيبك ${chatTarget}. رديت على ${replied}${medianWait !== null ? `، ونص ردودك كانت خلال ${medianWait} دقيقة` : ""}. «مش محتاج رد» بيتحسب رد.`,
        } : null;

        const metrics = [confirm, ...(whatsapp ? [whatsapp] : []), msg, follow, rateM];
        const clocking = clockOf(shift.email);
        const anything = worked + messages + followed + replied > 0 || !!clocking;
        if (!anything && end >= shift.end) {
            return { ...base, status: "absent" as const, share, metrics, missed: [], deduction: 0, attendance: null };
        }
        const attendance = attendanceFor(member, day, clocking, settings, now, worked + messages + followed + replied > 0);
        const missed = metrics.filter(m => !m.met).map(m => m.key);
        const deduction = missed.reduce((s, k) => s + deductionFor(settings, k), 0)
            + (attendance?.items.reduce((s, i) => s + i.amount, 0) || 0);
        return { ...base, status: "evaluated" as const, share, metrics, missed, deduction, attendance };
    });
}

/** The Cairo days whose shifts could still be running or just ended. */
export function recentDays(now = Date.now()): string[] {
    const today = cairoDate(new Date(now));
    const yesterday = cairoDate(new Date(now - 24 * HOUR));
    return yesterday === today ? [today] : [yesterday, today];
}

/** How far back the data for scoring `days` must reach. */
export function dataSince(days: string[], settings: TargetSettings): string {
    const first = days.slice().sort()[0];
    const reach = Math.max(Number(settings.backlog_days) || 0, Number(settings.followup_every_days) || 1, 1) + 1;
    return new Date(Date.parse(cairoDayStart(first)) - reach * 24 * HOUR).toISOString();
}

export function settingsOf(row: Partial<TargetSettings> | null | undefined): TargetSettings {
    return { ...DEFAULT_SETTINGS, ...(row || {}), members: row?.members || [] } as TargetSettings;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the browser and service clients differ in type
type Client = { from: (table: string) => any };

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}

const STORE = "easyorders_id.not.is.null,shopify_id.not.is.null,tags.cs.{missed}";
const STORE_COLS = "id, created_at, status, confirmed_at, confirmed_by, cancelled_at, cancelled_by, cancelled_from, customer_phone:customer_info->>phone";
const STUCK = ["Returning", "returning", "Hold To redeliver", "Hold to redeliver", "hold to redeliver", "Shipped", "shipped"];

/**
 * Everything scoreDay needs since `since`. Tables a caller may not read (a
 * moderator cannot see others' attendance) come back empty rather than fail.
 */
export async function loadTargetData(client: Client, businessId: string, since: string): Promise<TargetData> {
    const sinceDay = cairoDate(new Date(since));
    const soft = async <T>(p: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> => {
        try { const { data, error } = await p; return error ? [] : (data || []); } catch { return []; }
    };

    const [members, arrived, handled, manual, stuck, followups, leaves, clockings, attempts, whatsapp] = await Promise.all([
        soft<Member>(client.from("business_users").select("user_email, shift_start, shift_end, weekend_days").eq("business_id", businessId)),
        all<StoreOrder>((a, b) => client.from("orders").select(STORE_COLS).eq("business_id", businessId)
            .or(STORE).gte("created_at", since).order("id").range(a, b)),
        // Handled in the window though they arrived earlier.
        all<StoreOrder>((a, b) => client.from("orders").select(STORE_COLS).eq("business_id", businessId)
            .or(STORE).or(`confirmed_at.gte.${since},cancelled_at.gte.${since}`).lt("created_at", since).order("id").range(a, b)),
        all<ManualOrder & { tags: string[] | null }>((a, b) => client.from("orders").select("id, created_at, closed_by, tags").eq("business_id", businessId)
            .is("easyorders_id", null).is("shopify_id", null).not("closed_by", "is", null).gte("created_at", since).order("id").range(a, b)),
        all<StuckOrder>((a, b) => client.from("orders").select("id, status, status_changed_at").eq("business_id", businessId)
            .in("status", STUCK).order("id").range(a, b)),
        all<Followup>((a, b) => client.from("shipping_followups").select("order_id, created_by, created_at").eq("business_id", businessId)
            .gte("created_at", since).order("created_at").range(a, b)),
        soft<Leave & { status: string; request_type: string }>(client.from("hr_requests").select("user_email, start_time, end_time, status, request_type")
            .eq("business_id", businessId).eq("status", "approved").eq("request_type", "leave").gte("end_time", since)),
        soft<Clocking>(client.from("attendance_logs").select("user_email, date, clock_in_time, clock_out_time").eq("business_id", businessId).gte("date", sinceDay)),
        all<Attempt>((a, b) => client.from("order_confirmation_attempts").select("order_id, attempted_by, created_at").eq("business_id", businessId)
            .gte("created_at", since).order("created_at").range(a, b)).catch(() => [] as Attempt[]),
        // The company number's messages (none: a business without it, or before 20261124).
        all<WaMsg>((a, b) => client.from("whatsapp_messages")
            .select("customer_phone, direction, sent_at, sent_by, type, order_id, template_name, status, error, event:payload->>event, by:payload->>by")
            .eq("business_id", businessId).gte("sent_at", since).order("sent_at").range(a, b)).catch(() => [] as WaMsg[]),
    ]);

    return {
        members,
        storeOrders: [...arrived, ...handled],
        manualOrders: manual.filter(o => !(o.tags || []).includes("missed")),
        stuck,
        followups,
        leaves,
        attempts,
        clockings,
        whatsapp,
    };
}

// ---------------------------------------------------------------------------
// The monthly bonus
// ---------------------------------------------------------------------------

const DELIVERED = new Set(["delivered", "collected", "paid", "completed"]);
const CAME_BACK = new Set(["returned", "refused", "returning"]);
/** Below this many orders with an outcome, the delivery rate is not judged yet. */
export const MIN_FOR_RATE = 20;

export interface MonthStanding {
    user_email: string;
    /** Days measured (evaluated) and those with every target met. */
    days: number;
    days_met: number;
    days_pct: number;
    delivered: number;
    came_back: number;
    /** Of the orders they confirmed that month and that have an outcome; null below MIN_FOR_RATE. */
    delivery_rate: number | null;
    eligible: boolean;
    /** Why not, or what is still missing. */
    notes: string[];
}

/**
 * Who earns the month's bonus: met every target on `bonus_days_pct`% of the
 * days measured (at least 10), and `bonus_delivery_rate`% of the orders they
 * confirmed that month were delivered.
 */
export function monthStanding(
    members: string[],
    cards: { user_email: string; status: string; missed: string[] | null }[],
    confirmed: { confirmed_by: string | null; status: string }[],
    settings: TargetSettings,
): MonthStanding[] {
    return members.map(email => {
        const e = email.toLowerCase();
        const mine = cards.filter(c => c.user_email.toLowerCase() === e && c.status === "evaluated");
        const met = mine.filter(c => !(c.missed || []).length).length;
        const orders = confirmed.filter(o => lower(o.confirmed_by) === e);
        const delivered = orders.filter(o => DELIVERED.has(lower(o.status))).length;
        const back = orders.filter(o => CAME_BACK.has(lower(o.status))).length;
        const final = delivered + back;
        const rate = final >= MIN_FOR_RATE ? Math.round((delivered / final) * 1000) / 10 : null;
        const pct = mine.length ? Math.round((met / mine.length) * 1000) / 10 : 0;
        const notes: string[] = [];
        if (mine.length < 10) notes.push(`اتقاس ${mine.length} يوم بس (لازم 10 على الأقل)`);
        if (pct < settings.bonus_days_pct) notes.push(`حقق كل التارجت في ${pct}% من الأيام (المطلوب ${settings.bonus_days_pct}%)`);
        if (rate === null) notes.push(`نسبة التسليم لسه مش محسوبة (${final} أوردر ليهم نتيجة من ${MIN_FOR_RATE})`);
        else if (rate < settings.bonus_delivery_rate) notes.push(`نسبة التسليم ${rate}% (المطلوب ${settings.bonus_delivery_rate}%)`);
        return { user_email: e, days: mine.length, days_met: met, days_pct: pct, delivered, came_back: back, delivery_rate: rate, eligible: notes.length === 0, notes };
    });
}

export function monthRange(month: string): { from: string; to: string } {
    const [y, m] = month.split("-").map(Number);
    const to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    return { from: `${month.slice(0, 7)}-01`, to };
}

/** The month's standing, read from the scorecards and the orders. */
export async function loadMonthStanding(client: Client, businessId: string, month: string, settings: TargetSettings): Promise<MonthStanding[]> {
    const { from, to } = monthRange(month);
    const [cards, confirmed] = await Promise.all([
        all<{ user_email: string; status: string; missed: string[] | null }>((a, b) => client.from("moderator_scorecards").select("user_email, status, missed")
            .eq("business_id", businessId).gte("work_date", from).lt("work_date", to).order("work_date").range(a, b)).catch(() => []),
        all<{ confirmed_by: string | null; status: string }>((a, b) => client.from("orders").select("confirmed_by, status")
            .eq("business_id", businessId).in("confirmed_by", settings.members).gte("confirmed_at", `${from}T00:00:00+02:00`).lt("confirmed_at", `${to}T00:00:00+02:00`)
            .order("id").range(a, b)).catch(() => []),
    ]);
    return monthStanding(settings.members, cards, confirmed, settings);
}
