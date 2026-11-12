/**
 * Moderators' daily targets, set by what the business needs rather than by
 * what the team usually does (20261113_moderator_daily_targets.sql).
 *
 * Each moderator is measured over their own shift (business_users.shift_start
 * / shift_end / weekend_days, in Cairo time; a shift ending before it starts
 * runs past midnight). Four things are asked of a shift:
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
 *
 * A target missed costs the amount set for it (0 = shown, never deducted).
 * Pure: the caller loads the data, so the nightly run and the live view on a
 * moderator's screen compute the same thing.
 */

import { cairoDate, cairoDayStart, nextDay } from "@/lib/cairo-day";

export const DAILY_TARGETS_MIGRATION = "supabase/migrations/20261113_moderator_daily_targets.sql";

export type MetricKey = "confirm" | "messages" | "followups" | "rate";

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
};

export const METRIC_LABEL: Record<MetricKey, string> = {
    confirm: "سرعة التأكيد",
    messages: "أوردرات الرسايل",
    followups: "متابعة الشحن",
    rate: "نسبة التأكيد",
};

export const deductionFor = (s: TargetSettings, k: MetricKey) =>
    Number(k === "confirm" ? s.deduct_confirm : k === "messages" ? s.deduct_messages : k === "followups" ? s.deduct_followups : s.deduct_rate) || 0;

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
        // Not clocked out (yet, or forgotten): a shift of the usual length.
        const end = clocking.clock_out_time ? Date.parse(clocking.clock_out_time) : start + length;
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
    /** Until when this was measured (now, for a shift still running). */
    measured_until: string;
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

    const onLeave = (email: string, s: Shift) => data.leaves.some(l =>
        lower(l.user_email) === email && l.start_time && l.end_time
        && overlap(Date.parse(l.start_time), Date.parse(l.end_time), s.start, s.end) >= (s.end - s.start) / 2);
    const working = shifts.filter(s => !onLeave(s.email, s));

    // Courier follow-up: when each stuck order was last followed up.
    const lastFollow = new Map<string, number[]>();
    for (const f of data.followups) {
        const list = lastFollow.get(f.order_id) || [];
        list.push(Date.parse(f.created_at));
        lastFollow.set(f.order_id, list);
    }

    return shifts.map(shift => {
        const end = Math.min(shift.end, now);
        const base = {
            user_email: shift.email,
            work_date: day,
            shift_start: new Date(shift.start).toISOString(),
            shift_end: new Date(shift.end).toISOString(),
            measured_until: new Date(end).toISOString(),
        };
        if (!working.includes(shift)) {
            return { ...base, status: "leave" as const, share: 0, metrics: [], missed: [], deduction: 0, attendance: null };
        }

        // This moderator's share of the staffing on duty during their shift.
        const mine = end - shift.start;
        const staffed = working.reduce((s, o) => s + overlap(o.start, Math.min(o.end, now), shift.start, end), 0);
        const share = staffed > 0 ? mine / staffed : 1;
        const inShift = (t: string | null) => !!t && Date.parse(t) >= shift.start && Date.parse(t) < end;

        // 1. Confirmation speed
        const arrivedDue = data.storeOrders.filter(o => {
            const a = Date.parse(o.created_at);
            return a >= shift.start && a + H <= end;
        }).length;
        const waitingAtStart = data.storeOrders.filter(o => {
            const a = Date.parse(o.created_at);
            if (a >= shift.start || a < shift.start - backlog) return false;
            const h = handledAt(o);
            return h === null || h >= shift.start;
        }).length;
        const confirmedIds = data.storeOrders.filter(o => lower(o.confirmed_by) === shift.email && inShift(o.confirmed_at)).map(o => o.id);
        const cancelledIds = data.storeOrders.filter(o => lower(o.cancelled_by) === shift.email && cancelledFromWaiting(o) && inShift(o.cancelled_at)).map(o => o.id);
        const confirmed = confirmedIds.length;
        const cancelled = cancelledIds.length;
        const handled = confirmed + cancelled;
        // A logged call on an order still Waiting is work done on it too:
        // the customer did not answer, or asked to be called later.
        const closedIds = new Set([...confirmedIds, ...cancelledIds]);
        const calledIds = new Set(data.attempts.filter(t => lower(t.attempted_by) === shift.email && inShift(t.created_at) && !closedIds.has(t.order_id)).map(t => t.order_id));
        const worked = handled + calledIds.size;
        const needed = arrivedDue + waitingAtStart;
        const confirmTarget = Math.ceil(needed * share);
        const confirm: MetricResult = {
            key: "confirm", target: confirmTarget, done: worked, met: worked >= confirmTarget,
            parts: { confirmed, cancelled, attempted: calledIds.size },
            detail: `المطلوب يتشتغل عليه في الشيفت ${needed} أوردر (${waitingAtStart} مستنيين من قبل الشيفت + ${arrivedDue} وصلوا وعدّى عليهم ${settings.confirm_within_hours} ساعة)، نصيبك ${Math.round(share * 100)}% = ${confirmTarget}. اشتغلت على ${worked}: ${confirmed} تأكيد، ${cancelled} إلغاء، ${calledIds.size} محاولة متسجلة.`,
        };

        // 2. Orders from messages
        const messages = data.manualOrders.filter(o => lower(o.closed_by) === shift.email && inShift(o.created_at)).length;
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
        const due = [...stuckIds].filter(id => {
            const before = (lastFollow.get(id) || []).filter(t => t < shift.start);
            return !before.length || Math.max(...before) <= shift.start - followEvery;
        }).length;
        const followed = new Set(data.followups.filter(f => lower(f.created_by) === shift.email && inShift(f.created_at) && stuckIds.has(f.order_id)).map(f => f.order_id)).size;
        const followTarget = Math.ceil(due * share);
        const follow: MetricResult = {
            key: "followups", target: followTarget, done: followed, met: followed >= followTarget,
            detail: `${due} شحنة متعطلة كان لازم تتتابع، نصيبك ${followTarget}. تابعت ${followed}.`,
        };

        // 4. Confirmation rate
        const minRate = Math.max(0, Number(settings.min_confirm_rate) || 0);
        const minHandled = Math.max(1, Number(settings.min_handled_for_rate) || 1);
        const rate = handled ? Math.round((confirmed / handled) * 100) : 0;
        const asked = minRate > 0 && handled >= minHandled;
        const rateM: MetricResult = {
            key: "rate", target: asked ? minRate : null, done: rate, met: !asked || rate >= minRate,
            detail: minRate <= 0 ? `نسبة التأكيد ${rate}% (مفيش حد أدنى).`
                : handled < minHandled ? `نسبة التأكيد ${rate}% من ${handled} أوردر، أقل من ${minHandled} فمش محسوبة.`
                : `المطلوب ${minRate}% على الأقل، نسبتك ${rate}% (${confirmed} من ${handled}).`,
        };

        const metrics = [confirm, msg, follow, rateM];
        const clocking = clockOf(shift.email);
        const anything = worked + messages + followed > 0 || !!clocking;
        if (!anything && end >= shift.end) {
            return { ...base, status: "absent" as const, share, metrics, missed: [], deduction: 0, attendance: null };
        }
        const member = memberOf.get(shift.email)!;
        const attendance = attendanceFor(member, day, clocking, settings, now, worked + messages + followed > 0);
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
const STORE_COLS = "id, created_at, status, confirmed_at, confirmed_by, cancelled_at, cancelled_by, cancelled_from";
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

    const [members, arrived, handled, manual, stuck, followups, leaves, clockings, attempts] = await Promise.all([
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
    };
}
