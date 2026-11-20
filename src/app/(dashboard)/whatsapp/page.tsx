"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, CheckCheck, Clock, Loader2, MessageCircle, Phone, Search, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useBusiness } from "@/contexts/BusinessContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { teamName } from "@/lib/team-names";
import { ago } from "@/components/orders/confirmation-attempts";
import { egp } from "@/components/orders/order-summary";
import { arabicItemLabels } from "@/lib/orders/arabic-names";
import { telLink } from "@/lib/orders/contact";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { QUICK_REPLIES, chatsOf, preview, windowUntil, type Chat, type WaMessage } from "@/lib/whatsapp/chats";
import { clockLabel } from "@/lib/orders/confirm-queue";

/**
 * المحادثات: every customer who wrote to the business's WhatsApp number or
 * got a message from it, and the conversation itself. Replies go from the
 * business number (/api/whatsapp/send); customers' messages arrive through
 * the webhook and show up live. Next to each chat, the customer's orders,
 * with confirming one a tap away.
 */

type Filter = "waiting" | "mine" | "all";

interface OrderLite {
    id: string; status: string; total_amount: number; paid_amount: number | null; created_at: string;
    payment_status?: string | null; closed_by?: string | null; customer_info: { name?: string; phone?: string; governorate?: string } | null;
    order_items: { quantity: number; variant_id: string | null; unmapped_name: string | null; variants: { title: string | null; products: { name: string | null; description: string | null } | null } | null }[];
}

const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);
const STATUS_AR: Record<string, string> = {
    waiting: "في الانتظار", pending: "اتأكد", processing: "بيتجهز", prepared: "جاهز", shipped: "اتشحن",
    delivered: "اتسلم", collected: "اتحصّل", returned: "رجع", returning: "راجع", cancelled: "ملغي",
};

export default function WhatsAppChatsPage() {
    const { activeBusiness, currentUser } = useBusiness();
    const businessId = activeBusiness?.id;
    const me = currentUser?.email?.toLowerCase() ?? null;
    const [messages, setMessages] = useState<WaMessage[] | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>("waiting");
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [typing, setTyping] = useState<Record<string, string>>({}); // email -> phone
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

    // Messages: the last 30 days, then live.
    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        (async () => {
            const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
            const { data, error } = await supabase.from("whatsapp_messages").select("*")
                .eq("business_id", businessId).gte("sent_at", since).order("sent_at", { ascending: false }).limit(3000);
            if (gone) return;
            if (error) { setProblem(/whatsapp_messages/.test(error.message) ? "شغّل ملف 20261124_whatsapp_messages.sql في Supabase الأول." : error.message); setMessages([]); return; }
            setMessages((data || []) as WaMessage[]);
        })();
        const channel = supabase.channel(`wa-messages-${businessId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages", filter: `business_id=eq.${businessId}` }, payload => {
                const row = payload.new as WaMessage;
                if (!row?.id) return;
                setMessages(prev => {
                    if (!prev) return prev;
                    const i = prev.findIndex(m => m.id === row.id || (row.wa_message_id && m.wa_message_id === row.wa_message_id));
                    if (i === -1) return [row, ...prev];
                    const next = prev.slice(); next[i] = { ...prev[i], ...row }; return next;
                });
            })
            .subscribe();
        return () => { gone = true; supabase.removeChannel(channel); };
    }, [businessId]);

    // Who is in which chat right now, so two people do not answer the same customer.
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

    const chats = useMemo(() => chatsOf(messages || [], me), [messages, me]);
    const shown = chats.filter(c =>
        (filter === "all" || (filter === "waiting" ? c.last.direction === "in" : c.mine))
        && (!query.trim() || c.phone.includes(query.replace(/\D/g, "") || "~") || (c.name || "").includes(query.trim())));
    const counts = { waiting: chats.filter(c => c.last.direction === "in").length, mine: chats.filter(c => c.mine).length, all: chats.length };
    const current = chats.find(c => c.phone === open) || null;
    const others = (phone: string) => Object.entries(typing).filter(([email, p]) => p === phone && email !== me).map(([email]) => teamName(email));

    const addSent = useCallback((m: WaMessage) => setMessages(prev => (prev && !prev.some(x => x.id === m.id) ? [m, ...prev] : prev)), []);

    return (
        <div dir="rtl" className="-m-4 flex h-[calc(100dvh-4rem)] min-h-0 sm:-m-6">
            {/* The chats */}
            <aside className={cn("flex w-full min-w-0 flex-col border-s bg-muted/30 md:w-[340px] md:shrink-0", open && "hidden md:flex")}>
                <div className="space-y-3 border-b p-3">
                    <h1 className="flex items-center gap-2 text-xl font-bold"><MessageCircle className="h-5 w-5 text-emerald-600" />المحادثات</h1>
                    <div className="relative">
                        <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="دوّر برقم أو اسم"
                            className="h-10 w-full rounded-lg border bg-background pe-9 ps-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <div className="flex gap-1.5">
                        {([["waiting", "مستنيين رد"], ["mine", "بتوعي"], ["all", "الكل"]] as [Filter, string][]).map(([k, label]) => (
                            <button key={k} type="button" onClick={() => setFilter(k)}
                                className={cn("rounded-full border px-3 py-1 text-sm font-semibold", filter === k ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted")}>
                                {label} <span className="tabular-nums opacity-70">{counts[k]}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {messages === null ? <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                        : problem ? <p className="p-4 text-sm font-medium text-amber-700">{problem}</p>
                        : shown.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">{filter === "waiting" ? "مفيش حد مستني رد 👌" : "مفيش محادثات هنا."}</p>
                        : shown.map(c => (
                            <button key={c.phone} type="button" onClick={() => setOpen(c.phone)}
                                className={cn("flex w-full gap-3 border-b px-3 py-3 text-start hover:bg-background", open === c.phone && "bg-background")}>
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                    {(c.name || c.phone).trim().charAt(0)}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center justify-between gap-2">
                                        <span className="truncate font-semibold">{c.name || c.phone}</span>
                                        {c.waiting > 0 && c.last.direction === "in"
                                            ? <span className="shrink-0 rounded-full bg-emerald-600 px-2 text-xs font-bold text-white">{c.waiting}</span>
                                            : <span className="shrink-0 text-xs text-muted-foreground">{ago(c.last.sent_at)}</span>}
                                    </span>
                                    <span className="block truncate text-sm text-muted-foreground">{c.last.direction === "out" ? "انت: " : ""}{preview(c.last)}</span>
                                    {others(c.phone).length > 0 && <span className="text-xs font-semibold text-amber-700">{others(c.phone).join("، ")} فاتح المحادثة</span>}
                                </span>
                            </button>
                        ))}
                </div>
            </aside>

            {/* The chat */}
            <section className={cn("min-w-0 flex-1 flex-col bg-background", open ? "flex" : "hidden md:flex")}>
                {current && businessId
                    ? <ChatView key={current.phone} chat={current} businessId={businessId} me={me} now={now}
                        others={others(current.phone)} onBack={() => setOpen(null)} onSent={addSent}
                        messages={(messages || []).filter(m => m.customer_phone === current.phone).sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at))} />
                    : <div className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground">اختار محادثة من القايمة.</div>}
            </section>
        </div>
    );
}

function ChatView({ chat, messages, businessId, me, now, others, onBack, onSent }: {
    chat: Chat; messages: WaMessage[]; businessId: string; me: string | null; now: number;
    others: string[]; onBack: () => void; onSent: (m: WaMessage) => void;
}) {
    const { currentUser } = useBusiness();
    const [orders, setOrders] = useState<OrderLite[] | null>(null);
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const bottom = useRef<HTMLDivElement>(null);
    const until = windowUntil(chat);
    const isOpen = !!until && until > now;

    useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

    const loadOrders = useCallback(async () => {
        const { data } = await supabase.from("orders")
            .select("id, status, total_amount, paid_amount, payment_status, closed_by, created_at, customer_info, order_items(quantity, variant_id, unmapped_name, variants(title, products(name, description)))")
            .eq("business_id", businessId).ilike("customer_info->>phone", `%${last10(chat.phone)}%`)
            .order("created_at", { ascending: false }).limit(5);
        setOrders((data || []) as unknown as OrderLite[]);
    }, [businessId, chat.phone]);
    useEffect(() => {
        let gone = false;
        (async () => { if (!gone) await loadOrders(); })();
        return () => { gone = true; };
    }, [loadOrders]);

    const name = chat.name || orders?.[0]?.customer_info?.name || chat.phone;
    const waitingOrder = orders?.find(o => o.status?.toLowerCase() === "waiting") || null;

    const send = async (payload: Record<string, unknown>) => {
        setSending(true);
        const res = await fetch("/api/whatsapp/send", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ business_id: businessId, phone: chat.phone, ...payload }),
        });
        const body = await res.json().catch(() => ({}));
        setSending(false);
        if (!res.ok) { toast.error(body.error || "الرسالة ما اتبعتتش."); return false; }
        if (body.message?.id) onSent(body.message as WaMessage);
        return true;
    };

    const sendText = async (value = text) => {
        if (!value.trim() || sending) return;
        if (await send({ text: value.trim() })) setText("");
    };

    // The approved confirmation template, filled from the order.
    const sendConfirmation = async (o: OrderLite) => {
        const labels = await arabicItemLabels(o.order_items || []).catch(() => undefined);
        const items = (o.order_items || []).map((it, i) => `${labels?.[i] || it.variants?.products?.name || it.unmapped_name || "منتج"} (عدد ${it.quantity || 1})`).join("، ");
        const due = Math.max(0, (Number(o.total_amount) || 0) - (Number(o.paid_amount) || 0));
        const first = String(o.customer_info?.name || "").trim().split(/\s+/)[0] || "عميلنا";
        await send({
            template: { name: "order_confirmation", language: "ar", params: [first, items, String(Math.round(due))] },
            order_id: o.id,
            preview: `رسالة التأكيد: ${items} · ${egp(due)}`,
        });
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
            <header className="flex items-center justify-between gap-3 border-b px-3 py-2.5 sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                    <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="ارجع للمحادثات"><ArrowRight className="h-5 w-5" /></Button>
                    <div className="min-w-0">
                        <p className="truncate text-lg font-bold leading-tight">{name}</p>
                        <p className="text-sm text-muted-foreground" dir="ltr">{chat.phone}</p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {others.length > 0 && <span className="rounded-full bg-amber-500 px-2.5 py-1 text-xs font-bold text-white">{others.join("، ")} فاتح</span>}
                    <Button asChild variant="outline" size="sm" className="gap-1.5"><a href={telLink(chat.phone)}><Phone className="h-4 w-4" />اتصل</a></Button>
                </div>
            </header>

            {/* The customer's orders */}
            {orders && orders.length > 0 && (
                <div className="space-y-2 border-b bg-muted/20 px-3 py-2.5 sm:px-4">
                    {orders.slice(0, 2).map(o => {
                        const waiting = o.status?.toLowerCase() === "waiting";
                        return (
                            <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background px-3 py-2">
                                <div className="min-w-0 text-sm">
                                    <p className="font-semibold">أوردر <span dir="ltr" className="font-mono">#{o.id.slice(0, 8)}</span> · {egp(o.total_amount)} · <span className={waiting ? "text-amber-700" : "text-muted-foreground"}>{STATUS_AR[o.status?.toLowerCase()] || o.status}</span></p>
                                    <p className="truncate text-muted-foreground">{o.order_items.map(i => `${i.variants?.products?.name || i.unmapped_name || "منتج"} ×${i.quantity}`).join("، ")}</p>
                                </div>
                                {waiting && (
                                    <div className="flex gap-1.5">
                                        <Button size="sm" variant="outline" disabled={sending} onClick={() => sendConfirmation(o)}>ابعت رسالة التأكيد</Button>
                                        <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => confirmOrder(o)}><Check className="me-1 h-4 w-4" />أكّد الأوردر</Button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            {orders && orders.length === 0 && <p className="border-b px-4 py-2 text-sm text-muted-foreground">مفيش أوردرات على الرقم ده.</p>}

            {/* Messages */}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4 sm:px-6">
                {messages.map(m => <Bubble key={m.id} m={m} businessId={businessId} />)}
                <div ref={bottom} />
            </div>

            {/* Reply */}
            <div className="space-y-2 border-t p-3 sm:px-4">
                {isOpen ? (
                    <>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" />تقدر ترد عادي لحد {clockLabel(until!, now)}. بعدها تبعت قالب بس.</p>
                        <div className="flex gap-1.5 overflow-x-auto pb-1">
                            {QUICK_REPLIES.map(q => (
                                <button key={q} type="button" onClick={() => setText(q)}
                                    className="shrink-0 rounded-full border bg-background px-3 py-1 text-sm hover:bg-muted">{q.length > 28 ? `${q.slice(0, 28)}…` : q}</button>
                            ))}
                        </div>
                        <div className="flex items-end gap-2">
                            <Textarea value={text} onChange={e => setText(e.target.value)} rows={1} placeholder="اكتب رد…"
                                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); } }}
                                className="max-h-40 min-h-11 resize-none text-[15px]" />
                            <Button onClick={() => sendText()} disabled={sending || !text.trim()} className="h-11 w-11 shrink-0 bg-emerald-600 p-0 text-white hover:bg-emerald-700" aria-label="ابعت">
                                {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                            </Button>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                        <span>{chat.lastIn ? "عدّت 24 ساعة من آخر رسالة من العميل، فالرد العادي مقفول. اتصل بيه أو ابعت رسالة التأكيد." : "العميل لسه ما بعتش حاجة. ابدأ برسالة التأكيد."}</span>
                        {waitingOrder && <Button size="sm" disabled={sending} onClick={() => sendConfirmation(waitingOrder)}>ابعت رسالة التأكيد</Button>}
                    </div>
                )}
            </div>
        </>
    );
}

function Bubble({ m, businessId }: { m: WaMessage; businessId: string }) {
    const out = m.direction === "out";
    const media = m.media_id ? `/api/whatsapp/media/${m.media_id}?business_id=${businessId}` : null;
    return (
        <div className={cn("flex", out ? "justify-start" : "justify-end")}>
            <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-[15px] leading-relaxed shadow-sm",
                out ? "rounded-ss-sm bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-50" : "rounded-se-sm bg-muted")}>
                {m.type === "image" && media && <a href={media} target="_blank" rel="noreferrer">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={media} alt="صورة من العميل" className="mb-1 max-h-64 rounded-lg" /></a>}
                {m.type === "audio" && media && <audio controls src={media} className="max-w-full" />}
                {m.type === "video" && media && <video controls src={media} className="max-h-64 rounded-lg" />}
                {(m.type === "document" || m.type === "sticker") && media && <a href={media} target="_blank" rel="noreferrer" className="underline">افتح الملف</a>}
                {m.template_name && <span className="block text-xs font-semibold opacity-70">قالب</span>}
                {(m.body || !media) && <p className="whitespace-pre-wrap break-words">{m.body || preview(m)}</p>}
                <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] opacity-70">
                    {out && m.sent_by && <span>{teamName(m.sent_by)} ·</span>}
                    <span>{new Date(m.sent_at).toLocaleTimeString("ar-EG-u-nu-latn", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" })}</span>
                    {out && <Ticks status={m.status} />}
                </p>
                {m.status === "failed" && <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-red-700"><TriangleAlert className="h-3.5 w-3.5" />ما وصلتش</p>}
            </div>
        </div>
    );
}

function Ticks({ status }: { status: string }) {
    if (status === "read") return <CheckCheck className="h-3.5 w-3.5 text-sky-600" />;
    if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5" />;
    if (status === "sent") return <Check className="h-3.5 w-3.5" />;
    if (status === "failed") return <TriangleAlert className="h-3.5 w-3.5 text-red-600" />;
    return <Clock className="h-3 w-3" />;
}
