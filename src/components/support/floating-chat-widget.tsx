"use client";

import { toast } from "sonner";
import { playNotificationSound, requestNotificationPermission, showBrowserNotification } from "@/lib/notifications";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    MessageSquare, X, Send, Headset, Check, CheckCheck, Loader2, Sparkles, AlertCircle
} from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";



interface ChatMessage {
    id: string;
    conversation_id?: string;
    business_id: string;
    sender_type: 'tenant' | 'admin';
    sender_email?: string;
    sender_name?: string;
    message: string;
    is_read: boolean;
    created_at: string;
}

export function FloatingChatWidget() {
    const { activeBusiness } = useBusiness();
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputMessage, setInputMessage] = useState("");
    const [sending, setSending] = useState(false);
    const [loading, setLoading] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [userEmail, setUserEmail] = useState<string>("");

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    // Get active user email
    // Request notification permissions on mount
    useEffect(() => {
        requestNotificationPermission();
        async function getUser() {
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.email) {
                setUserEmail(user.email);
            }
        }
        getUser();
    }, []);

    // Load or create conversation & messages
    useEffect(() => {
        if (!activeBusiness) return;
        const busId = activeBusiness.id;

        let intervalId: NodeJS.Timeout;

        async function loadChatData() {
            setLoading(true);
            try {
                // 1. Get or create conversation for this business
                let convId = conversationId;
                if (!convId) {
                    const { data: convData, error: convErr } = await supabase
                        .from('support_conversations')
                        .select('id, unread_tenant_count')
                        .eq('business_id', busId)
                        .maybeSingle();

                    if (!convErr && convData) {
                        convId = convData.id;
                        setConversationId(convData.id);
                        setUnreadCount(convData.unread_tenant_count || 0);
                    }
                }

                // 2. Load messages if conversation exists
                if (convId) {
                    const { data: msgs, error: msgsErr } = await supabase
                        .from('support_chat_messages')
                        .select('*')
                        .eq('conversation_id', convId)
                        .order('created_at', { ascending: true });

                    if (!msgsErr && msgs) {
                        setMessages(msgs);
                        const unread = msgs.filter(m => m.sender_type === 'admin' && !m.is_read).length;
                        setUnreadCount(unread);
                    }
                }
            } catch (err) {
                console.error("Error loading support chat:", err);
            } finally {
                setLoading(false);
            }
        }

        loadChatData();

        // 3. Polling fallback every 3 seconds
        intervalId = setInterval(() => {
            fetchLatestMessages();
        }, 3000);

        // 4. Supabase Realtime Subscription
        const channel = supabase
            .channel(`tenant-support-${busId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'support_chat_messages',
                    filter: `business_id=eq.${busId}`
                },
                (payload) => {
                    const newMsg = payload.new as ChatMessage;
                    setMessages((prev) => {
                        if (prev.some(m => m.id === newMsg.id)) return prev;
                        
                        if (newMsg.sender_type === 'admin') {
                            setUnreadCount((count) => count + 1);
                            playNotificationSound();
                            showBrowserNotification("رسالة جديدة من دعم eCommerx 💬", newMsg.message);
                            toast.info("رسالة جديدة من دعم eCommerx 💬", {
                                description: newMsg.message,
                                action: {
                                    label: "فتح المحادثة",
                                    onClick: () => setIsOpen(true)
                                }
                            });
                        }
                        return [...prev, newMsg];
                    });
                }
            )
            .subscribe();

        return () => {
            clearInterval(intervalId);
            supabase.removeChannel(channel);
        };
    }, [activeBusiness, conversationId]);

    async function fetchLatestMessages() {
        if (!activeBusiness) return;
        try {
            let convId = conversationId;
            if (!convId) {
                const { data: convData } = await supabase
                    .from('support_conversations')
                    .select('id')
                    .eq('business_id', activeBusiness.id)
                    .maybeSingle();
                if (convData) {
                    convId = convData.id;
                    setConversationId(convData.id);
                }
            }

            if (convId) {
                const { data: msgs } = await supabase
                    .from('support_chat_messages')
                    .select('*')
                    .eq('conversation_id', convId)
                    .order('created_at', { ascending: true });

                if (msgs && msgs.length > 0) {
                    setMessages((prev) => {
                        const newAdminMsgs = msgs.filter(m => 
                            m.sender_type === 'admin' && 
                            !prev.some(p => p.id === m.id)
                        );
                        if (newAdminMsgs.length > 0) {
                            playNotificationSound();
                            const latest = newAdminMsgs[newAdminMsgs.length - 1];
                            showBrowserNotification("رسالة جديدة من دعم eCommerx 💬", latest.message);
                            toast.info("رسالة جديدة من دعم eCommerx 💬", {
                                description: latest.message,
                                action: {
                                    label: "فتح المحادثة",
                                    onClick: () => setIsOpen(true)
                                }
                            });
                        }
                        return msgs;
                    });
                }
            }
        } catch (e) {
            // silent catch
        }
    }

    async function markMessagesAsRead() {

        if (!conversationId || unreadCount === 0) return;
        try {
            setUnreadCount(0);
            await supabase
                .from('support_chat_messages')
                .update({ is_read: true })
                .eq('conversation_id', conversationId)
                .eq('sender_type', 'admin');

            await supabase
                .from('support_conversations')
                .update({ unread_tenant_count: 0 })
                .eq('id', conversationId);
        } catch (e) {
            console.error("Error marking messages as read:", e);
        }
    }

    async function handleSendMessage(e?: React.FormEvent) {
        if (e) e.preventDefault();
        const text = inputMessage.trim();
        if (!text || !activeBusiness || sending) return;

        setSending(true);
        setInputMessage("");

        try {
            let convId = conversationId;

            // Create conversation record if not exists
            if (!convId) {
                const { data: newConv, error: convErr } = await supabase
                    .from('support_conversations')
                    .insert({
                        business_id: activeBusiness.id,
                        last_message: text,
                        last_message_at: new Date().toISOString(),
                        unread_admin_count: 1,
                        unread_tenant_count: 0,
                        status: 'active'
                    })
                    .select('id')
                    .single();

                if (convErr) {
                    console.error("Failed to create conversation:", convErr);
                    // Fallback local message display
                    const localMsg: ChatMessage = {
                        id: `local-${Date.now()}`,
                        business_id: activeBusiness.id,
                        sender_type: 'tenant',
                        sender_email: userEmail,
                        message: text,
                        is_read: false,
                        created_at: new Date().toISOString()
                    };
                    setMessages((prev) => [...prev, localMsg]);
                    setSending(false);
                    return;
                }
                convId = newConv.id;
                setConversationId(convId);
            } else {
                // Update conversation last message
                await supabase
                    .from('support_conversations')
                    .update({
                        last_message: text,
                        last_message_at: new Date().toISOString(),
                        unread_admin_count: (supabase as any).raw ? undefined : 1
                    })
                    .eq('id', convId);
            }

            // Insert message
            const { data: insertedMsg, error: msgErr } = await supabase
                .from('support_chat_messages')
                .insert({
                    conversation_id: convId,
                    business_id: activeBusiness.id,
                    sender_type: 'tenant',
                    sender_email: userEmail,
                    sender_name: activeBusiness.name,
                    message: text,
                    is_read: false
                })
                .select()
                .single();

            if (!msgErr && insertedMsg) {
                setMessages((prev) => [...prev, insertedMsg]);
            } else {
                // Fallback UI append
                const localMsg: ChatMessage = {
                    id: `local-${Date.now()}`,
                    conversation_id: convId || undefined,
                    business_id: activeBusiness.id,
                    sender_type: 'tenant',
                    sender_email: userEmail,
                    message: text,
                    is_read: false,
                    created_at: new Date().toISOString()
                };

                setMessages((prev) => [...prev, localMsg]);
            }

        } catch (err) {
            console.error("Error sending message:", err);
        } finally {
            setSending(false);
            setTimeout(scrollToBottom, 100);
        }
    }

    if (!activeBusiness) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 font-sans">
            {/* Chat Dialog Popup Window */}
            {isOpen && (
                <Card className="w-[360px] sm:w-[410px] h-[540px] shadow-2xl border border-border/50 backdrop-blur-2xl bg-background/95 flex flex-col overflow-hidden rounded-3xl animate-in slide-in-from-bottom-5 duration-300">
                    {/* Header */}
                    <CardHeader className="bg-gradient-to-r from-primary via-indigo-600 to-violet-600 text-white p-4 flex flex-row items-center justify-between shrink-0 shadow-md">
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <div className="h-10 w-10 rounded-full bg-white p-1 flex items-center justify-center border border-white/40 shadow-md overflow-hidden shrink-0">
                                    <img src="/logo.png" alt="eCommerx" className="h-8 w-8 object-contain" />
                                </div>

                                <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-400 border-2 border-primary animate-pulse" />
                            </div>
                            <div>
                                <CardTitle className="text-base font-bold text-white flex items-center gap-1.5">
                                    دعم eCommerx المباشر
                                    <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                                </CardTitle>
                                <p className="text-xs text-white/80 font-normal">
                                    متصل الآن | خدمة عملاء على مدار الساعة
                                </p>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-white hover:bg-white/20 rounded-full transition-colors"
                            onClick={() => setIsOpen(false)}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </CardHeader>


                    {/* Messages Body */}
                    <CardContent className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50 dark:bg-zinc-950/50">
                        {loading && messages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                <span className="text-xs">جاري تحميل المحادثة...</span>
                            </div>
                        ) : messages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center p-6 space-y-3">
                                <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                    <MessageSquare className="h-7 w-7" />
                                </div>
                                <div>
                                    <h4 className="font-semibold text-sm">مرحباً بك في خدمة العملاء! 👋</h4>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        كيف يمكننا مساعدتك اليوم؟ أرسل استفسارك وسيقوم فريق الدعم بالرد عليك فوراً.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            messages.map((msg) => {
                                const isMe = msg.sender_type === 'tenant';
                                return (
                                    <div
                                        key={msg.id}
                                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1`}
                                    >
                                        <div
                                            className={`max-w-[82%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${
                                                isMe
                                                    ? 'bg-primary text-primary-foreground rounded-tr-none'
                                                    : 'bg-white dark:bg-zinc-900 border border-border/60 text-foreground rounded-tl-none'
                                            }`}
                                        >
                                            <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                                        </div>
                                        <div className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                                            <span>
                                                {msg.created_at
                                                    ? format(new Date(msg.created_at), "hh:mm a")
                                                    : "الآن"}
                                            </span>
                                            {isMe && (
                                                msg.is_read ? (
                                                    <CheckCheck className="h-3 w-3 text-blue-500" />
                                                ) : (
                                                    <Check className="h-3 w-3 opacity-60" />
                                                )
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                        <div ref={messagesEndRef} />
                    </CardContent>

                    {/* Footer Input Bar */}
                    <CardFooter className="p-3 border-t border-border/50 bg-background flex gap-2">
                        <form onSubmit={handleSendMessage} className="flex w-full gap-2 items-center">
                            <Input
                                value={inputMessage}
                                onChange={(e) => setInputMessage(e.target.value)}
                                placeholder="اكتب استفسارك هنا..."
                                className="flex-1 rounded-full text-sm bg-muted/30 focus-visible:ring-primary border-border/60 h-10 px-4"
                                disabled={sending}
                            />
                            <Button
                                type="submit"
                                size="icon"
                                className="h-10 w-10 rounded-full shrink-0 shadow-md bg-gradient-to-r from-primary to-indigo-600 hover:opacity-90 transition-opacity"
                                disabled={!inputMessage.trim() || sending}
                            >
                                {sending ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                                ) : (
                                    <Send className="h-4 w-4 text-white" />
                                )}
                            </Button>
                        </form>
                    </CardFooter>
                </Card>
            )}

            {/* Floating Trigger Button */}
            <Button
                onClick={() => setIsOpen(!isOpen)}
                className="h-14 w-14 rounded-full shadow-2xl bg-gradient-to-r from-primary via-indigo-600 to-violet-600 hover:scale-105 active:scale-95 transition-all duration-300 flex items-center justify-center border-2 border-white/30 text-white relative group"
            >
                {isOpen ? (
                    <X className="h-6 w-6 text-white transition-transform duration-300 rotate-90" />
                ) : (
                    <MessageSquare className="h-6 w-6 text-white transition-transform duration-300 group-hover:scale-110" />
                )}

                {/* Unread Counter Badge */}
                {!isOpen && unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center border-2 border-background animate-bounce shadow-md">
                        {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                )}
            </Button>
        </div>
    );
}
