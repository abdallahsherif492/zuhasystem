"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldAlert } from "lucide-react";

type AuditLog = {
    id: string;
    user_email: string;
    action: string;
    entity_type: string;
    entity_id: string;
    details: any;
    created_at: string;
};

export default function AuditLogsPage() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchLogs = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("audit_logs")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100);

        if (!error && data) {
            setLogs(data as AuditLog[]);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    const getActionColor = (action: string) => {
        if (action.includes("BANNED") || action.includes("REJECTED") || action.includes("REVOKED") || action.includes("SUSPENDED") || action.includes("DELETED")) {
            return "destructive";
        }
        if (action.includes("APPROVED") || action.includes("ACTIVATED")) {
            return "default";
        }
        return "secondary";
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Audit Logs</h1>
                <p className="text-muted-foreground">Monitor administrative actions and platform changes.</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ShieldAlert className="h-5 w-5 text-primary" />
                        System Event Ledger
                    </CardTitle>
                    <CardDescription>
                        Chronological record of all critical system admin actions. Showing last 100 events.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Timestamp</TableHead>
                                        <TableHead>Actor</TableHead>
                                        <TableHead>Action</TableHead>
                                        <TableHead>Entity</TableHead>
                                        <TableHead>Details</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {logs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center p-8 text-muted-foreground">
                                                No audit logs found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        logs.map((log) => (
                                            <TableRow key={log.id}>
                                                <TableCell className="text-sm">
                                                    {new Date(log.created_at).toLocaleString()}
                                                </TableCell>
                                                <TableCell className="font-medium text-sm">
                                                    {log.user_email}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={getActionColor(log.action) as any}>
                                                        {log.action}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    <span className="font-semibold">{log.entity_type}</span>
                                                    <br />
                                                    <span className="text-xs text-muted-foreground truncate max-w-[150px] block">
                                                        {log.entity_id}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-xs max-w-xs truncate">
                                                    {log.details ? JSON.stringify(log.details) : "-"}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
