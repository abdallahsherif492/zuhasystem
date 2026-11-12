import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveCronCaller } from "../auto-sync/cron-auth";
import { cairoDate } from "@/lib/cairo-day";
import {
    ATTENDANCE_LABEL, METRIC_LABEL, dataSince, loadTargetData, scoreDay, settingsOf,
    type MetricKey, type Scorecard, type TargetSettings,
} from "@/lib/hr/daily-targets";

/**
 * Scores every moderator shift that has ended and books the deduction for any
 * target missed (src/lib/hr/daily-targets.ts, 20261113_moderator_daily_targets.sql).
 *
 * Run hourly by netlify/functions/moderator-targets.mjs with CRON_SECRET, or
 * by a signed-in manager from Team → Daily targets ("score now"). Each shift
 * is scored once: a scorecard already written is never rewritten, so a
 * deduction someone waived in payroll does not come back.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY || "", { auth: { persistSession: false } });

export const maxDuration = 120;

/** A shift is final this long after it ends: late clicks still count. */
const GRACE_MS = 30 * 60_000;
/** How many days back a missed run can still catch up. */
const LOOKBACK_DAYS = 3;

const MANAGER_ROLES = new Set(["owner", "admin", "super admin"]);

export async function GET(request: Request) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return NextResponse.json({ success: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured." }, { status: 500 });
    }
    const caller = await resolveCronCaller(request);
    if (caller.kind === "denied") {
        return NextResponse.json({ success: false, error: caller.reason }, { status: 401 });
    }

    let query = admin.from("moderator_target_settings").select("*").eq("enabled", true);
    if (caller.kind === "user") {
        // A person may only score businesses they manage.
        const { data: links } = await admin.from("business_users").select("business_id, role")
            .eq("user_email", caller.email).in("business_id", caller.businessIds);
        const managed = (links || []).filter(l => MANAGER_ROLES.has(String(l.role || "").toLowerCase().replace(/_/g, " "))).map(l => l.business_id);
        if (!managed.length) return NextResponse.json({ success: false, error: "Managers only." }, { status: 403 });
        query = query.in("business_id", managed);
    }
    const { data: rows, error } = await query;
    if (error) {
        const missing = /moderator_target_settings|schema cache/i.test(error.message);
        return NextResponse.json({ success: false, error: missing ? "Run 20261113_moderator_daily_targets.sql first." : error.message }, { status: missing ? 412 : 500 });
    }

    const results: Record<string, { scored: number; booked: number; errors: string[] }> = {};
    for (const row of rows || []) {
        try {
            results[row.business_id] = await scoreBusiness(row.business_id, settingsOf(row));
        } catch (e) {
            results[row.business_id] = { scored: 0, booked: 0, errors: [(e as Error).message] };
        }
    }
    return NextResponse.json({ success: true, results });
}

async function scoreBusiness(businessId: string, settings: TargetSettings) {
    const now = Date.now();
    const days: string[] = [];
    for (let i = LOOKBACK_DAYS; i >= 0; i--) {
        const d = cairoDate(new Date(now - i * 86_400_000));
        if (!days.includes(d) && (!settings.starts_on || d >= settings.starts_on)) days.push(d);
    }
    const out = { scored: 0, booked: 0, errors: [] as string[] };
    if (!days.length || !settings.members.length) return out;

    const { data: existing, error: exErr } = await admin.from("moderator_scorecards")
        .select("user_email, work_date").eq("business_id", businessId).in("work_date", days);
    if (exErr) throw exErr;
    const done = new Set((existing || []).map(r => `${r.user_email.toLowerCase()}|${r.work_date}`));

    const data = await loadTargetData(admin, businessId, dataSince(days, settings));
    const ready: Scorecard[] = [];
    for (const day of days) {
        for (const card of scoreDay(day, settings, data, now)) {
            if (Date.parse(card.shift_end) + GRACE_MS > now) continue;
            if (done.has(`${card.user_email}|${card.work_date}`)) continue;
            ready.push(card);
        }
    }
    if (!ready.length) return out;

    // Who is who in payroll.
    const { data: people } = await admin.from("business_users").select("id, user_email").eq("business_id", businessId);
    const memberId = new Map((people || []).map(p => [String(p.user_email).toLowerCase(), p.id as string]));

    for (const card of ready) {
        let deduction = card.deduction;
        let adjustmentId: string | null = null;
        let note: string | null = null;

        // The monthly cap: what this month's scorecards already cost them.
        if (deduction > 0 && settings.monthly_cap !== null && settings.monthly_cap !== undefined) {
            const month = card.work_date.slice(0, 8) + "01";
            const { data: used } = await admin.from("moderator_scorecards").select("deduction")
                .eq("business_id", businessId).eq("user_email", card.user_email)
                .gte("work_date", month).lt("work_date", nextMonth(month));
            const spent = (used || []).reduce((s, r) => s + (Number(r.deduction) || 0), 0);
            const left = Math.max(0, Number(settings.monthly_cap) - spent);
            if (left < deduction) note = left > 0 ? `اتقلل لـ ${left} عشان الحد الشهري` : "وصل للحد الشهري، مفيش خصم";
            deduction = Math.min(deduction, left);
        }

        if (deduction > 0 && settings.apply_to_payroll) {
            const buId = memberId.get(card.user_email);
            if (!buId) {
                note = "مش موجود في الفريق، الخصم ماتسجلش";
            } else {
                const { data: adj, error: adjErr } = await admin.from("payroll_adjustments").insert({
                    business_id: businessId,
                    business_user_id: buId,
                    period: card.work_date.slice(0, 8) + "01",
                    kind: "deduction",
                    amount: deduction,
                    reason: `تارجت يوم ${card.work_date}: ${[
                        ...card.missed.map((k: MetricKey) => METRIC_LABEL[k]),
                        ...(card.attendance?.items || []).filter(i => i.amount > 0).map(i => ATTENDANCE_LABEL[i.key]),
                    ].join("، ")}`,
                    entry_date: card.work_date,
                    created_by: "system: daily targets",
                }).select("id").single();
                if (adjErr) note = /اتسوّى|check_violation/.test(adjErr.message) ? "مرتب الشهر اتسوّى، الخصم ماتسجلش" : `الخصم ماتسجلش: ${adjErr.message}`;
                else { adjustmentId = adj.id; out.booked++; }
            }
        } else if (deduction > 0) {
            note = note || "التسجيل في المرتبات مقفول من الإعدادات";
        }

        const record = {
            business_id: businessId,
            user_email: card.user_email,
            work_date: card.work_date,
            shift_start: card.shift_start,
            shift_end: card.shift_end,
            status: card.status,
            share: Math.round(card.share * 10000) / 10000,
            metrics: card.metrics,
            missed: card.missed,
            deduction,
            adjustment_id: adjustmentId,
            payroll_note: note,
            attendance: card.attendance,
        };
        let { error: insErr } = await admin.from("moderator_scorecards").insert(record);
        if (insErr && /attendance/.test(insErr.message)) {
            // 20261114_target_attendance.sql not run yet.
            const { attendance: _skip, ...without } = record;
            void _skip;
            ({ error: insErr } = await admin.from("moderator_scorecards").insert(without));
        }
        if (insErr) {
            // Scored by a run in parallel: undo the booking so it is not doubled.
            if (adjustmentId) await admin.from("payroll_adjustments").delete().eq("id", adjustmentId);
            if (!/duplicate key/i.test(insErr.message)) out.errors.push(insErr.message);
            continue;
        }
        out.scored++;
    }
    return out;
}

function nextMonth(first: string) {
    const [y, m] = first.split("-").map(Number);
    return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}
