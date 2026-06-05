"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X, Inbox } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

type HRRequest = {
    id: string;
    user_email: string;
    request_type: string;
    start_time: string;
    end_time: string;
    status: 'pending' | 'approved' | 'rejected';
    reason: string;
    created_at: string;
};

export default function RequestsPage() {
    const { activeBusiness, userRole, isSystemAdmin } = useBusiness();
    const [requests, setRequests] = useState<HRRequest[]>([]);
    const [loading, setLoading] = useState(true);
    
    const role = userRole?.toLowerCase().trim() || "";
    const isManager = isSystemAdmin || role === "owner" || role === "admin" || role === "platform admin";

    useEffect(() => {
        if (activeBusiness) {
            fetchRequests();
        }
    }, [activeBusiness]);

    async function fetchRequests() {
        if (!activeBusiness) return;
        setLoading(true);
        const { data, error } = await supabase
            .from("hr_requests")
            .select("*")
            .eq("business_id", activeBusiness.id)
            .order("created_at", { ascending: false });

        if (!error && data) {
            setRequests(data as HRRequest[]);
        }
        setLoading(false);
    }

    async function updateRequestStatus(id: string, newStatus: 'approved' | 'rejected') {
        const { error } = await supabase
            .from("hr_requests")
            .update({ status: newStatus })
            .eq("id", id);
            
        if (error) {
            toast.error("Failed to update status: " + error.message);
        } else {
            toast.success(`Request ${newStatus} successfully.`);
            fetchRequests();
        }
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Leave & Permissions</h1>
                    <p className="text-muted-foreground mt-1">Review and manage staff time-off requests.</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Inbox className="h-5 w-5 text-primary" />
                        Pending & Past Requests
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Staff Member</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Date / Duration</TableHead>
                                    <TableHead>Reason</TableHead>
                                    <TableHead>Status</TableHead>
                                    {isManager && <TableHead className="text-right">Actions</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {requests.length === 0 ? (
                                    <TableRow><TableCell colSpan={6} className="text-center">No requests found.</TableCell></TableRow>
                                ) : requests.map((req) => (
                                    <TableRow key={req.id}>
                                        <TableCell className="font-medium">{req.user_email}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="capitalize">
                                                {req.request_type}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            {format(parseISO(req.start_time), 'MMM dd, yyyy')} <br />
                                            <span className="text-xs text-muted-foreground">
                                                {format(parseISO(req.start_time), 'hh:mm a')} - {format(parseISO(req.end_time), 'hh:mm a')}
                                            </span>
                                        </TableCell>
                                        <TableCell className="max-w-[200px] truncate" title={req.reason}>
                                            {req.reason || "-"}
                                        </TableCell>
                                        <TableCell>
                                            {req.status === 'pending' && <Badge variant="secondary" className="bg-orange-100 text-orange-700 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400">Pending</Badge>}
                                            {req.status === 'approved' && <Badge variant="default" className="bg-green-500 hover:bg-green-600">Approved</Badge>}
                                            {req.status === 'rejected' && <Badge variant="destructive">Rejected</Badge>}
                                        </TableCell>
                                        {isManager && (
                                            <TableCell className="text-right">
                                                {req.status === 'pending' ? (
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Button size="sm" variant="outline" className="text-green-600 border-green-200 hover:bg-green-50" onClick={() => updateRequestStatus(req.id, 'approved')}>
                                                            <Check className="h-4 w-4 mr-1" /> Approve
                                                        </Button>
                                                        <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => updateRequestStatus(req.id, 'rejected')}>
                                                            <X className="h-4 w-4 mr-1" /> Reject
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">Processed</span>
                                                )}
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
