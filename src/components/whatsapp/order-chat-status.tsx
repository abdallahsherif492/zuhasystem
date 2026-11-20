"use client";

import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { CONFIRM_TEMPLATES } from "@/lib/whatsapp/settings";

/**
 * Each store order's WhatsApp state, from the company number's chats: the
 * customer wrote and is waiting for a reply, or the confirmation went out and
 * how long ago; with a button that opens the customer's chat.
 */

export interface ChatState {
    /** The phone as the chats page keys it, for the link. */
    phone: string;
    lastDirection: "in" | "out";
    lastAt: string;
    /** Customer messages since our last reply. */
    waiting: number;
    confirmSentAt: string | null;
    confirmStatus: string | null;
    /** The confirmation failed because the number has no WhatsApp. */
    noWhatsApp: boolean;
    /** The last template we sent (any kind), for the shipping problems page. */
    lastTemplate: { name: string; at: string; status: string; noWhatsApp: boolean } | null;
}

interface Msg { customer_phone: string; direction: "in" | "out"; type: string; template_name: string | null; status: string; error: unknown; sent_at: string }

const last10 = (p: string | null | undefined) => (p || "").replace(/\D/g, "").slice(-10);

/** Live: a new message or a changed status shows at once. */
export function useChatStates(businessId: string | undefined) {
    const [states, setStates] = useState<Map<string, ChatState>>(new Map());
    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        // Read once, then each new message or status change is applied as it
        // arrives (no reading everything again).
        const out = new Map<string, ChatState>();
        const apply = (m: Msg, isNew = true) => {
            if (m.type === "reaction") return;
            const key = last10(m.customer_phone);
            const s = out.get(key) || { phone: m.customer_phone, lastDirection: m.direction, lastAt: m.sent_at, waiting: 0, confirmSentAt: null, confirmStatus: null, noWhatsApp: false, lastTemplate: null };
            if (isNew && (m.sent_at >= s.lastAt || !out.has(key))) {
                s.waiting = m.direction === "in" ? (s.lastDirection === "in" && out.has(key) ? s.waiting + 1 : 1) : 0;
                s.lastDirection = m.direction;
                s.lastAt = m.sent_at;
            }
            const failedNoWa = m.status === "failed" && JSON.stringify(m.error || "").includes("131026");
            if (m.direction === "out" && m.template_name && (!s.lastTemplate || m.sent_at >= s.lastTemplate.at)) {
                s.lastTemplate = { name: m.template_name, at: m.sent_at, status: m.status, noWhatsApp: failedNoWa };
            }
            // A confirmation that failed on our side (a photo Meta refused) never arrived: as if not sent.
            const lostOnOurSide = m.status === "failed" && !failedNoWa;
            if (lostOnOurSide && s.confirmSentAt === m.sent_at) { s.confirmSentAt = null; s.confirmStatus = null; }
            if (m.direction === "out" && m.template_name && !lostOnOurSide && [...CONFIRM_TEMPLATES, "order_confirm_photo"].includes(m.template_name) && (!s.confirmSentAt || m.sent_at >= s.confirmSentAt)) {
                s.confirmSentAt = m.sent_at;
                s.confirmStatus = m.status;
                s.noWhatsApp = failedNoWa;
            }
            out.set(key, s);
        };
        const publish = () => { if (!gone) setStates(new Map(out)); };
        (async () => {
            const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
            const { data, error } = await supabase.from("whatsapp_messages")
                .select("customer_phone, direction, type, template_name, status, error, sent_at")
                .eq("business_id", businessId).gte("sent_at", since).order("sent_at", { ascending: true }).limit(5000);
            if (gone || error) return;
            for (const m of (data || []) as Msg[]) apply(m);
            publish();
        })();
        const channel = supabase.channel(`wa-order-states-${businessId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages", filter: `business_id=eq.${businessId}` }, payload => {
                const m = payload.new as Msg;
                if (!m?.customer_phone) return;
                apply(m, payload.eventType === "INSERT");
                publish();
            })
            .subscribe();
        return () => { gone = true; supabase.removeChannel(channel); };
    }, [businessId]);
    return states;
}

export const chatStateOf = (states: Map<string, ChatState>, phone: string | null | undefined) =>
    (phone && states.get(last10(phone))) || null;

/** The chats page's link for a phone, whichever way it was written. */
export const chatHref = (state: ChatState | null, phone: string | null | undefined) =>
    `/whatsapp?phone=${encodeURIComponent(state?.phone || (last10(phone).length === 10 ? `0${last10(phone)}` : String(phone || "")))}`;

function since(iso: string, now: number) {
    const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
    if (min < 1) return "دلوقتي";
    if (min < 60) return `من ${min} دقيقة`;
    const h = Math.floor(min / 60);
    if (h < 24) return h === 1 ? "من ساعة" : h === 2 ? "من ساعتين" : `من ${h} ساعات`;
    const d = Math.floor(h / 24);
    return d === 1 ? "من يوم" : d === 2 ? "من يومين" : `من ${d} أيام`;
}

const SEEN: Record<string, string> = { read: "العميل قراه ✓✓", delivered: "وصله", sent: "لسه ما وصلوش", failed: "ما وصلش", pending: "بيتبعت" };

export function OrderChatStatus({ state, now }: { state: ChatState | null; now: number }) {
    if (!state) return null;
    const waiting = state.lastDirection === "in";
    if (!waiting && state.noWhatsApp && state.lastDirection === "out") {
        return (
            <p dir="rtl" className="mx-4 mb-4 rounded-xl bg-amber-50 px-3 py-2.5 text-[15px] font-semibold text-amber-900 ring-1 ring-amber-300 sm:mx-5 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-800">
                رسالة التأكيد ما وصلتش: الرقم ده غالباً مش عليه واتساب. كلّمه تليفون.
            </p>
        );
    }
    const text = waiting
        ? `العميل بعت ${state.waiting > 1 ? `${state.waiting} رسايل` : "رسالة"} ${since(state.lastAt, now)}`
        : state.confirmSentAt
            ? `التأكيد اتبعت ${since(state.confirmSentAt, now)} · ${SEEN[state.confirmStatus || ""] || "اتبعت"}`
            : `آخر رسالة مننا ${since(state.lastAt, now)}`;
    return (
        <div dir="rtl" className={cn(
            "mx-4 mb-4 flex items-center justify-between gap-2 rounded-xl px-3 py-2 sm:mx-5",
            waiting ? "bg-[#25d366]/15 ring-1 ring-[#25d366]/50" : "bg-muted",
        )}>
            <p className={cn("flex min-w-0 items-center gap-2 text-sm sm:text-[15px]", waiting ? "font-bold text-[#0b7a3e] dark:text-[#25d366]" : "font-medium text-muted-foreground")}>
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                    {waiting && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#25d366] opacity-60 motion-reduce:hidden" />}
                    <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", waiting ? "bg-[#25d366]" : "bg-muted-foreground/50")} />
                </span>
                <span className="min-w-0">{text}</span>
            </p>
            <Link href={chatHref(state, state.phone)}
                className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold",
                    waiting ? "bg-[#25d366] text-white hover:bg-[#1fb855]" : "bg-background ring-1 ring-border hover:bg-muted")}>
                <MessageCircle className="h-4 w-4" />{waiting ? "رد عليه" : "الشات"}
            </Link>
        </div>
    );
}

/** The shipping templates, by what the customer reads. */
const SHIPPING_TEMPLATES: Record<string, string> = {
    delivery_failed: "المندوب ماقدرش يوصله", order_returning: "الشحنة راجعة", order_shipped: "اتشحن", order_delivered: "اتسلم",
};
const KIND_TEMPLATE = { hold: "delivery_failed", returning: "order_returning" } as const;

/**
 * The shipping problems page's WhatsApp line: the customer wrote and waits,
 * or which message went out and when; a button to send the message for the
 * order's problem when it did not go out; and the chat, always.
 */
export function ShippingChatStatus({ state, phone, now, businessId, orderId, kind }: {
    state: ChatState | null; phone: string | null | undefined; now: number; businessId: string; orderId: string;
    kind: "hold" | "returning" | null;
}) {
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    if (!phone) return null;
    const waiting = state?.lastDirection === "in";
    const t = state?.lastTemplate;
    const shippingMsg = t && SHIPPING_TEMPLATES[t.name] ? t : null;
    const due = kind && !sent && !(shippingMsg && shippingMsg.name === KIND_TEMPLATE[kind] && shippingMsg.status !== "failed");

    const send = async () => {
        setSending(true);
        const res = await fetch("/api/whatsapp/send-order", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ business_id: businessId, order_id: orderId, kind }),
        });
        const body = await res.json().catch(() => ({}));
        setSending(false);
        if (!res.ok) { toast.error(body.error || "الرسالة ما اتبعتتش."); return; }
        setSent(true);
        toast.success("الرسالة اتبعتت من رقم الشركة.");
    };

    const text = waiting
        ? `العميل بعت ${state!.waiting > 1 ? `${state!.waiting} رسايل` : "رسالة"} ${since(state!.lastAt, now)}`
        : shippingMsg?.noWhatsApp
            ? "الرسالة ما وصلتش: الرقم غالباً مش عليه واتساب"
            : shippingMsg
                ? `رسالة «${SHIPPING_TEMPLATES[shippingMsg.name]}» اتبعتت ${since(shippingMsg.at, now)} · ${SEEN[shippingMsg.status] || "اتبعتت"}`
                : state ? `آخر رسالة مننا ${since(state.lastAt, now)}` : "مفيش رسايل مع العميل لسه";

    return (
        <div dir="rtl" className={cn("space-y-2 rounded-xl px-3 py-2",
            waiting ? "bg-[#25d366]/15 ring-1 ring-[#25d366]/50" : shippingMsg?.noWhatsApp ? "bg-amber-50 ring-1 ring-amber-300 dark:bg-amber-950/40 dark:ring-amber-800" : "bg-muted")}>
            <div className="flex items-center justify-between gap-2">
                <p className={cn("flex min-w-0 items-center gap-2 text-sm sm:text-[15px]",
                    waiting ? "font-bold text-[#0b7a3e] dark:text-[#25d366]" : shippingMsg?.noWhatsApp ? "font-semibold text-amber-900 dark:text-amber-100" : "font-medium text-muted-foreground")}>
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", waiting ? "bg-[#25d366]" : "bg-muted-foreground/50")} />
                    <span className="min-w-0">{text}</span>
                </p>
                <Link href={chatHref(state, phone)}
                    className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold",
                        waiting ? "bg-[#25d366] text-white hover:bg-[#1fb855]" : "bg-background ring-1 ring-border hover:bg-muted")}>
                    <MessageCircle className="h-4 w-4" />{waiting ? "رد عليه" : "الشات"}
                </Link>
            </div>
            {due && !waiting && !shippingMsg?.noWhatsApp && (
                <button type="button" onClick={send} disabled={sending}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#25d366] text-sm font-bold text-white hover:bg-[#1fb855] disabled:opacity-60">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 -scale-x-100" />}
                    ابعتله رسالة «{SHIPPING_TEMPLATES[KIND_TEMPLATE[kind!]]}»
                </button>
            )}
        </div>
    );
}
