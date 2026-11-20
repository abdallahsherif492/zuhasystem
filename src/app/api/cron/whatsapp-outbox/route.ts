import { NextResponse } from "next/server";
import { resolveCronCaller } from "../auto-sync/cron-auth";
import { admin } from "@/lib/whatsapp/server";
import { processOutbox } from "@/lib/whatsapp/outbox";
import { runTimedFlows } from "@/lib/whatsapp/flows";

/**
 * Sends the queued WhatsApp messages (lib/whatsapp/outbox.ts).
 * GET: the hourly run (netlify/functions/whatsapp-outbox.mjs), which also
 * runs the «مردش بعد N ساعة» rules.
 * POST: the database, the moment a message is queued (20261126); it signs
 * with the key kept in app_hooks, which only the server can read.
 */

export const maxDuration = 60;

export async function GET(request: Request) {
    const caller = await resolveCronCaller(request);
    if (caller.kind !== "scheduler") return NextResponse.json({ error: "scheduler only" }, { status: 401 });
    const r = await processOutbox();
    // The rules «العميل مردش بعد N ساعة» (hourly is enough for hours).
    try { await runTimedFlows(); } catch (e) { console.error("whatsapp timed rules", e); }
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}

export async function POST(request: Request) {
    const key = request.headers.get("x-hook-key");
    if (!key) return NextResponse.json({ error: "no key" }, { status: 401 });
    const { data } = await admin.from("app_hooks").select("secret").eq("name", "whatsapp_outbox").maybeSingle();
    if (!data?.secret || data.secret !== key) return NextResponse.json({ error: "bad key" }, { status: 401 });
    const r = await processOutbox();
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
