"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Ticket, MessageSquare, CheckCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type SupportTicket = {
    id: string;
    business_id: string;
    user_email: string;
    subject: string;
    message: string;
    status: string;
    created_at: string;
    businesses?: {
        name: string;
    };
};

export default function AdminSupportTickets() {
    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
    const [replyText, setReplyText] = useState("");
    const [replying, setReplying] = useState(false);

    const fetchTickets = async () => {
        setLoading(true);
        // We use inner join syntax for Supabase to get business name
        const { data, error } = await supabase
            .from("support_tickets")
            .select(`
                *,
                businesses ( name )
            `)
            .order("created_at", { ascending: false });

        if (!error && data) {
            setTickets(data);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchTickets();
    }, []);

    const handleReply = async () => {
        if (!selectedTicket || !replyText.trim()) return;
        setReplying(true);
        
        const { data: { user } } = await supabase.auth.getUser();

        // Add reply
        await supabase.from("ticket_replies").insert({
            ticket_id: selectedTicket.id,
            sender_email: user?.email,
            is_admin: true,
            message: replyText
        });

        // Update ticket status to in_progress if it was open
        if (selectedTicket.status === "open") {
            await supabase.from("support_tickets").update({ status: "in_progress" }).eq("id", selectedTicket.id);
        }

        setReplying(false);
        setReplyText("");
        setSelectedTicket(null);
        fetchTickets(); // Refresh list
    };

    const handleResolve = async (ticketId: string) => {
        await supabase.from("support_tickets").update({ status: "resolved" }).eq("id", ticketId);
        fetchTickets();
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "open":
                return <Badge variant="default" className="bg-blue-500">Open</Badge>;
            case "in_progress":
                return <Badge variant="secondary" className="bg-yellow-500 text-white">In Progress</Badge>;
            case "resolved":
                return <Badge variant="outline" className="text-green-600 border-green-200">Resolved</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Support Tickets</h1>
                <p className="text-muted-foreground">Manage and respond to tenant support requests.</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Ticket className="h-5 w-5 text-primary" />
                        All Tickets
                    </CardTitle>
                    <CardDescription>Review open issues across all businesses.</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : tickets.length === 0 ? (
                        <div className="text-center p-8 text-muted-foreground border border-dashed rounded-lg">
                            No support tickets at the moment.
                        </div>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {tickets.map(ticket => (
                                <Card key={ticket.id} className="flex flex-col h-full hover:border-primary transition-colors cursor-pointer" onClick={() => setSelectedTicket(ticket)}>
                                    <CardHeader className="pb-2">
                                        <div className="flex justify-between items-start mb-1">
                                            {getStatusBadge(ticket.status)}
                                            <span className="text-xs text-muted-foreground">{new Date(ticket.created_at).toLocaleDateString()}</span>
                                        </div>
                                        <CardTitle className="text-base">{ticket.subject}</CardTitle>
                                        <CardDescription className="text-xs font-semibold text-primary">
                                            {ticket.businesses?.name || "Unknown Business"} ({ticket.user_email})
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="flex-1 pb-2">
                                        <p className="text-sm text-muted-foreground line-clamp-3">
                                            {ticket.message}
                                        </p>
                                    </CardContent>
                                    <CardFooter className="pt-2 border-t mt-auto flex justify-end gap-2">
                                        {ticket.status !== 'resolved' && (
                                            <Button size="sm" variant="outline" className="h-8 text-xs text-green-600" onClick={(e) => { e.stopPropagation(); handleResolve(ticket.id); }}>
                                                <CheckCircle className="mr-1 h-3 w-3" /> Resolve
                                            </Button>
                                        )}
                                        <Button size="sm" variant="secondary" className="h-8 text-xs">
                                            <MessageSquare className="mr-1 h-3 w-3" /> View
                                        </Button>
                                    </CardFooter>
                                </Card>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={!!selectedTicket} onOpenChange={(open) => !open && setSelectedTicket(null)}>
                <DialogContent className="sm:max-w-[600px]">
                    <DialogHeader>
                        <div className="flex items-center gap-2 mb-2">
                            {selectedTicket && getStatusBadge(selectedTicket.status)}
                            <span className="text-sm text-muted-foreground">From: {selectedTicket?.businesses?.name}</span>
                        </div>
                        <DialogTitle>{selectedTicket?.subject}</DialogTitle>
                        <DialogDescription>
                            Submitted by {selectedTicket?.user_email} on {selectedTicket && new Date(selectedTicket.created_at).toLocaleString()}
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="py-4 space-y-4">
                        <div className="bg-muted p-4 rounded-lg text-sm whitespace-pre-wrap">
                            {selectedTicket?.message}
                        </div>
                        
                        {selectedTicket?.status !== 'resolved' && (
                            <div className="space-y-2 mt-4">
                                <label className="text-sm font-medium">Add a reply (Internal note / Email trigger)</label>
                                <Textarea 
                                    placeholder="Write your response here..." 
                                    value={replyText}
                                    onChange={(e) => setReplyText(e.target.value)}
                                    className="min-h-[100px]"
                                />
                                <div className="flex justify-end gap-2 mt-2">
                                    <Button variant="outline" onClick={() => setSelectedTicket(null)}>Cancel</Button>
                                    <Button onClick={handleReply} disabled={replying || !replyText.trim()}>
                                        {replying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Submit Reply
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
