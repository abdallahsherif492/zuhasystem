"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
    ArrowDown, ArrowRight, Check, CheckCheck, Clock, Copy, CornerUpLeft, FileText, Loader2, MapPin, MessageCircle, MessageSquareDot,
    Camera, ImageIcon, Images, Paperclip, Pencil, Phone, Search, Send, Smile, TriangleAlert, User, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useBusiness } from "@/contexts/BusinessContext";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { teamName } from "@/lib/team-names";
import { egp } from "@/components/orders/order-summary";
import { telLink } from "@/lib/orders/contact";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { CancelOrderDialog } from "@/components/orders/cancel-order-dialog";
import { OrderEditDialog } from "@/components/whatsapp/order-edit-dialog";
import { SavedRepliesManager, fillReply, useSavedReplies } from "@/components/whatsapp/saved-replies";
import { CANCEL_REASON_FALLBACK, FLOW_CANCEL_REASONS, cancelReasonLabel, type CancelReason } from "@/lib/orders/cancel-reasons";
import { applyToChats, chatFromRow, chatsOf, type ChatListRow, preview, tappedButtonId, windowUntil, type Chat, type WaMessage } from "@/lib/whatsapp/chats";
import { clockLabel } from "@/lib/orders/confirm-queue";

/**
 * المحادثات, laid out like WhatsApp: the chats on one side, the conversation
 * on the other (one at a time on a phone), on the chat wallpaper, with day
 * separators, quoted replies, reactions, photos, voice notes and files,
 * delivery ticks, and template messages drawn the way the customer sees them
 * (photo, text, buttons). Replies go from the business number; the
 * customer's last message is marked read when the chat is opened. Above each
 * chat, the customer's orders, with sending the confirmation and confirming
 * a tap away. Voice notes and calls are not sent from here.
 */

type Filter = "unread" | "waiting" | "mine" | "all";
type Topic = "all" | "confirm" | "shipping";

interface OrderLite {
    id: string; status: string; total_amount: number; paid_amount: number | null; created_at: string; closed_by?: string | null;
    customer_info: { name?: string; phone?: string; governorate?: string; address?: string } | null;
    order_items: { quantity: number; variant_id: string | null; unmapped_name: string | null; variants: { title: string | null; products: { name: string | null; image_url?: string | null } | null } | null }[];
}

const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);
const STATUS_AR: Record<string, string> = {
    waiting: "في الانتظار", pending: "اتأكد", processing: "بيتجهز", prepared: "جاهز", shipped: "اتشحن", "hold to redeliver": "المندوب ماقدرش يوصله",
    delivered: "اتسلم", collected: "اتحصّل", returned: "رجع", returning: "راجع", cancelled: "ملغي",
};
const EMOJIS = ["😊", "🌸", "❤️", "👍", "🙏", "✅", "🎉", "😍", "😂", "🤍", "👌", "📦", "🚚", "⏰", "💰", "🔥", "✨", "🙌", "😉", "👋"];
const TZ = "Africa/Cairo";
const time = (iso: string) => new Date(iso).toLocaleTimeString("ar-EG-u-nu-latn", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
function dayLabel(iso: string) {
    const k = dayKey(iso);
    if (k === dayKey(new Date().toISOString())) return "النهارده";
    if (k === dayKey(new Date(Date.now() - 86_400_000).toISOString())) return "امبارح";
    return new Date(iso).toLocaleDateString("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
}
function listTime(iso: string) {
    const k = dayKey(iso);
    if (k === dayKey(new Date().toISOString())) return time(iso);
    if (k === dayKey(new Date(Date.now() - 86_400_000).toISOString())) return "امبارح";
    return new Date(iso).toLocaleDateString("ar-EG-u-nu-latn", { day: "numeric", month: "numeric", timeZone: TZ });
}

export default function WhatsAppChatsPage() {
    return <Suspense fallback={<div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}><Chats /></Suspense>;
}

function Chats() {
    const { activeBusiness, currentUser } = useBusiness();
    const params = useSearchParams();
    const businessId = activeBusiness?.id;
    const me = currentUser?.email?.toLowerCase() ?? null;
    // The list: one row per chat, worked out in the database (whatsapp_chat_list,
    // 20261129). The open chat's messages are read when it opens. Both follow
    // the live feed without reading anything again.
    const [chats, setChats] = useState<Chat[] | null>(null);
    const [thread, setThread] = useState<WaMessage[] | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>(params.get("phone") ? "all" : "waiting");
    const [topic, setTopic] = useState<Topic>("all");
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState<string | null>(params.get("phone"));
    const [now, setNow] = useState(() => Date.now());
    const [typing, setTyping] = useState<Record<string, string>>({});
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
    const openRef = useRef(open);
    useEffect(() => { openRef.current = open; }, [open]);

    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        (async () => {
            const rpc = await supabase.rpc("whatsapp_chat_list", { p_business: businessId, p_days: 60 });
            if (gone) return;
            if (!rpc.error) { setChats(((rpc.data || []) as ChatListRow[]).map(chatFromRow)); return; }
            // Before 20261129: the latest messages, light columns (PostgREST gives at most 1,000).
            const { data, error } = await supabase.from("whatsapp_messages")
                .select("id, business_id, wa_message_id, direction, customer_phone, contact_name, type, body, media_id, media_mime, context_id, template_name, status, sent_by, order_id, sent_at")
                .eq("business_id", businessId).order("sent_at", { ascending: false }).limit(1000);
            if (gone) return;
            if (error) { setProblem(/whatsapp_messages/.test(error.message) ? "شغّل ملف 20261124_whatsapp_messages.sql في Supabase الأول." : error.message); setChats([]); return; }
            setChats(chatsOf((data || []) as WaMessage[], me));
        })();
        const channel = supabase.channel(`wa-messages-${businessId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages", filter: `business_id=eq.${businessId}` }, payload => {
                const row = payload.new as WaMessage;
                if (!row?.id) return;
                const isNew = payload.eventType === "INSERT";
                setChats(prev => (prev ? applyToChats(prev, row, isNew, me) : prev));
                if (row.customer_phone !== openRef.current) return;
                setThread(prev => {
                    if (!prev) return prev;
                    const i = prev.findIndex(m => m.id === row.id || (row.wa_message_id && m.wa_message_id === row.wa_message_id));
                    if (i === -1) {
                        // Our own message arriving before its send answered: it takes the stand-in's place.
                        const stand = row.direction === "out" ? prev.findIndex(m => m.id.startsWith("tmp-") && (m.body || "") === (row.body || "")) : -1;
                        if (stand !== -1) { const next = prev.slice(); next[stand] = row; return next; }
                        return [...prev, row];
                    }
                    const next = prev.slice(); next[i] = { ...prev[i], ...row }; return next;
                });
            })
            .subscribe();
        return () => { gone = true; supabase.removeChannel(channel); };
    }, [businessId, me]);

    // The open chat's messages (the last 300), read when it opens.
    useEffect(() => {
        if (!businessId || !open) return;
        let gone = false;
        (async () => {
            const { data } = await supabase.from("whatsapp_messages").select("*")
                .eq("business_id", businessId).eq("customer_phone", open).order("sent_at", { ascending: false }).limit(300);
            if (gone) return;
            setThread(((data || []) as WaMessage[]).reverse());
            // Opened: its messages are read (the read call marks them; the list follows at once).
            setChats(prev => prev?.map(c => (c.phone === open ? { ...c, unread: 0 } : c)) ?? prev);
        })();
        return () => { gone = true; };
    }, [businessId, open]);

    const presence = useRef<ReturnType<typeof supabase.channel> | null>(null);
    useEffect(() => {
        if (!businessId || !me) return;
        const ch = supabase.channel(`wa-presence-${businessId}`, { config: { presence: { key: me } } });
        ch.on("presence", { event: "sync" }, () => {
            const state = ch.presenceState() as Record<string, { phone?: string | null }[]>;
            const out: Record<string, string> = {};
            for (const [email, metas] of Object.entries(state)) { const p = metas[metas.length - 1]?.phone; if (p) out[email] = p; }
            setTyping(out);
        }).subscribe(status => { if (status === "SUBSCRIBED") ch.track({ phone: null }); });
        presence.current = ch;
        return () => { supabase.removeChannel(ch); presence.current = null; };
    }, [businessId, me]);
    useEffect(() => { presence.current?.track({ phone: open }); }, [open]);

    const all = chats || [];
    const q = query.trim();
    const shown = all.filter(c =>
        (topic === "all" || c.topic === topic)
        && (filter === "all" || (filter === "unread" ? c.unread > 0 || c.phone === open : filter === "waiting" ? c.last.direction === "in" : c.mine))
        && (!q || c.phone.includes(q.replace(/\D/g, "") || "~") || (c.name || "").includes(q) || (c.last.body || "").includes(q)));
    // The section (all / confirmations / shipping problems) narrows every filter below it.
    const inTopic = (t: Topic) => all.filter(c => t === "all" || c.topic === t);
    const scoped = inTopic(topic);
    const counts = { unread: scoped.filter(c => c.unread > 0).length, waiting: scoped.filter(c => c.last.direction === "in").length, mine: scoped.filter(c => c.mine).length, all: scoped.length };
    const topicUnread = (t: Topic) => inTopic(t).filter(c => c.unread > 0 || c.last.direction === "in").length;
    const current: Chat | null = all.find(c => c.phone === open) || null;
    const others = (phone: string) => Object.entries(typing).filter(([email, p]) => p === phone && email !== me).map(([email]) => teamName(email));
    const addSent = useCallback((m: WaMessage) => {
        setThread(prev => (prev && !prev.some(x => x.id === m.id) ? [...prev, m] : prev));
        setChats(prev => (prev ? applyToChats(prev, m, true, me) : prev));
    }, [me]);
    /**
     * A message shown the moment it is sent (a stand-in, id "tmp-…"), then the
     * saved one in its place; on failure the stand-in shows «ما وصلتش».
     */
    const settleSent = useCallback((tempId: string, real: WaMessage | null) => setThread(prev => {
        if (!prev) return prev;
        if (!real) return prev.map(m => (m.id === tempId ? { ...m, status: "failed" } : m));
        if (prev.some(m => m.id === real.id)) return prev.filter(m => m.id !== tempId);
        return prev.map(m => (m.id === tempId ? real : m));
    }), []);

    return (
        <div dir="rtl" className="-m-4 flex h-[calc(100dvh-4rem)] min-h-0 overflow-hidden border-t sm:-m-6">
            <aside className={cn("flex w-full min-w-0 flex-col border-s bg-background lg:w-[360px] lg:shrink-0", open && "hidden lg:flex")}>
                <div className="space-y-2 bg-muted/40 px-3 pb-2 pt-2.5 sm:space-y-2.5 sm:pt-3">
                    <h1 className="flex items-center gap-2 text-lg font-bold sm:text-xl"><MessageCircle className="h-5 w-5 text-[#25d366]" />المحادثات</h1>
                    <div className="relative">
                        <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="دوّر برقم أو اسم أو كلمة"
                            className="h-10 w-full rounded-lg bg-background pe-9 ps-3 text-base outline-none ring-1 ring-border focus:ring-2 focus:ring-[#25d366] sm:text-sm" />
                    </div>
                    <div className="grid grid-cols-3 rounded-lg bg-background p-0.5 ring-1 ring-border">
                        {([["all", "كل المحادثات", "الكل"], ["confirm", "التأكيدات", "التأكيدات"], ["shipping", "مشاكل الشحن", "الشحن"]] as [Topic, string, string][]).map(([k, label, short]) => (
                            <button key={k} type="button" onClick={() => setTopic(k)}
                                className={cn("flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold",
                                    topic === k ? "bg-[#008069] text-white dark:bg-[#00a884]" : "text-muted-foreground hover:bg-muted")}>
                                <span className="hidden whitespace-nowrap sm:inline">{label}</span><span className="whitespace-nowrap sm:hidden">{short}</span>
                                {k !== "all" && topicUnread(k) > 0 && <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", topic === k ? "bg-white/25" : "bg-[#25d366] text-white")}>{topicUnread(k)}</span>}
                            </button>
                        ))}
                    </div>
                    <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none]">
                        {([["all", "الكل"], ["unread", "غير مقروءة"], ["waiting", "مستنيين رد"], ["mine", "بتوعي"]] as [Filter, string][]).map(([k, label]) => (
                            <button key={k} type="button" onClick={() => setFilter(k)}
                                className={cn("shrink-0 rounded-full px-3 py-1.5 text-sm font-medium", filter === k ? "bg-[#d9fdd3] text-[#008069] dark:bg-[#0a332c] dark:text-[#25d366]" : "bg-background text-muted-foreground ring-1 ring-border hover:bg-muted")}>
                                {label}{counts[k] > 0 && <span className="ms-1 tabular-nums">{counts[k]}</span>}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {chats === null ? <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                        : problem ? <p className="p-4 text-sm font-medium text-amber-700">{problem}</p>
                        : shown.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">{filter === "waiting" ? "مفيش حد مستني رد هنا 👌" : filter === "unread" ? "مفيش رسايل غير مقروءة هنا 👌" : "مفيش محادثات هنا."}</p>
                        : shown.map(c => {
                            const unreadNow = c.unread > 0 && c.phone !== open;
                            const waitingNow = c.last.direction === "in" && c.waiting > 0;
                            return (
                                <button key={c.phone} type="button" onClick={() => { if (c.phone !== open) { setThread(null); setOpen(c.phone); } }}
                                    className={cn("flex w-full items-center gap-3 px-3 text-start active:bg-muted hover:bg-muted/60", open === c.phone && "bg-muted")}>
                                    <Avatar name={c.name || c.phone} />
                                    <span className="min-w-0 flex-1 border-b py-3">
                                        <span className="flex items-center justify-between gap-2">
                                            <span className={cn("truncate text-[15px]", unreadNow ? "font-bold" : "font-semibold")}>{c.name || c.phone}</span>
                                            <span className={cn("shrink-0 text-xs", unreadNow ? "font-semibold text-[#25d366]" : "text-muted-foreground")}>{listTime(c.last.sent_at)}</span>
                                        </span>
                                        <span className="mt-0.5 flex items-center justify-between gap-2">
                                            <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                                                {c.last.direction === "out" && <Ticks status={c.last.status} />}
                                                <span className="truncate">{preview(c.last)}</span>
                                            </span>
                                            {unreadNow
                                                ? <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#25d366] px-1.5 text-xs font-bold text-white">{c.unread}</span>
                                                : waitingNow && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">مستني رد</span>}
                                        </span>
                                        {others(c.phone).length > 0 && <span className="text-xs font-semibold text-amber-600">{others(c.phone).join("، ")} فاتح المحادثة</span>}
                                    </span>
                                </button>
                            );
                        })}
                </div>
            </aside>

            <section className={cn("min-w-0 flex-1 flex-col", open ? "flex" : "hidden lg:flex")}>
                {open && businessId
                    ? <ChatView key={open} phone={open} chat={current} businessId={businessId} me={me} now={now}
                        others={others(open)} onBack={() => setOpen(null)} onSent={addSent} onSettled={settleSent}
                        messages={thread || []} loading={thread === null} />
                    : <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-muted/30 p-6 text-center text-muted-foreground">
                        <MessageCircle className="h-12 w-12 text-[#25d366]/60" />
                        <p className="text-lg font-semibold text-foreground">واتساب {activeBusiness?.name || ""}</p>
                        <p className="text-sm">اختار محادثة من القايمة عشان تكمل مع العميل.</p>
                    </div>}
            </section>
        </div>
    );
}

/** The order's number as printed on the waybill and in the messages. */
const orderRef = (id: string) => id.slice(0, 8).toUpperCase();

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
    return (
        <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-base font-bold text-[#54656f] dark:bg-[#2a3942] dark:text-[#aebac1]">
            {/^[\d+\s]+$/.test(name.trim()) ? <User className="h-[55%] w-[55%]" /> : name.trim().charAt(0)}
        </span>
    );
}

function ChatView({ phone, chat, messages, loading, businessId, me, now, others, onBack, onSent, onSettled }: {
    phone: string; chat: Chat | null; messages: WaMessage[]; loading: boolean; businessId: string; me: string | null; now: number;
    others: string[]; onBack: () => void; onSent: (m: WaMessage) => void; onSettled: (tempId: string, real: WaMessage | null) => void;
}) {
    const { currentUser } = useBusiness();
    const [orders, setOrders] = useState<OrderLite[] | null>(null);
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const [replyTo, setReplyTo] = useState<WaMessage | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [atBottom, setAtBottom] = useState(true);
    const scroller = useRef<HTMLDivElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const lastRead = useRef<string | null>(null);
    const until = chat ? windowUntil(chat) : null;
    const isOpen = !!until && until > now;

    const byWaId = useMemo(() => new Map(messages.filter(m => m.wa_message_id).map(m => [m.wa_message_id!, m])), [messages]);
    const reactions = useMemo(() => {
        const out = new Map<string, string>();
        for (const m of messages) if (m.type === "reaction" && m.context_id) out.set(m.context_id, m.body || "");
        return out;
    }, [messages]);
    const visible = messages.filter(m => m.type !== "reaction");

    // Stays on the latest message while it is in view: when a message comes,
    // and when the box or its content changes size (the orders strip loading
    // above, a photo loading, the keyboard opening on a phone).
    const pinned = useRef(true);
    useEffect(() => { pinned.current = atBottom; }, [atBottom]);
    useEffect(() => {
        const el = scroller.current;
        if (el && atBottom) el.scrollTop = el.scrollHeight;
    }, [visible.length, atBottom]);
    useEffect(() => {
        const el = scroller.current;
        if (!el) return;
        const stick = () => { if (pinned.current) el.scrollTop = el.scrollHeight; };
        const ro = new ResizeObserver(stick);
        ro.observe(el);
        el.addEventListener("load", stick, true);
        return () => { ro.disconnect(); el.removeEventListener("load", stick, true); };
    }, []);

    useEffect(() => {
        const unread = messages.filter(m => m.direction === "in" && m.status === "received" && m.type !== "reaction");
        const latest = unread[unread.length - 1];
        if (!latest || lastRead.current === latest.id) return;
        lastRead.current = latest.id;
        fetch("/api/whatsapp/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ business_id: businessId, customer_phone: phone, wa_message_id: latest.wa_message_id }) }).catch(() => undefined);
    }, [messages, businessId, phone]);

    const markUnread = async () => {
        lastRead.current = "unread";
        onBack();
        await fetch("/api/whatsapp/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ business_id: businessId, customer_phone: phone, unread: true }) }).catch(() => undefined);
    };

    const loadOrders = useCallback(async () => {
        const { data } = await supabase.from("orders")
            .select("id, status, total_amount, paid_amount, closed_by, created_at, customer_info, order_items(quantity, variant_id, unmapped_name, variants(title, products(name, image_url)))")
            .eq("business_id", businessId).ilike("customer_info->>phone", `%${last10(phone)}%`)
            .order("created_at", { ascending: false }).limit(5);
        setOrders((data || []) as unknown as OrderLite[]);
    }, [businessId, phone]);
    useEffect(() => {
        let gone = false;
        (async () => { if (!gone) await loadOrders(); })();
        return () => { gone = true; };
    }, [loadOrders]);

    const name = chat?.name || orders?.[0]?.customer_info?.name || phone;
    const waitingOrder = orders?.find(o => o.status?.toLowerCase() === "waiting") || null;

    const post = async (url: string, body: BodyInit, json = true) => {
        setSending(true);
        const res = await fetch(url, { method: "POST", ...(json ? { headers: { "Content-Type": "application/json" } } : {}), body });
        const out = await res.json().catch(() => ({}));
        setSending(false);
        if (!res.ok) { toast.error(out.error || "الرسالة ما اتبعتتش."); return false; }
        if (out.message?.id) onSent(out.message as WaMessage);
        setAtBottom(true);
        return true;
    };

    const sendNow = async () => {
        if (sending) return;
        if (file) {
            const form = new FormData();
            form.append("business_id", businessId); form.append("phone", phone); form.append("file", file);
            if (text.trim()) form.append("caption", text.trim());
            if (replyTo?.wa_message_id) form.append("reply_to", replyTo.wa_message_id);
            if (await post("/api/whatsapp/send-media", form, false)) { setFile(null); setText(""); setReplyTo(null); }
            return;
        }
        if (!text.trim() || /^\/\S*$/.test(text.trim())) return; // a «/» search is not a message
        // Shown at once and the box cleared, so the next message can be typed
        // while this one goes; sends go one after another, in order.
        const body = text.trim(), ctx = replyTo?.wa_message_id || null;
        const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        onSent({
            id: tempId, business_id: businessId, wa_message_id: null, direction: "out", customer_phone: phone, contact_name: null,
            type: "text", body, media_id: null, media_mime: null, context_id: ctx, payload: null, template_name: null,
            status: "pending", error: null, sent_by: me, order_id: null, sent_at: new Date().toISOString(),
        });
        setText(""); setReplyTo(null); setAtBottom(true);
        textQueue.current = textQueue.current.then(async () => {
            const res = await fetch("/api/whatsapp/send", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ business_id: businessId, phone, text: body, reply_to: ctx }),
            }).catch(() => null);
            const out = res ? await res.json().catch(() => ({})) : {};
            if (!res?.ok) {
                onSettled(tempId, null);
                toast.error(out.error || "الرسالة ما اتبعتتش.");
                setText(prev => prev || body); // back in the box, to send again
                return;
            }
            onSettled(tempId, (out.message as WaMessage) || null);
        });
    };
    const textQueue = useRef<Promise<void>>(Promise.resolve());

    // A product's photo, sent at once with its name (no file to look for).
    const sendProductPhoto = async (image: string, name: string) => {
        setPhotos(false);
        const form = new FormData();
        form.append("business_id", businessId); form.append("phone", phone); form.append("image_url", image); form.append("caption", name);
        await post("/api/whatsapp/send-media", form, false);
    };
    const [photos, setPhotos] = useState(false);
    // «الردود المحفوظة» (components/whatsapp/saved-replies.tsx).
    const { replies: savedReplies, ready: repliesReady, reload: reloadReplies } = useSavedReplies(businessId);
    const [manageReplies, setManageReplies] = useState(false);
    const [attachOpen, setAttachOpen] = useState(false);
    const galleryInput = useRef<HTMLInputElement>(null);
    const cameraInput = useRef<HTMLInputElement>(null);
    const [catalog, setCatalog] = useState<{ id: string; name: string; image_url: string }[] | null>(null);
    const [photoQuery, setPhotoQuery] = useState("");
    const openPhotos = async (o: boolean) => {
        setPhotos(o);
        if (o && !catalog) {
            const { data } = await supabase.from("products").select("id, name, image_url").eq("business_id", businessId)
                .not("image_url", "is", null).eq("archived", false).order("name").limit(400);
            setCatalog((data || []) as { id: string; name: string; image_url: string }[]);
        }
    };
    // A photo pasted (Ctrl/Cmd+V) or dropped on the chat: attached, ready to send.
    const takeFile = (files: FileList | null | undefined) => {
        const f = files?.[0];
        if (f && (f.type.startsWith("image/") || f.type.startsWith("video/") || f.type === "application/pdf")) { setFile(f); return true; }
        return false;
    };

    const sendConfirmation = (o: OrderLite) => post("/api/whatsapp/send-order", JSON.stringify({ business_id: businessId, order_id: o.id }));
    // The message for a shipping problem, from the company number.
    const shippingKind = (o: OrderLite) => { const st = o.status?.toLowerCase() || ""; return st.includes("hold") ? "hold" : st === "returning" ? "returning" : null; };
    const sendShipping = (o: OrderLite) => post("/api/whatsapp/send-order", JSON.stringify({ business_id: businessId, order_id: o.id, kind: shippingKind(o) }));
    const problemOrder = orders?.find(o => shippingKind(o)) || null;
    // «تم الإرسال لشركة الشحن»: the moderator passed the customer's answer to
    // the courier — a follow-up in their name on the shipping problems page,
    // which their daily target counts.
    const [sentToCourier, setSentToCourier] = useState<Set<string>>(new Set());
    const markSentToCourier = async (o: OrderLite) => {
        const { error } = await supabase.from("shipping_followups").insert({
            business_id: businessId, order_id: o.id, outcome: "courier_contacted",
            note: "اتبعت لشركة الشحن بعد المتابعة مع العميل على الواتساب", next_action_at: null, created_by: me || currentUser?.email || "Staff",
        });
        if (error) { toast.error("ما اتسجلش، جرّب تاني."); return; }
        setSentToCourier(prev => new Set(prev).add(o.id));
        logBusinessAction({
            businessId, userEmail: currentUser?.email || "Staff", actionType: "edit", entityType: "order", entityId: o.id,
            entityName: `Order #${o.id.slice(0, 8)}`, changes: [{ field: "Shipping follow-up", old_value: null, new_value: "اتبعت لشركة الشحن (من الواتساب)" }],
        });
        toast.success("اتسجل إنك تابعت الأوردر ده مع شركة الشحن.");
    };

    // «عدّل الأوردر»: the «New from stores» edit section, over the chat.
    const [editing, setEditing] = useState<string | null>(null);

    // «الغي الأوردر»: the same reasons as the confirmations page.
    const [cancelling, setCancelling] = useState<OrderLite | null>(null);
    const cancelOrder = async (o: OrderLite, reason: CancelReason, note: string | null) => {
        const attempt = (r: CancelReason, n: string | null) => supabase.from("orders")
            .update({ status: "Cancelled", cancel_reason: r, cancel_note: n })
            .eq("business_id", businessId).eq("id", o.id).ilike("status", "waiting").select("id");
        let { data, error } = await attempt(reason, note);
        const older = CANCEL_REASON_FALLBACK[reason];
        if (error?.code === "23514" && older) ({ data, error } = await attempt(older, [cancelReasonLabel(reason), note].filter(Boolean).join(" — ")));
        if (error) { toast.error("ما اتلغاش، جرّب تاني."); return; }
        if (!data?.length) { toast.info("الأوردر اتنقل قبل كده من زميلك."); loadOrders(); return; }
        logBusinessAction({
            businessId, userEmail: currentUser?.email || "Staff", actionType: "update_status", entityType: "order", entityId: o.id,
            entityName: `Order #${o.id.slice(0, 8)}`, changes: [{ field: "Status", old_value: o.status, new_value: `Cancelled (from WhatsApp: ${cancelReasonLabel(reason)})` }],
        });
        toast.success("الأوردر اتلغى.");
        loadOrders();
    };

    const confirmOrder = async (o: OrderLite) => {
        if (o.order_items.some(i => !i.variant_id) || (Number(o.paid_amount) || 0) > 0) {
            toast.info("الأوردر ده محتاج يتأكد من صفحة التأكيد (منتج مش متربط أو ديبوزت).");
            return;
        }
        const { data, error } = await supabase.from("orders")
            .update({ status: "Pending", ...(o.closed_by ? {} : { closed_by: me }) })
            .eq("business_id", businessId).eq("id", o.id).ilike("status", "waiting").select("id");
        if (error) { toast.error("ما اتأكدش، جرّب تاني."); return; }
        if (!data?.length) { toast.info("الأوردر اتنقل قبل كده من زميلك."); loadOrders(); return; }
        logBusinessAction({
            businessId, userEmail: currentUser?.email || "Staff", actionType: "update_status", entityType: "order", entityId: o.id,
            entityName: `Order #${o.id.slice(0, 8)}`, changes: [{ field: "Status", old_value: o.status, new_value: "Pending (from WhatsApp)" }],
        });
        toast.success("الأوردر اتأكد.");
        loadOrders();
    };

    return (
        <>
            <header className="flex items-center justify-between gap-2 bg-muted/40 px-2 py-2 sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-10 w-10 lg:hidden" onClick={onBack} aria-label="ارجع للمحادثات"><ArrowRight className="h-6 w-6" /></Button>
                    <Avatar name={name} size={40} />
                    <div className="min-w-0">
                        <p className="truncate text-base font-semibold leading-tight">{name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                            {others.length > 0 ? <span className="font-semibold text-amber-600">{others.join("، ")} فاتح المحادثة</span> : <span dir="ltr">{phone}</span>}
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center">
                    <Button variant="ghost" size="icon" className="h-10 w-10" onClick={markUnread} aria-label="علّمها غير مقروءة" title="علّمها غير مقروءة"><MessageSquareDot className="h-5 w-5" /></Button>
                    <Button asChild variant="ghost" size="icon" className="h-10 w-10" aria-label="اتصل"><a href={telLink(phone)}><Phone className="h-5 w-5" /></a></Button>
                </div>
            </header>

            {orders && orders.length > 0 && (
                <div className="flex shrink-0 snap-x gap-2 overflow-x-auto border-b bg-background px-2 py-2 sm:px-3">
                    {orders.slice(0, 3).map(o => {
                        const waiting = o.status?.toLowerCase() === "waiting";
                        const img = o.order_items.map(i => i.variants?.products?.image_url).find(Boolean);
                        return (
                            <div key={o.id} className="flex w-[85%] max-w-sm shrink-0 snap-start items-center gap-2.5 rounded-xl border p-2 sm:w-auto sm:min-w-[300px]">
                                {img ? /* eslint-disable-next-line @next/next/no-img-element */ <img loading="lazy" decoding="async" src={img} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                                    : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">📦</span>}
                                <div className="min-w-0 flex-1 text-sm">
                                    <p className="flex items-center gap-2 truncate">
                                        <span className="font-mono text-[13px] font-bold tracking-wider" dir="ltr">#{orderRef(o.id)}</span>
                                        <span className={cn("text-xs font-semibold", waiting ? "text-amber-600" : "text-muted-foreground")}>{STATUS_AR[o.status?.toLowerCase()] || o.status}</span>
                                    </p>
                                    <p className="truncate font-semibold">{egp(o.total_amount)}</p>
                                    <p className="truncate text-xs text-muted-foreground">{o.order_items.map(i => `${i.variants?.products?.name || i.unmapped_name || "منتج"} ×${i.quantity}`).join("، ")}</p>
                                    {shippingKind(o) && (
                                        <div className="mt-1 flex flex-wrap gap-1.5">
                                            <button type="button" disabled={sending} onClick={() => sendShipping(o)} className="rounded-md border px-2.5 py-1 text-xs font-semibold hover:bg-muted">
                                                {shippingKind(o) === "hold" ? "ابعت «المندوب ماقدرش يوصله»" : "ابعت «الشحنة راجعة»"}
                                            </button>
                                            <button type="button" disabled={sentToCourier.has(o.id)} onClick={() => markSentToCourier(o)}
                                                className="rounded-md bg-[#008069] px-2.5 py-1 text-xs font-bold text-white hover:bg-[#006e5a] disabled:opacity-60">
                                                {sentToCourier.has(o.id) ? "✓ اتبعت لشركة الشحن" : "تم الإرسال لشركة الشحن"}
                                            </button>
                                        </div>
                                    )}
                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                        <button type="button" onClick={() => setEditing(o.id)} className="rounded-md border px-2.5 py-1 text-xs font-semibold hover:bg-muted">عدّل الأوردر</button>
                                    </div>
                                    {waiting && (
                                        <div className="mt-1 flex gap-1.5">
                                            <button type="button" disabled={sending} onClick={() => sendConfirmation(o)} className="rounded-md border px-2.5 py-1 text-xs font-semibold hover:bg-muted">ابعت التأكيد</button>
                                            <button type="button" onClick={() => confirmOrder(o)} className="rounded-md bg-[#25d366] px-2.5 py-1 text-xs font-bold text-white hover:bg-[#1fb855]">أكّد الأوردر</button>
                                            <button type="button" onClick={() => setCancelling(o)} className="rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-bold text-destructive hover:bg-destructive/10">الغي الأوردر</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div ref={scroller} onScroll={e => { const el = e.currentTarget; setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80); }}
                onDragOver={e => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); }}
                onDrop={e => { if (takeFile(e.dataTransfer?.files)) e.preventDefault(); }}
                className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#efeae2] px-2 py-3 dark:bg-[#0b141a] sm:px-[6%]"
                style={{ backgroundImage: "radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
                {loading && <div className="flex h-24 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#25d366]" /></div>}
                {!loading && visible.length === 0 && <p className="mx-auto mt-6 w-fit rounded-lg bg-[#fff5c4] px-3 py-1.5 text-center text-xs text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#ffd279]">مفيش رسايل لسه. ابدأ برسالة التأكيد.</p>}
                {visible.map((m, i) => {
                    const prev = visible[i - 1];
                    const showDay = !prev || dayKey(prev.sent_at) !== dayKey(m.sent_at);
                    const tail = !prev || prev.direction !== m.direction || showDay;
                    return (
                        <div key={m.id}>
                            {showDay && <div className="my-3 flex justify-center"><span className="rounded-lg bg-white px-3 py-1 text-xs text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">{dayLabel(m.sent_at)}</span></div>}
                            <Bubble m={m} tail={tail} businessId={businessId} me={me} quoted={m.context_id ? byWaId.get(m.context_id) : undefined}
                                reaction={m.wa_message_id ? reactions.get(m.wa_message_id) : undefined} onReply={() => setReplyTo(m)} />
                        </div>
                    );
                })}
                {!atBottom && (
                    <button type="button" onClick={() => setAtBottom(true)} aria-label="انزل لآخر رسالة"
                        className="sticky bottom-2 ms-auto flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-md dark:bg-[#202c33]"><ArrowDown className="h-5 w-5 text-[#54656f]" /></button>
                )}
            </div>

            <footer className="space-y-2 bg-muted/40 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4">
                {isOpen ? (
                    <>
                        {replyTo && (
                            <div className="flex items-start gap-2 rounded-lg border-s-4 border-[#25d366] bg-background px-3 py-2 text-sm">
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold text-[#008069]">{replyTo.direction === "out" ? "انت" : name}</p>
                                    <p className="truncate text-muted-foreground">{preview(replyTo)}</p>
                                </div>
                                <button type="button" onClick={() => setReplyTo(null)} aria-label="الغي الرد" className="p-1"><X className="h-4 w-4" /></button>
                            </div>
                        )}
                        {file && (
                            <div className="flex items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm">
                                <FileText className="h-5 w-5 text-[#008069]" /><span className="min-w-0 flex-1 truncate">{file.name}</span>
                                <button type="button" onClick={() => setFile(null)} aria-label="شيل الملف" className="p-1"><X className="h-4 w-4" /></button>
                            </div>
                        )}
                        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                            <button type="button" onClick={() => setManageReplies(true)}
                                className="flex shrink-0 items-center gap-1 rounded-full bg-[#d9fdd3] px-3 py-1.5 text-xs font-semibold text-[#008069] ring-1 ring-[#25d366]/40 hover:bg-[#c6f5bd] dark:bg-[#0a332c] dark:text-[#25d366]">
                                <Pencil className="h-3 w-3" />الردود المحفوظة
                            </button>
                            {(savedReplies || []).map(r => (
                                <button key={r.id} type="button" onClick={() => setText(fillReply(r.body, chat?.name || null))} title={r.body}
                                    className="shrink-0 rounded-full bg-background px-3 py-1.5 text-xs text-[#54656f] ring-1 ring-border hover:bg-muted dark:text-[#aebac1]">{r.title.length > 26 ? `${r.title.slice(0, 26)}…` : r.title}</button>
                            ))}
                        </div>
                        {text.startsWith("/") && (() => {
                            // «/» and a word: the saved replies that match, one tap to use.
                            const q = text.slice(1).trim().toLowerCase();
                            const hits = (savedReplies || []).filter(r => !q || r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q)).slice(0, 8);
                            return (
                                <div className="max-h-56 overflow-y-auto rounded-xl bg-background p-1 shadow-md ring-1 ring-border">
                                    {hits.length === 0 ? <p className="p-2 text-sm text-muted-foreground">مفيش رد فيه «{q}».</p> : hits.map(r => (
                                        <button key={r.id} type="button" onClick={() => setText(fillReply(r.body, chat?.name || null))}
                                            className="block w-full rounded-lg px-3 py-2 text-start hover:bg-muted">
                                            <span className="block text-sm font-semibold">{r.title}</span>
                                            <span className="block truncate text-xs text-muted-foreground">{r.body}</span>
                                        </button>
                                    ))}
                                </div>
                            );
                        })()}
                        <div className="flex items-end gap-1">
                            <Popover>
                                <PopoverTrigger asChild><Button variant="ghost" size="icon" className="hidden h-10 w-10 shrink-0 sm:inline-flex" aria-label="إيموجي"><Smile className="h-6 w-6 text-[#54656f]" /></Button></PopoverTrigger>
                                <PopoverContent align="start" className="grid w-64 grid-cols-8 gap-1 p-2">
                                    {EMOJIS.map(e => <button key={e} type="button" className="rounded p-1 text-xl hover:bg-muted" onClick={() => setText(t => t + e)}>{e}</button>)}
                                </PopoverContent>
                            </Popover>
                            {/* Attach: the phone's gallery (photos and videos only, so it opens the
                                gallery, not the files app), the camera, or a document. */}
                            <Popover open={attachOpen} onOpenChange={setAttachOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="ابعت صورة أو ملف"><Paperclip className="h-5 w-5 text-[#54656f]" /></Button>
                                </PopoverTrigger>
                                <PopoverContent side="top" align="start" className="w-48 p-1" dir="rtl">
                                    {([
                                        [galleryInput, ImageIcon, "المعرض", "text-[#bf59cf]"],
                                        [cameraInput, Camera, "الكاميرا", "text-[#ff2e74]"],
                                        [fileInput, FileText, "ملف", "text-[#7f66ff]"],
                                    ] as const).map(([ref, Icon, label, tone]) => (
                                        <button key={label} type="button" onClick={() => { setAttachOpen(false); ref.current?.click(); }}
                                            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[15px] hover:bg-muted">
                                            <Icon className={cn("h-5 w-5", tone)} />{label}
                                        </button>
                                    ))}
                                </PopoverContent>
                            </Popover>
                            {/* Product photos: this customer's products first, then any, one tap to send. */}
                            <Popover open={photos} onOpenChange={openPhotos}>
                                <PopoverTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="صور المنتجات"><Images className="h-5 w-5 text-[#54656f]" /></Button>
                                </PopoverTrigger>
                                <PopoverContent side="top" align="start" className="w-[min(22rem,calc(100vw-1.5rem))] p-2" dir="rtl">
                                    {(() => {
                                        const mine = [...new Map((orders || []).flatMap(o => o.order_items)
                                            .map(i => i.variants?.products).filter(pr => pr?.image_url)
                                            .map(pr => [pr!.image_url!, pr!.name || "منتج"])).entries()];
                                        const q = photoQuery.trim().toLowerCase();
                                        const all = (catalog || []).filter(pr => !q || pr.name.toLowerCase().includes(q)).slice(0, 60);
                                        const tile = (img: string, name: string) => (
                                            <button key={img} type="button" onClick={() => sendProductPhoto(img, name)} disabled={sending} title={name}
                                                className="group relative aspect-square overflow-hidden rounded-lg ring-1 ring-border hover:ring-2 hover:ring-[#25d366]">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={img} alt={name} className="h-full w-full object-cover" loading="lazy" />
                                                <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[10px] text-white">{name}</span>
                                            </button>
                                        );
                                        return (
                                            <div className="space-y-2">
                                                {mine.length > 0 && (
                                                    <>
                                                        <p className="text-xs font-semibold text-muted-foreground">منتجات أوردرات العميل</p>
                                                        <div className="grid grid-cols-4 gap-1.5">{mine.map(([img, name]) => tile(img, name))}</div>
                                                    </>
                                                )}
                                                <input value={photoQuery} onChange={e => setPhotoQuery(e.target.value)} placeholder="دوّر على منتج"
                                                    className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-[#25d366]" />
                                                {catalog === null ? <div className="flex h-20 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                                                    : <div className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto">{all.map(pr => tile(pr.image_url, pr.name))}</div>}
                                                <p className="text-[11px] text-muted-foreground">الصورة بتتبعت على طول باسم المنتج. وتقدر تلصق صورة (Ctrl+V) أو تسحبها على الشات.</p>
                                            </div>
                                        );
                                    })()}
                                </PopoverContent>
                            </Popover>
                            <input ref={galleryInput} type="file" accept="image/*,video/*" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }} />
                            <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }} />
                            <input ref={fileInput} type="file" accept="application/pdf,.doc,.docx,.xls,.xlsx" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }} />
                            <textarea value={text} onChange={e => setText(e.target.value)} rows={1} placeholder={file ? "تعليق على الملف (اختياري)" : "اكتب رسالة"}
                                onPaste={e => { if (takeFile(e.clipboardData?.files)) e.preventDefault(); }}
                                onKeyDown={e => {
                                    if (e.key !== "Enter" || e.shiftKey) return;
                                    // «/word» + Enter: the first matching saved reply, never sent as «/word».
                                    if (text.startsWith("/")) {
                                        e.preventDefault();
                                        const q = text.slice(1).trim().toLowerCase();
                                        const hit = (savedReplies || []).find(r => !q || r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q));
                                        if (hit) setText(fillReply(hit.body, chat?.name || null));
                                        return;
                                    }
                                    if (window.matchMedia("(min-width: 768px)").matches) { e.preventDefault(); sendNow(); }
                                }}
                                className="max-h-36 min-h-10 min-w-0 flex-1 resize-none rounded-2xl bg-background px-3 py-2 text-base outline-none ring-1 ring-border" />
                            <Button onClick={sendNow} disabled={sending || (!text.trim() && !file)} className="h-10 w-10 shrink-0 rounded-full bg-[#25d366] p-0 text-white hover:bg-[#1fb855]" aria-label="ابعت">
                                {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 -scale-x-100" />}
                            </Button>
                        </div>
                        <p className="text-center text-[11px] text-muted-foreground"><Clock className="me-1 inline h-3 w-3" />الرد العادي متاح لحد {clockLabel(until!, now)}</p>
                    </>
                ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#fff5c4] p-3 text-sm text-[#54656f] dark:bg-[#182229] dark:text-[#ffd279]">
                        <span>{chat?.lastIn ? "عدّت 24 ساعة من آخر رسالة من العميل، فواتساب مش بيسمح برسالة عادية. اتصل بيه أو ابعتله قالب." : "العميل لسه ما بعتش حاجة. ابدأ بقالب، ولما يرد تقدر تكتب عادي."}</span>
                        {waitingOrder ? <Button size="sm" disabled={sending} onClick={() => sendConfirmation(waitingOrder)} className="bg-[#25d366] text-white hover:bg-[#1fb855]">ابعت رسالة التأكيد</Button>
                            : problemOrder && <Button size="sm" disabled={sending} onClick={() => sendShipping(problemOrder)} className="bg-[#25d366] text-white hover:bg-[#1fb855]">{shippingKind(problemOrder) === "hold" ? "ابعت «المندوب ماقدرش يوصله»" : "ابعت «الشحنة راجعة»"}</Button>}
                    </div>
                )}
            </footer>
            <SavedRepliesManager open={manageReplies} onOpenChange={setManageReplies} businessId={businessId}
                replies={savedReplies} ready={repliesReady} reload={reloadReplies} />
            <OrderEditDialog orderId={editing} businessId={businessId} userEmail={currentUser?.email || null}
                onClose={() => { setEditing(null); loadOrders(); }} />
            {cancelling && (
                <CancelOrderDialog customerName={cancelling.customer_info?.name || name} only={FLOW_CANCEL_REASONS} description="العميل قال إيه؟"
                    open onOpenChange={v => { if (!v) setCancelling(null); }}
                    onConfirm={(reason, note) => { const o = cancelling; setCancelling(null); return cancelOrder(o, reason, note); }} />
            )}
        </>
    );
}

function Bubble({ m, tail, businessId, me, quoted, reaction, onReply }: {
    m: WaMessage; tail: boolean; businessId: string; me: string | null; quoted?: WaMessage; reaction?: string; onReply: () => void;
}) {
    const out = m.direction === "out";
    const media = m.media_id ? `/api/whatsapp/media/${m.media_id}?business_id=${businessId}` : null;
    const header = m.payload?.header_image || null;
    const buttons = m.direction === "out" && (m.type === "template" || m.type === "interactive") ? m.payload?.buttons || [] : [];
    const loc = m.payload?.location;
    // «ضيفه لطلبي» on a card: which product (its id carries the variant).
    const tapped = !out ? tappedButtonId(m.payload) : "";
    const picked = tapped.startsWith("upsell:add:") ? quoted?.payload?.cards?.find(c => c.variant_id === tapped.split(":")[3]) || null : null;
    return (
        // Tap (phone) or hover (desktop) shows reply / copy.
        <div tabIndex={0} className={cn("group flex outline-none", out ? "justify-start" : "justify-end", tail ? "mt-2" : "mt-0.5")}>
            <div className="relative max-w-[85%] sm:max-w-[65%]">
                <div className={cn("relative rounded-lg px-2 pb-1.5 pt-1.5 text-[15px] leading-relaxed text-[#111b21] shadow-sm dark:text-[#e9edef]",
                    out ? "bg-[#d9fdd3] dark:bg-[#005c4b]" : "bg-white dark:bg-[#202c33]",
                    tail && (out ? "rounded-ss-none" : "rounded-se-none"))}>
                    {picked ? (
                        // The customer tapped one card of the offer: that product, not the offer's text.
                        <div className="mb-1 flex items-center gap-2 rounded-md border-s-4 border-[#06cf9c] bg-[#f0f2f5] p-1.5 text-xs dark:bg-[#1d282f]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img loading="lazy" decoding="async" src={picked.image} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                            <span className="min-w-0">
                                <span className="block font-semibold text-[#008069] dark:text-[#06cf9c]">من العرض</span>
                                <span className="block truncate text-[13px] font-medium text-[#111b21] dark:text-[#e9edef]">{picked.title}</span>
                                <span className="text-[#54656f] dark:text-[#aebac1]">{picked.price} جنيه بدل {picked.old_price}</span>
                            </span>
                        </div>
                    ) : quoted && (
                        <div className={cn("mb-1 rounded-md border-s-4 border-[#06cf9c] px-2 py-1 text-xs", out ? "bg-[#cfe9c7] dark:bg-[#025144]" : "bg-[#f0f2f5] dark:bg-[#1d282f]")}>
                            <p className="font-semibold text-[#008069] dark:text-[#06cf9c]">{quoted.direction === "out" ? "انت" : "العميل"}</p>
                            <p className="line-clamp-2 text-[#54656f] dark:text-[#aebac1]">{preview(quoted)}</p>
                        </div>
                    )}
                    {header && /* eslint-disable-next-line @next/next/no-img-element */ <img loading="lazy" decoding="async" src={header} alt="" className="mb-1 max-h-72 w-full rounded-md object-cover" />}
                    {m.type === "image" && media && <a href={media} target="_blank" rel="noreferrer">{/* eslint-disable-next-line @next/next/no-img-element */}<img loading="lazy" decoding="async" src={media} alt="صورة" className="mb-1 max-h-80 rounded-md" /></a>}
                    {m.type === "sticker" && media && /* eslint-disable-next-line @next/next/no-img-element */ <img loading="lazy" decoding="async" src={media} alt="ملصق" className="h-32 w-32" />}
                    {m.type === "audio" && media && <audio controls preload="none" src={media} className="my-1 w-64 max-w-full" />}
                    {m.type === "video" && media && <video controls preload="metadata" src={media} className="mb-1 max-h-80 rounded-md" />}
                    {m.type === "document" && media && (
                        <a href={media} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded-md bg-black/5 p-2 dark:bg-white/5">
                            <FileText className="h-8 w-8 shrink-0 text-[#54656f]" /><span className="min-w-0 truncate text-sm">{m.body || "ملف"}</span>
                        </a>
                    )}
                    {m.type === "location" && loc && (
                        <a href={`https://maps.google.com/?q=${loc.latitude},${loc.longitude}`} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-1.5 text-sm text-[#027eb5] underline">
                            <MapPin className="h-4 w-4" />افتح الموقع على الخريطة
                        </a>
                    )}
                    {m.body && m.type !== "document" && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    {!m.body && !media && !header && m.type !== "location" && <p className="italic text-muted-foreground">{preview(m)}</p>}
                    <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[#667781] dark:text-[#8696a0]">
                        {m.order_id && <span className="font-mono" dir="ltr">#{orderRef(m.order_id)}</span>}
                        {out && m.sent_by && <span>{m.sent_by === "system" ? "تلقائي" : m.sent_by.toLowerCase() === me ? "انت" : teamName(m.sent_by)} ·</span>}
                        {time(m.sent_at)}
                        {out && <Ticks status={m.status} />}
                    </span>
                </div>
                {buttons.length > 0 && (
                    <div className="mt-0.5 grid gap-0.5">
                        {buttons.map(b => (
                            <span key={b} className={cn("flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium text-[#027eb5] shadow-sm dark:text-[#53bdeb]",
                                out ? "bg-[#d9fdd3] dark:bg-[#005c4b]" : "bg-white dark:bg-[#202c33]")}>
                                <CornerUpLeft className="h-4 w-4" />{b}
                            </span>
                        ))}
                    </div>
                )}
                {m.payload?.cards && m.payload.cards.length > 0 && (
                    // The carousel as the customer swipes it: photo, name, prices, button.
                    <div className="mt-1 flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
                        {m.payload.cards.map(c => (
                            <div key={c.variant_id} className={cn("w-44 shrink-0 snap-start overflow-hidden rounded-lg shadow-sm", out ? "bg-[#d9fdd3] dark:bg-[#005c4b]" : "bg-white dark:bg-[#202c33]")}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img loading="lazy" decoding="async" src={c.image} alt="" className="h-36 w-full object-cover" />
                                <div className="space-y-0.5 p-2 text-[13px] leading-snug">
                                    <p className="line-clamp-2 font-medium">{c.title}</p>
                                    <p><span className="text-[#667781] line-through">{c.old_price}</span> <b>{c.price} جنيه</b></p>
                                </div>
                                <span className="flex items-center justify-center gap-1.5 border-t border-black/5 py-1.5 text-[13px] font-medium text-[#027eb5] dark:border-white/10 dark:text-[#53bdeb]">
                                    <CornerUpLeft className="h-3.5 w-3.5" />ضيفه لطلبي
                                </span>
                            </div>
                        ))}
                    </div>
                )}
                {reaction && <span className="absolute -bottom-3 start-2 rounded-full bg-white px-1.5 text-sm shadow dark:bg-[#202c33]">{reaction}</span>}
                {m.status === "failed" && <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-red-600"><TriangleAlert className="h-3.5 w-3.5" />ما وصلتش</p>}
                <div className="absolute -top-3 end-1 z-10 hidden gap-1 group-hover:flex group-focus-within:flex">
                    <button type="button" onClick={onReply} aria-label="رد" className="rounded-full bg-white p-2 shadow dark:bg-[#202c33]"><CornerUpLeft className="h-4 w-4" /></button>
                    {m.body && <button type="button" aria-label="انسخ" className="rounded-full bg-white p-2 shadow dark:bg-[#202c33]"
                        onClick={() => navigator.clipboard.writeText(m.body || "").then(() => toast.success("اتنسخت"), () => undefined)}><Copy className="h-4 w-4" /></button>}
                </div>
            </div>
        </div>
    );
}

function Ticks({ status }: { status: string }) {
    if (status === "read") return <CheckCheck className="h-4 w-4 shrink-0 text-[#53bdeb]" />;
    if (status === "delivered") return <CheckCheck className="h-4 w-4 shrink-0" />;
    if (status === "sent") return <Check className="h-4 w-4 shrink-0" />;
    if (status === "failed") return <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-red-600" />;
    return <Clock className="h-3 w-3 shrink-0" />;
}
