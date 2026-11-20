import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { WHATSAPP_VERIFY_TOKEN } from "@/lib/whatsapp/config";
import { handleReply } from "@/lib/whatsapp/auto-confirm";

/**
 * WhatsApp's webhook (app: Zuha System). GET answers Meta's check when the
 * callback URL is saved. POST receives customers' messages and the status of
 * ours, signed with the app secret, and keeps them in whatsapp_messages
 * (20261124_whatsapp_messages.sql) for the business the number belongs to.
 * Always answers 200 once the signature is good: Meta retries anything else.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY || "", { auth: { persistSession: false } });

export async function GET(request: Request) {
    const q = new URL(request.url).searchParams;
    if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === WHATSAPP_VERIFY_TOKEN) {
        return new Response(q.get("hub.challenge") || "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
}

function signedByMeta(raw: string, header: string | null): boolean {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret || !header?.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const got = header.slice(7);
    return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** 201xxxxxxxxx -> 01xxxxxxxxx, the way the system stores Egyptian mobiles. */
const localPhone = (waId: string) => (/^20(1\d{9})$/.test(waId) ? `0${waId.slice(2)}` : waId);

interface WaMessage {
    id: string; from: string; timestamp: string; type: string;
    text?: { body: string };
    button?: { text: string; payload?: string };
    interactive?: { type: string; button_reply?: { title: string; id: string }; list_reply?: { title: string; id: string } };
    image?: { id: string; mime_type?: string; caption?: string };
    audio?: { id: string; mime_type?: string };
    video?: { id: string; mime_type?: string; caption?: string };
    document?: { id: string; mime_type?: string; caption?: string; filename?: string };
    sticker?: { id: string; mime_type?: string };
    location?: { latitude: number; longitude: number; name?: string; address?: string };
    reaction?: { emoji: string; message_id: string };
    context?: { id: string };
}

function bodyOf(m: WaMessage): { body: string | null; media?: { id: string; mime_type?: string } } {
    switch (m.type) {
        case "text": return { body: m.text?.body ?? null };
        case "button": return { body: m.button?.text ?? null };
        case "interactive": return { body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null };
        case "image": return { body: m.image?.caption ?? null, media: m.image };
        case "video": return { body: m.video?.caption ?? null, media: m.video };
        case "audio": return { body: null, media: m.audio };
        case "document": return { body: m.document?.caption ?? m.document?.filename ?? null, media: m.document };
        case "sticker": return { body: null, media: m.sticker };
        case "location": return { body: [m.location?.name, m.location?.address, `${m.location?.latitude},${m.location?.longitude}`].filter(Boolean).join(" - ") };
        case "reaction": return { body: m.reaction?.emoji ?? null };
        default: return { body: null };
    }
}

/** A line in Settings → integration logs, so a webhook that is not arriving can be seen. */
async function trace(status: "success" | "error" | "info", message: string, details: Record<string, unknown>, businessId: string | null = null) {
    await admin.from("integration_logs").insert({ business_id: businessId, integration_name: "WhatsApp", status, message, details }).then(() => undefined, () => undefined);
}

export async function POST(request: Request) {
    const raw = await request.text();
    if (!signedByMeta(raw, request.headers.get("x-hub-signature-256"))) {
        await trace("error", "Webhook signature did not match WHATSAPP_APP_SECRET", {
            secret_set: !!process.env.WHATSAPP_APP_SECRET, signature_sent: !!request.headers.get("x-hub-signature-256"), bytes: raw.length,
        });
        return new Response("bad signature", { status: 401 });
    }
    let payload: { entry?: { changes?: { field: string; value: Record<string, unknown> }[] }[] };
    try { payload = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }

    const businessOf = new Map<string, string | null>();
    const business = async (phoneNumberId: string) => {
        if (!businessOf.has(phoneNumberId)) {
            const { data } = await admin.from("whatsapp_accounts").select("business_id").eq("phone_number_id", phoneNumberId).maybeSingle();
            businessOf.set(phoneNumberId, data?.business_id ?? null);
        }
        return businessOf.get(phoneNumberId)!;
    };

    for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
            if (change.field !== "messages") continue;
            const v = change.value as {
                metadata?: { phone_number_id?: string };
                contacts?: { wa_id: string; profile?: { name?: string } }[];
                messages?: WaMessage[];
                statuses?: { id: string; status: string; timestamp: string; recipient_id: string; errors?: unknown[] }[];
            };
            const phoneNumberId = v.metadata?.phone_number_id;
            if (!phoneNumberId) continue;
            const businessId = await business(phoneNumberId);
            if (!businessId) { await trace("info", "Webhook for a number not connected", { phone_number_id: phoneNumberId }); continue; }

            const names = new Map((v.contacts || []).map(c => [c.wa_id, c.profile?.name || null]));
            const rows = (v.messages || []).map(m => {
                const { body, media } = bodyOf(m);
                return {
                    business_id: businessId,
                    phone_number_id: phoneNumberId,
                    wa_message_id: m.id,
                    direction: "in",
                    customer_phone: localPhone(m.from),
                    customer_wa_id: m.from,
                    contact_name: names.get(m.from) ?? null,
                    type: m.type,
                    body,
                    media_id: media?.id ?? null,
                    media_mime: media?.mime_type ?? null,
                    context_id: m.context?.id ?? m.reaction?.message_id ?? null,
                    status: "received",
                    payload: m,
                    sent_at: new Date(Number(m.timestamp) * 1000).toISOString(),
                };
            });
            if (rows.length) {
                const { error } = await admin.from("whatsapp_messages").upsert(rows, { onConflict: "wa_message_id", ignoreDuplicates: true });
                if (error) {
                    console.error("whatsapp webhook: messages not saved", error.message);
                    await trace("error", `Messages not saved: ${error.message}`, { count: rows.length }, businessId);
                }
            }
            // Answers to the confirmation message: confirm, cancel, a cancel reason.
            for (const r of rows) {
                if (r.type === "reaction") continue;
                try { await handleReply(businessId, r); }
                catch (e) { console.error("whatsapp auto reply failed", e); }
            }

            // Our messages: sent -> delivered -> read, or failed.
            const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
            for (const s of v.statuses || []) {
                const { data: row } = await admin.from("whatsapp_messages").select("id, status").eq("wa_message_id", s.id).maybeSingle();
                if (!row || (rank[row.status] || 0) >= (rank[s.status] || 0)) continue;
                await admin.from("whatsapp_messages").update({
                    status: s.status,
                    status_at: new Date(Number(s.timestamp) * 1000).toISOString(),
                    error: s.errors?.length ? s.errors : null,
                }).eq("id", row.id);
            }
        }
    }
    return NextResponse.json({ ok: true });
}
