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
}

const last10 = (p: string | null | undefined) => (p || "").replace(/\D/g, "").slice(-10);

/** Live: a new message or a changed status shows at once. */
export function useChatStates(businessId: string | undefined) {
    const [states, setStates] = useState<Map<string, ChatState>>(new Map());
    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        const load = async () => {
            const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
            const { data, error } = await supabase.from("whatsapp_messages")
                .select("customer_phone, direction, type, template_name, status, sent_at")
                .eq("business_id", businessId).gte("sent_at", since).order("sent_at", { ascending: true }).limit(5000);
            if (gone || error) return;
            const out = new Map<string, ChatState>();
            for (const m of data || []) {
                if (m.type === "reaction") continue;
                const key = last10(m.customer_phone);
                const s = out.get(key) || { phone: m.customer_phone, lastDirection: m.direction, lastAt: m.sent_at, waiting: 0, confirmSentAt: null, confirmStatus: null };
                s.lastDirection = m.direction;
                s.lastAt = m.sent_at;
                s.waiting = m.direction === "in" ? s.waiting + 1 : 0;
                if (m.direction === "out" && m.template_name && CONFIRM_TEMPLATES.includes(m.template_name)) {
                    s.confirmSentAt = m.sent_at;
                    s.confirmStatus = m.status;
                }
                out.set(key, s);
            }
            setStates(out);
        };
        load();
        let timer: ReturnType<typeof setTimeout> | null = null;
        const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(load, 800); };
        const channel = supabase.channel(`wa-order-states-${businessId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages", filter: `business_id=eq.${businessId}` }, soon)
            .subscribe();
        return () => { gone = true; if (timer) clearTimeout(timer); supabase.removeChannel(channel); };
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

const SEEN: Record<string, string> = { read: "العميل قراها", delivered: "وصلت للعميل", sent: "اتبعتت", failed: "ما وصلتش", queued: "لسه بتتبعت" };

export function OrderChatStatus({ state, now }: { state: ChatState | null; now: number }) {
    if (!state) return null;
    const waiting = state.lastDirection === "in";
    const text = waiting
        ? `العميل بعت ${state.waiting > 1 ? `${state.waiting} رسايل` : "رسالة"} ${since(state.lastAt, now)} ومستني رد`
        : state.confirmSentAt
            ? `رسالة التأكيد اتبعتت ${since(state.confirmSentAt, now)} · ${SEEN[state.confirmStatus || ""] || "اتبعتت"}`
            : `آخر رسالة مننا ${since(state.lastAt, now)}`;
    return (
        <div dir="rtl" className={cn(
            "mx-4 mb-4 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 sm:mx-5",
            waiting ? "bg-[#25d366]/15 ring-1 ring-[#25d366]/50" : "bg-muted",
        )}>
            <p className={cn("flex min-w-0 items-center gap-2 text-[15px]", waiting ? "font-bold text-[#0b7a3e] dark:text-[#25d366]" : "font-medium text-muted-foreground")}>
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                    {waiting && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#25d366] opacity-60 motion-reduce:hidden" />}
                    <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", waiting ? "bg-[#25d366]" : "bg-muted-foreground/50")} />
                </span>
                <span className="min-w-0">{text}</span>
            </p>
            <Link href={`/whatsapp?phone=${encodeURIComponent(state.phone)}`}
                className={cn("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold",
                    waiting ? "bg-[#25d366] text-white hover:bg-[#1fb855]" : "bg-background ring-1 ring-border hover:bg-muted")}>
                <MessageCircle className="h-4 w-4" />{waiting ? "رد عليه" : "افتح الشات"}
            </Link>
        </div>
    );
}
