/**
 * Days as the business lives them: in Cairo. A date picked as "2026-10-31"
 * means from Cairo midnight to the next Cairo midnight, whatever the
 * browser's clock or Egypt's summer time says.
 */

const offsetFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", timeZoneName: "shortOffset" });

/** Cairo's offset from UTC, in minutes, at the given instant (+120 or +180). */
function cairoOffsetMinutes(at: Date): number {
    const name = offsetFmt.formatToParts(at).find(p => p.type === "timeZoneName")?.value || "GMT+2";
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 120;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/** The instant Cairo's day `ymd` (yyyy-MM-dd) begins, as an ISO string. */
export function cairoDayStart(ymd: string): string {
    const [y, mo, d] = ymd.split("-").map(Number);
    const utcMidnight = Date.UTC(y, mo - 1, d);
    // The offset at Cairo midnight; checked twice so a day that starts on a
    // summer-time change still lands on its own midnight.
    let t = utcMidnight - cairoOffsetMinutes(new Date(utcMidnight)) * 60_000;
    t = utcMidnight - cairoOffsetMinutes(new Date(t)) * 60_000;
    return new Date(t).toISOString();
}

/** The day after `ymd`, as yyyy-MM-dd. */
export function nextDay(ymd: string): string {
    const [y, mo, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
}

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });

/** The Cairo day an instant falls on, as yyyy-MM-dd. */
export function cairoDate(at: Date | string = new Date()): string {
    return dayFmt.format(typeof at === "string" ? new Date(at) : at);
}
