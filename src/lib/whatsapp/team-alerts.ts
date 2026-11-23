import { accountOf, admin, graph, sendError, waNumber } from "@/lib/whatsapp/server";
import { whatsappSettingsOf, type TeamMember } from "@/lib/whatsapp/settings";
import { governorateArabic } from "@/lib/governorates";

/**
 * A customer answered a shipping message (المندوب ماقدرش يوصله / الشحنة
 * راجعة): the courier has to hear it. The API number cannot write in the
 * courier's WhatsApp group, so a moderator on shift gets a message ready to
 * forward there: the courier, the waybill, the order code, the customer, what
 * the courier should do (redeliver quickly / call the customer / stop and
 * return it), and every answer the customer gave since, buttons and words.
 *
 * Each later message from the customer sends the message again, complete
 * (marked as an update), to the same moderator.
 *
 * Who gets it (Settings → WhatsApp → «فريق الشحن»): a moderator turned on
 * there with a number, clocked in now (attendance_logs); else one whose shift
 * (business_users) is now; else any of them. Among those, whoever got the
 * fewest today. Free text when the moderator wrote to the company number in
 * the last 24 hours, else the team_shipping_update template.
 * Recorded in whatsapp_team_alerts (20261201).
 */

const SHIPPING_TEMPLATES = new Set(["delivery_failed", "delivery_failed_photo", "order_returning", "order_returning_photo"]);
const WINDOW_MS = 48 * 3_600_000;
const plain = (s: string) => s.replace(/[ّ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
const cairo = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleString("en-US", { timeZone: "Africa/Cairo", ...o });

interface Incoming { customer_phone: string; body: string | null; type?: string; payload?: unknown; sent_at?: string }

/** What the courier is asked to do, from the customer's last button. */
function requestFor(kind: "hold" | "returning", buttons: { text: string; at: number }[]): string {
    const last = buttons[buttons.length - 1];
    const said = last ? plain(last.text) : "";
    const day = (days: number) => {
        const at = new Date((last?.at || Date.now()) + days * 86_400_000);
        return `${days === 1 ? "بكرة" : "بعد بكرة"} (${at.toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "numeric", timeZone: "Africa/Cairo" })})`;
    };
    if (kind === "hold") {
        if (said === "بكره") return `✅ العميل عايز الشحنة: برجاء المحاولة تاني ${day(1)} والاستعجال في التوصيل.`;
        if (said === "بعد بكره") return `✅ العميل عايز الشحنة: برجاء المحاولة تاني ${day(2)} والاستعجال في التوصيل.`;
        if (said === "كلموني") return "📞 العميل طالب المندوب يكلّمه النهارده: برجاء المحاولة تاني والاستعجال في التوصيل.";
    } else {
        if (said === "ابعتوه تاني") return "✅ العميل لسه عايز الشحنة: برجاء وقف المرتجع والمحاولة تاني في أسرع وقت.";
        if (said === "مش عايزه") return "⛔ العميل مش عايز الشحنة: برجاء إيقاف أي محاولات عليها ورجوعها مرتجع بسرعة.";
    }
    return "💬 العميل ردّ على رسالة المتابعة (ردوده تحت): برجاء المتابعة معاه.";
}

const minutesOf = (t: string | null | undefined) => {
    const [h, m] = String(t || "").split(":").map(Number);
    return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};
/** Whether now (Cairo) is inside the shift, which may run past midnight. */
function onShift(start: string | null, end: string | null, weekend: string[] | null, now = new Date()): boolean {
    const s = minutesOf(start), e = minutesOf(end);
    if (s === null || e === null) return false;
    const minute = Number(cairo(now, { hour: "numeric", hour12: false })) % 24 * 60 + Number(cairo(now, { minute: "numeric" }));
    const today = cairo(now, { weekday: "long" });
    const yesterday = cairo(new Date(now.getTime() - 86_400_000), { weekday: "long" });
    const off = new Set(weekend || []);
    if (s <= e) return !off.has(today) && minute >= s && minute < e;
    // 18:00–02:00: tonight's part belongs to today, after midnight to yesterday's shift.
    return (minute >= s && !off.has(today)) || (minute < e && !off.has(yesterday));
}

async function pickMember(businessId: string, orderId: string, members: TeamMember[]): Promise<TeamMember | null> {
    const on = members.filter(m => m.on && m.phone.replace(/\D/g, "").length >= 10);
    if (!on.length) return null;
    const byEmail = new Map(on.map(m => [m.email.toLowerCase(), m]));
    // The same moderator for the same order, while they are still on the list.
    const { data: before } = await admin.from("whatsapp_team_alerts").select("member_email").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1);
    const sticky = before?.[0] && byEmail.get(String(before[0].member_email).toLowerCase());
    if (sticky) return sticky;

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    const emails = on.map(m => m.email);
    const [{ data: present }, { data: shifts }, { data: sent }] = await Promise.all([
        admin.from("attendance_logs").select("user_email").eq("business_id", businessId).eq("date", today).is("clock_out_time", null).in("user_email", emails),
        admin.from("business_users").select("user_email, shift_start, shift_end, weekend_days").eq("business_id", businessId).in("user_email", emails),
        admin.from("whatsapp_team_alerts").select("member_email").eq("business_id", businessId).gte("created_at", new Date(Date.now() - 86_400_000).toISOString()),
    ]);
    const clockedIn = on.filter(m => (present || []).some(p => p.user_email.toLowerCase() === m.email.toLowerCase()));
    const scheduled = on.filter(m => (shifts || []).some(s => s.user_email.toLowerCase() === m.email.toLowerCase() && onShift(s.shift_start, s.shift_end, s.weekend_days)));
    const pool = clockedIn.length ? clockedIn : scheduled.length ? scheduled : on;
    const load = (m: TeamMember) => (sent || []).filter(s => String(s.member_email).toLowerCase() === m.email.toLowerCase()).length;
    return pool.slice().sort((a, b) => load(a) - load(b))[0];
}

const label = (m: { type: string; body: string | null }) =>
    m.body?.trim() || ({ image: "[صورة]", audio: "[رسالة صوتية]", video: "[فيديو]", document: "[ملف]", sticker: "[ملصق]", location: "[موقع]" } as Record<string, string>)[m.type] || "";

/** `preview`: the message and who would get it, sending nothing (with these members when given). */
export async function notifyTeamOfShippingReply(businessId: string, m: Incoming, preview?: { members?: TeamMember[] }) {
    if (m.type === "reaction") return;
    const { data: biz } = await admin.from("businesses").select("theme_config").eq("id", businessId).maybeSingle();
    const team = whatsappSettingsOf(biz?.theme_config).team_alerts;
    if (preview?.members) team.members = preview.members;
    if ((!team.enabled && !preview) || !team.members.some(x => x.on)) return;

    // The shipping message this answers: our latest one to the customer, in the last 48 hours.
    const { data: asked } = await admin.from("whatsapp_messages").select("order_id, template_name, sent_at, event:payload->>event")
        .eq("business_id", businessId).eq("customer_phone", m.customer_phone).eq("direction", "out").not("template_name", "is", null)
        .gte("sent_at", new Date(Date.now() - WINDOW_MS).toISOString()).order("sent_at", { ascending: false }).limit(1);
    const t = asked?.[0] as { order_id: string | null; template_name: string; sent_at: string; event?: string | null } | undefined;
    if (!t?.order_id) return;
    const ev = t.event || "";
    const kind: "hold" | "returning" | null = ev === "hold" || /^delivery_failed/.test(t.template_name) ? "hold"
        : ev === "returning" || /^order_returning/.test(t.template_name) ? "returning" : null;
    if (!kind || !(SHIPPING_TEMPLATES.has(t.template_name) || ev === "hold" || ev === "returning")) return;

    const { data: order } = await admin.from("orders").select("id, status, courier_code, customer_info, shipping_companies(name)")
        .eq("business_id", businessId).eq("id", t.order_id).maybeSingle();
    if (!order) return;
    const st = String(order.status).toLowerCase();
    if (!(st.startsWith("hold") || st === "returning")) return;

    // Everything the customer sent since: buttons and words, in order.
    const { data: said } = await admin.from("whatsapp_messages").select("type, body, payload, sent_at")
        .eq("business_id", businessId).eq("customer_phone", m.customer_phone).eq("direction", "in").neq("type", "reaction")
        .gte("sent_at", t.sent_at).order("sent_at", { ascending: true }).limit(30);
    const replies = (said || []).map(x => ({ text: label(x as { type: string; body: string | null }), at: Date.parse(x.sent_at), button: x.type === "button" || x.type === "interactive" }))
        .filter(x => x.text);
    if (!replies.length) return;
    const buttonWords = new Set(["بكره", "بعد بكره", "كلموني", "ابعتوه تاني", "مش عايزه"]);
    const buttons = replies.filter(r => r.button || buttonWords.has(plain(r.text)));

    const member = await pickMember(businessId, order.id, team.members);
    if (!member) return;

    const { count: earlier } = await admin.from("whatsapp_team_alerts").select("id", { count: "exact", head: true }).eq("order_id", order.id);
    const info = (order.customer_info || {}) as { name?: string; phone?: string; governorate?: string };
    const courier = (order.shipping_companies as { name?: string } | null)?.name || "شركة الشحن";
    const params = [
        courier,
        // Couriers without a waybill number (Telegraf) know the order by its code.
        order.courier_code || "بكود الأوردر",
        order.id.slice(0, 8).toUpperCase(),
        [info.name?.trim(), info.phone, governorateArabic(info.governorate) || info.governorate].filter(Boolean).join(" — ") || "-",
        `${earlier ? "🔄 تحديث: " : ""}${requestFor(kind, buttons)}`,
        replies.map(r => `«${r.text.replace(/\s+/g, " ").slice(0, 200)}»`).join(" ← ").slice(0, 700),
    ].map(p => p.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim() || "-");
    const text = teamShippingText(params);
    if (preview) return { member: member.email, text };
    const account = await accountOf(businessId);
    if (!account) return;

    // Free inside the moderator's 24 hours (they wrote to the company number), else the template.
    const to = waNumber(member.phone);
    const local = /^20(1\d{9})$/.test(to) ? `0${to.slice(2)}` : member.phone;
    const { count: wrote } = await admin.from("whatsapp_messages").select("id", { count: "exact", head: true })
        .eq("business_id", businessId).eq("customer_phone", local).eq("direction", "in")
        .gte("sent_at", new Date(Date.now() - 23.5 * 3_600_000).toISOString());
    const res = await graph(`${account.phone_number_id}/messages`, account.token, {
        method: "POST",
        body: JSON.stringify(wrote
            ? { messaging_product: "whatsapp", to, type: "text", text: { body: text } }
            : { messaging_product: "whatsapp", to, type: "template", template: { name: "team_shipping_update", language: { code: "ar" }, components: [{ type: "body", parameters: params.map(p => ({ type: "text", text: p })) }] } }),
    });
    const { error } = await admin.from("whatsapp_team_alerts").insert({
        business_id: businessId, order_id: order.id, member_email: member.email, member_phone: member.phone,
        body: text, wa_message_id: res.ok ? res.body?.messages?.[0]?.id || null : null, error: res.ok ? null : sendError(res.body),
    });
    if (error) console.error("whatsapp team alert", error.message);
}

/** The message as the moderator reads and forwards it (the template's text with its values). */
export function teamShippingText(p: string[]): string {
    return `📦 *متابعة شحنة: ${p[0]}*\nالبوليصة: ${p[1]}\nكود الأوردر: ${p[2]}\nالعميل: ${p[3]}\n\n${p[4]}\n\n💬 ردود العميل: ${p[5]}\n\nبرجاء التنفيذ في أسرع وقت 🙏`;
}
