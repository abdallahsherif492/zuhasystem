"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Search, MessageSquare, Send, Store, User, Clock, CheckCheck, Check, Loader2, RefreshCw, ShieldCheck, Sparkles, Filter
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";

type SupportConversation = {
    id: string;
    business_id: string;
    last_message: string;
    last_message_at: string;
    unread_admin_count: number;
    unread_tenant_count: number;
    status: string;
    created_at: string;
    businesses?: {
        id: string;
        name: string;
        owner_id?: string;
    };
};

type ChatMessage = {
    id: string;
    conversation_id: string;
    business_id: string;
    sender_type: 'tenant' | 'admin';
    sender_email?: string;
    sender_name?: string;
    message: string;
    is_read: boolean;
    created_at: string;
};

export default function AdminLiveChatPage() {
    const [conversations, setConversations] = useState<SupportConversation[]>([]);
    const [selectedConv, setSelectedConv] = useState<SupportConversation | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loadingConvs, setLoadingConvs] = useState(true);
    const [loadingMsgs, setLoadingMsgs] = useState(false);
    const [replyText, setReplyText] = useState("");
    const [sending, setSending] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [adminEmail, setAdminEmail] = useState<string>("");

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    // Get active admin user
    useEffect(() => {
        async function getAdmin() {
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.email) {
                setAdminEmail(user.email);
            }
        }
        getAdmin();
    }, []);

    // Load Conversations List
    const fetchConversations = async () => {
        setLoadingConvs(true);
        try {
            // Join with businesses to display business name
            const { data, error } = await supabase
                .from("support_conversations")
                .select(`
                    *,
                    businesses ( id, name )
                `)
                .order("last_message_at", { ascending: false });

            if (!error && data) {
                setConversations(data as SupportConversation[]);
                // Auto select first conversation if none selected
                if (!selectedConv && data.length > 0) {
                    setSelectedConv(data[0] as SupportConversation);
                }
            }
        } catch (err) {
            console.error("Error fetching admin conversations:", err);
        } finally {
            setLoadingConvs(false);
        }
    };

    useEffect(() => {
        fetchConversations();

        // Interval polling for contacts list
        const interval = setInterval(() => {
            fetchConversations();
        }, 4000);

        // Realtime Subscription for conversation updates
        const channel = supabase
            .channel('admin-support-desk')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'support_conversations' },
                () => {
                    fetchConversations();
                }
            )
            .subscribe();

        return () => {
            clearInterval(interval);
            supabase.removeChannel(channel);
        };
    }, []);

    // Load messages when selected conversation changes
    useEffect(() => {
        if (!selectedConv) return;
        const convId = selectedConv.id;

        async function fetchMessages() {
            setLoadingMsgs(true);
            try {
                const { data, error } = await supabase
                    .from("support_chat_messages")
                    .select("*")
                    .eq("conversation_id", convId)
                    .order("created_at", { ascending: true });

                if (!error && data) {
                    setMessages(data);
                    // Mark admin unread as read
                    markAsRead(convId);
                }
            } catch (err) {
                console.error("Error fetching messages:", err);
            } finally {
                setLoadingMsgs(false);
                setTimeout(scrollToBottom, 100);
            }
        }

        fetchMessages();

        // Realtime for selected thread
        const msgChannel = supabase
            .channel(`admin-thread-${convId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'support_chat_messages',
                    filter: `conversation_id=eq.${convId}`
                },
                (payload) => {
                    const newMsg = payload.new as ChatMessage;
                    setMessages((prev) => {
                        if (prev.some(m => m.id === newMsg.id)) return prev;
                        return [...prev, newMsg];
                    });
                    setTimeout(scrollToBottom, 100);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(msgChannel);
        };
    }, [selectedConv?.id]);


    const markAsRead = async (convId: string) => {
        try {
            await supabase
                .from("support_chat_messages")
                .update({ is_read: true })
                .eq("conversation_id", convId)
                .eq("sender_type", "tenant");

            await supabase
                .from("support_conversations")
                .update({ unread_admin_count: 0 })
                .eq("id", convId);

            setConversations((prev) =>
                prev.map((c) => (c.id === convId ? { ...c, unread_admin_count: 0 } : c))
            );
        } catch (e) {
            console.error("Error marking admin read:", e);
        }
    };

    const handleSendReply = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const text = replyText.trim();
        if (!text || !selectedConv || sending) return;

        setSending(true);
        setReplyText("");

        try {
            // 1. Insert admin message
            const { data: newMsg, error: msgErr } = await supabase
                .from("support_chat_messages")
                .insert({
                    conversation_id: selectedConv.id,
                    business_id: selectedConv.business_id,
                    sender_type: "admin",
                    sender_email: adminEmail || "system-admin@zuha.com",
                    sender_name: "System Support Admin",
                    message: text,
                    is_read: false
                })
                .select()
                .single();

            if (!msgErr && newMsg) {
                setMessages((prev) => [...prev, newMsg]);
            }

            // 2. Update conversation header
            await supabase
                .from("support_conversations")
                .update({
                    last_message: text,
                    last_message_at: new Date().toISOString(),
                    unread_tenant_count: (selectedConv.unread_tenant_count || 0) + 1
                })
                .eq("id", selectedConv.id);

            fetchConversations();
        } catch (err) {
            console.error("Error sending admin reply:", err);
        } finally {
            setSending(false);
            setTimeout(scrollToBottom, 100);
        }
    };

    // Filter conversations
    const filteredConversations = conversations.filter((c) => {
        const name = c.businesses?.name?.toLowerCase() || "";
        const id = c.business_id.toLowerCase();
        const q = searchQuery.toLowerCase();
        return name.includes(q) || id.includes(q);
    });

    return (
        <div className="h-[calc(100vh-100px)] flex flex-col space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 px-1">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <MessageSquare className="h-6 w-6 text-primary" />
                        Live Chat Support Desk
                        <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                            System Admin
                        </Badge>
                    </h1>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Real-time customer support & tenant communication center.
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchConversations}
                    className="h-9 gap-1.5"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingConvs ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            {/* Main Desk Container */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
                
                {/* Left Contacts Sidebar (4 columns) */}
                <div className="md:col-span-4 border-r border-border/50 flex flex-col h-full bg-slate-50/50 dark:bg-zinc-950/50">
                    {/* Search Bar */}
                    <div className="p-3 border-b border-border/50 bg-background/80 backdrop-blur-sm">
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search business name or ID..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-9 text-xs bg-muted/40"
                            />
                        </div>
                    </div>

                    {/* Contacts List */}
                    <ScrollArea className="flex-1">
                        <div className="p-2 space-y-1.5">
                            {loadingConvs && conversations.length === 0 ? (
                                <div className="flex flex-col items-center justify-center p-8 text-muted-foreground gap-2">
                                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                    <span className="text-xs">Loading conversations...</span>
                                </div>
                            ) : filteredConversations.length === 0 ? (
                                <div className="p-6 text-center text-muted-foreground text-xs">
                                    No chat conversations found.
                                </div>
                            ) : (
                                filteredConversations.map((conv) => {
                                    const isSelected = selectedConv?.id === conv.id;
                                    const busName = conv.businesses?.name || "Business Profile";
                                    const hasUnread = conv.unread_admin_count > 0;

                                    return (
                                        <div
                                            key={conv.id}
                                            onClick={() => {
                                                setSelectedConv(conv);
                                            }}
                                            className={`p-3 rounded-xl cursor-pointer transition-all duration-200 flex flex-col gap-1 border ${
                                                isSelected
                                                    ? 'bg-primary/10 border-primary/30 shadow-sm'
                                                    : 'bg-background hover:bg-muted/60 border-transparent'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-inner shrink-0">
                                                        {busName.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="overflow-hidden">
                                                        <h4 className="font-semibold text-xs text-foreground truncate">
                                                            {busName}
                                                        </h4>
                                                        <span className="text-[10px] text-muted-foreground font-mono block truncate">
                                                            ID: {conv.business_id.substring(0, 8)}...
                                                        </span>
                                                    </div>
                                                </div>
                                                {hasUnread && (
                                                    <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 animate-pulse">
                                                        {conv.unread_admin_count}
                                                    </Badge>
                                                )}
                                            </div>

                                            <div className="flex items-center justify-between mt-1 pt-1 border-t border-border/30 text-[11px]">
                                                <p className="text-muted-foreground truncate max-w-[200px]">
                                                    {conv.last_message || "No messages yet"}
                                                </p>
                                                <span className="text-[10px] text-muted-foreground/80 shrink-0">
                                                    {conv.last_message_at
                                                        ? format(new Date(conv.last_message_at), "hh:mm a")
                                                        : ""}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </ScrollArea>
                </div>

                {/* Right Chat Workspace (8 columns) */}
                <div className="md:col-span-8 flex flex-col h-full bg-background">
                    {selectedConv ? (
                        <>
                            {/* Chat Workspace Header */}
                            <div className="p-3.5 border-b border-border/50 flex items-center justify-between bg-muted/20">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center font-bold text-sm">
                                        <Store className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                                            {selectedConv.businesses?.name || "Business Tenant"}
                                            <Badge variant="outline" className="text-[10px] font-normal">
                                                Active Support
                                            </Badge>
                                        </h3>
                                        <p className="text-[11px] text-muted-foreground font-mono">
                                            Business ID: {selectedConv.business_id}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 text-xs"
                                        onClick={() => {
                                            navigator.clipboard.writeText(selectedConv.business_id);
                                        }}
                                    >
                                        Copy ID
                                    </Button>
                                </div>
                            </div>

                            {/* Message Stream */}
                            <ScrollArea className="flex-1 p-4">
                                {loadingMsgs && messages.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full p-12 text-muted-foreground gap-2">
                                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                        <span className="text-xs">Loading thread...</span>
                                    </div>
                                ) : messages.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full p-12 text-center text-muted-foreground gap-2">
                                        <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
                                        <p className="text-xs">No messages in this chat thread yet.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {messages.map((msg) => {
                                            const isAdmin = msg.sender_type === 'admin';
                                            return (
                                                <div
                                                    key={msg.id}
                                                    className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'} space-y-1`}
                                                >
                                                    <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
                                                        <span className="font-semibold">
                                                            {isAdmin ? "System Admin" : (msg.sender_name || "Customer")}
                                                        </span>
                                                        {msg.sender_email && (
                                                            <span>({msg.sender_email})</span>
                                                        )}
                                                    </div>

                                                    <div
                                                        className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${
                                                            isAdmin
                                                                ? 'bg-primary text-primary-foreground rounded-tr-none'
                                                                : 'bg-muted/70 text-foreground border border-border/50 rounded-tl-none'
                                                        }`}
                                                    >
                                                        <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                                                    </div>

                                                    <div className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                                                        <span>
                                                            {msg.created_at
                                                                ? format(new Date(msg.created_at), "yyyy-MM-dd hh:mm a")
                                                                : "Just now"}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        <div ref={messagesEndRef} />
                                    </div>
                                )}
                            </ScrollArea>

                            {/* Reply Input Bar */}
                            <div className="p-3 border-t border-border/50 bg-background flex flex-col gap-2">
                                {/* Quick Presets */}
                                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                                    <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1 shrink-0">
                                        <Sparkles className="h-3 w-3 text-amber-500" /> Presets:
                                    </span>
                                    {[
                                        "مرحباً بك! كيف يمكنني مساعدتك؟",
                                        "تم مراجعة طلبك وإعادة ضبط النظام بنجاح.",
                                        "يرجى توضيح الخطوات المستعملة لإعادة التمكين.",
                                        "شكراً لتواصلك معنا، يسعدنا خدمتك دائماً!"
                                    ].map((preset, idx) => (
                                        <button
                                            key={idx}
                                            type="button"
                                            onClick={() => setReplyText((prev) => prev ? `${prev} ${preset}` : preset)}
                                            className="text-[10px] bg-muted/60 hover:bg-primary/10 hover:text-primary transition-colors px-2 py-1 rounded-md shrink-0 border border-border/40"
                                        >
                                            {preset}
                                        </button>
                                    ))}
                                </div>

                                <form onSubmit={handleSendReply} className="flex gap-2 items-center">
                                    <Input
                                        value={replyText}
                                        onChange={(e) => setReplyText(e.target.value)}
                                        placeholder="Type reply to tenant..."
                                        className="flex-1 text-xs bg-muted/20 h-10 rounded-xl"
                                        disabled={sending}
                                    />
                                    <Button
                                        type="submit"
                                        disabled={!replyText.trim() || sending}
                                        className="h-10 px-4 rounded-xl gap-2 font-medium"
                                    >
                                        {sending ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <>
                                                <Send className="h-4 w-4" />
                                                Reply
                                            </>
                                        )}
                                    </Button>
                                </form>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground gap-3">
                            <div className="h-16 w-16 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                                <MessageSquare className="h-8 w-8" />
                            </div>
                            <div>
                                <h3 className="font-bold text-base text-foreground">No Conversation Selected</h3>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Select a business profile from the left sidebar to start live chat support.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
