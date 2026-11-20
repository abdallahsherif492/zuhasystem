"use client";

import { useEffect, useState } from "react";
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
            const s = out.get(key) || { phone: m.customer_phone, lastDirection: m.direction, lastAt: m.sent_at, waiting: 0, confirmSentAt: null, confirmStatus: null, noWhatsApp: false };
            if (isNew && (m.sent_at >= s.lastAt || !out.has(key))) {
                s.waiting = m.direction === "in" ? (s.lastDirection === "in" && out.has(key) ? s.waiting + 1 : 1) : 0;
                s.lastDirection = m.direction;
                s.lastAt = m.sent_at;
            }
            if (m.direction === "out" && m.template_name && CONFIRM_TEMPLATES.includes(m.template_name) && (!s.confirmSentAt || m.sent_at >= s.confirmSentAt)) {
                s.confirmSentAt = m.sent_at;
                s.confirmStatus = m.status;
                s.noWhatsApp = m.status === "failed" && JSON.stringify(m.error || "").includes("131026");
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
            <Link href={`/whatsapp?phone=${encodeURIComponent(state.phone)}`}
                className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold",
                    waiting ? "bg-[#25d366] text-white hover:bg-[#1fb855]" : "bg-background ring-1 ring-border hover:bg-muted")}>
                <MessageCircle className="h-4 w-4" />{waiting ? "رد عليه" : "الشات"}
            </Link>
        </div>
    );
}
