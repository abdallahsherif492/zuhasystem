/**
 * Monthly payroll: a salary, plus bonuses, minus deductions, minus advances
 * already handed over during the month. See 20261001_payroll.sql.
 */

export type AdjustmentKind = "bonus" | "deduction" | "advance";

export const ADJUSTMENT_KINDS: { key: AdjustmentKind; ar: string; en: string; sign: 1 | -1 }[] = [
    { key: "bonus", ar: "بونص / حافز", en: "Bonus", sign: 1 },
    { key: "deduction", ar: "خصم", en: "Deduction", sign: -1 },
    { key: "advance", ar: "سلفة", en: "Advance", sign: -1 },
];
export const kindInfo = (k: AdjustmentKind) => ADJUSTMENT_KINDS.find(x => x.key === k)!;

export interface Adjustment {
    id?: string;
    kind: AdjustmentKind;
    amount: number;
    reason: string;
    entry_date: string;
    transaction_id?: string | null;
    /** Off: a deduction or advance on record that does not come off this month's pay. */
    apply_to_salary?: boolean;
}

export interface Payslip {
    id: string;
    business_user_id: string | null;
    user_email: string;
    employee_name: string | null;
    job_title: string | null;
    period: string;
    base_salary: number;
    bonuses: number;
    deductions: number;
    advances: number;
    net_pay: number;
    items: Adjustment[];
    paid_on: string;
    account_name: string | null;
    notes: string | null;
    carryover_id: string | null;
}

export interface PayTotals {
    base: number;
    bonuses: number;
    deductions: number;
    advances: number;
    net: number;
}

export const applies = (i: Adjustment) => i.apply_to_salary !== false;

export function payTotals(base: number, items: Adjustment[]): PayTotals {
    const sum = (k: AdjustmentKind) => items.filter(i => i.kind === k && applies(i)).reduce((s, i) => s + Number(i.amount), 0);
    const bonuses = sum("bonus");
    const deductions = sum("deduction");
    const advances = sum("advance");
    return { base, bonuses, deductions, advances, net: base + bonuses - deductions - advances };
}

export const payslipTotals = (p: Payslip): PayTotals => ({
    base: Number(p.base_salary), bonuses: Number(p.bonuses), deductions: Number(p.deductions),
    advances: Number(p.advances), net: Number(p.net_pay),
});

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

/** "2026-09" ⇄ "2026-09-01" (the period column). */
export const periodKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const periodDate = (key: string) => `${key}-01`;
export const addMonths = (key: string, n: number) => {
    const [y, m] = key.split("-").map(Number);
    return periodKey(new Date(y, m - 1 + n, 1));
};

export function monthLabel(key: string, ar: boolean) {
    const [y, m] = key.slice(0, 7).split("-").map(Number);
    return new Intl.DateTimeFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
}

/** The month's days as yyyy-MM-dd, up to today when it is the current month. */
export function monthDays(key: string): string[] {
    const [y, m] = key.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    const today = new Date();
    const out: string[] = [];
    for (let d = 1; d <= last; d++) {
        const date = new Date(y, m - 1, d);
        if (date > today) break;
        out.push(`${key}-${String(d).padStart(2, "0")}`);
    }
    return out;
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface AttendanceSummary {
    workdays: number;
    present: number;
    absent: number;
    lateDays: number;
    lateMinutes: number;
}

/**
 * Days worked against working days so far this month, from the clock-in log.
 * A guide for deductions, not a payroll rule: approved leave is not taken out
 * of the absences.
 */
export function attendanceSummary(
    key: string,
    weekendDays: string[] | null,
    logs: { date: string; delay_minutes: number | null }[],
): AttendanceSummary {
    const weekend = new Set(weekendDays || []);
    const workdays = monthDays(key).filter(d => {
        const [y, m, day] = d.split("-").map(Number);
        return !weekend.has(WEEKDAY[new Date(y, m - 1, day).getDay()]);
    });
    const byDay = new Map<string, number>();
    for (const l of logs) byDay.set(l.date, Math.max(byDay.get(l.date) ?? 0, Number(l.delay_minutes) || 0));
    const present = workdays.filter(d => byDay.has(d)).length;
    const late = [...byDay.values()].filter(v => v > 0);
    return {
        workdays: workdays.length,
        present,
        absent: Math.max(0, workdays.length - present),
        lateDays: late.length,
        lateMinutes: late.reduce((s, v) => s + v, 0),
    };
}

/** A day's pay, the way Egyptian payroll usually counts it: the month over 30. */
export const dayRate = (monthly: number) => monthly / 30;
