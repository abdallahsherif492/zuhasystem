"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Ticket, Send, PlusCircle } from "lucide-react";
import { useBusiness } from "@/contexts/BusinessContext";

type SupportTicket = {
    id: string;
    subject: string;
    message: string;
    status: string;
    created_at: string;
};

export default function SupportPage() {
    const { activeBusiness } = useBusiness();
    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    
    const [subject, setSubject] = useState("");
    const [message, setMessage] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const fetchTickets = async () => {
        if (!activeBusiness) return;
        setLoading(true);
        const { data, error } = await supabase
            .from("support_tickets")
            .select("*")
            .eq("business_id", activeBusiness.id)
            .order("created_at", { ascending: false });

        if (!error && data) {
            setTickets(data);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchTickets();
    }, [activeBusiness]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeBusiness) return;
        setSubmitting(true);
        
        const { data: { user } } = await supabase.auth.getUser();

        const { error } = await supabase.from("support_tickets").insert({
            business_id: activeBusiness.id,
            user_email: user?.email,
            subject,
            message,
            status: "open"
        });

        setSubmitting(false);
        if (!error) {
            setIsCreating(false);
            setSubject("");
            setMessage("");
            fetchTickets();
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "open":
                return <Badge variant="default" className="bg-primary">Open</Badge>;
            case "in_progress":
                return <Badge variant="secondary" className="bg-yellow-500 text-white hover:bg-yellow-600">In Progress</Badge>;
            case "resolved":
                return <Badge variant="outline" className="text-green-600 border-green-200">Resolved</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Support</h1>
                    <p className="text-muted-foreground">Get help and contact the System Admin.</p>
                </div>
                {!isCreating && (
                    <Button onClick={() => setIsCreating(true)}>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        New Ticket
                    </Button>
                )}
            </div>

            {isCreating && (
                <Card className="border-primary shadow-sm">
                    <CardHeader>
                        <CardTitle>Create Support Ticket</CardTitle>
                        <CardDescription>Describe your issue or request in detail.</CardDescription>
                    </CardHeader>
                    <form onSubmit={handleSubmit}>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="subject">Subject</Label>
                                <Input 
                                    id="subject" 
                                    placeholder="Brief summary of your issue" 
                                    value={subject}
                                    onChange={(e) => setSubject(e.target.value)}
                                    required 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="message">Message</Label>
                                <Textarea 
                                    id="message" 
                                    placeholder="Please provide all necessary details..." 
                                    className="min-h-[120px]"
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    required
                                />
                            </div>
                        </CardContent>
                        <CardFooter className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setIsCreating(false)} type="button">Cancel</Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                <Send className="mr-2 h-4 w-4" /> Submit Ticket
                            </Button>
                        </CardFooter>
                    </form>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Ticket className="h-5 w-5 text-primary" />
                        Your Tickets
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : tickets.length === 0 ? (
                        <div className="text-center p-8 text-muted-foreground border border-dashed rounded-lg">
                            You have no support tickets.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {tickets.map(ticket => (
                                <div key={ticket.id} className="p-4 border rounded-lg hover:shadow-sm transition-shadow">
                                    <div className="flex justify-between items-start mb-2">
                                        <h3 className="font-semibold text-lg">{ticket.subject}</h3>
                                        {getStatusBadge(ticket.status)}
                                    </div>
                                    <p className="text-muted-foreground text-sm mb-4 line-clamp-2">{ticket.message}</p>
                                    <div className="text-xs text-muted-foreground">
                                        Submitted on {new Date(ticket.created_at).toLocaleString()}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
