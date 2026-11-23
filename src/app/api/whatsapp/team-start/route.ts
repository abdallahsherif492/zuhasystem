import { NextResponse } from "next/server";
import { memberOf } from "@/lib/whatsapp/server";
import { sendShiftStart } from "@/lib/whatsapp/team-alerts";

/**
 * Clocking in: the day's «جاهز» message to the moderator who just clocked in,
 * when they are on the shipping team (lib/whatsapp/team-alerts.ts). Only to
 * the caller. Body: { business_id }.
 */
export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { business_id?: string } | null;
    if (!body?.business_id) return NextResponse.json({ error: "بيانات ناقصة." }, { status: 400 });
    const who = await memberOf(body.business_id);
    if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
    const result = await sendShiftStart(body.business_id, who.email);
    return NextResponse.json({ result });
}
