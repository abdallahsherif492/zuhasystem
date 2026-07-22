"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useBusiness } from "@/contexts/BusinessContext";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function IntegrationLogs() {
    const { activeBusiness } = useBusiness();
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchLogs = async () => {
        if (!activeBusiness) return;
        setLoading(true);
        
        try {
            const { data, error } = await supabase
                .from("integration_logs")
                .select("*")
                .eq("business_id", activeBusiness.id)
                .order("created_at", { ascending: false })
                .limit(50);
                
            if (error) {
                console.error("Failed to fetch integration logs:", error);
            } else {
                setLogs(data || []);
            }
        } catch (err) {
            console.error("Exception fetching logs:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [activeBusiness]);

    if (!activeBusiness) return null;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>System Logs</CardTitle>
                    <CardDescription>Recent activity and sync history for integrations.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
                    <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex justify-center p-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                ) : logs.length === 0 ? (
                    <div className="text-center p-8 text-muted-foreground border border-dashed rounded-lg">
                        No logs found.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {logs.map((log) => (
                            <div key={log.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-md gap-4">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold">{log.integration_name}</span>
                                        {log.status === 'success' && <Badge className="bg-green-100 text-green-800 border-green-200">Success</Badge>}
                                        {log.status === 'error' && <Badge className="bg-red-100 text-red-800 border-red-200">Error</Badge>}
                                        {log.status === 'info' && <Badge className="bg-primary/20 text-primary border-primary/20">Info</Badge>}
                                    </div>
                                    <p className="text-sm text-muted-foreground">{log.message}</p>
                                    
                                    {log.details && Object.keys(log.details).length > 0 && (
                                        <div className="mt-2 text-xs font-mono bg-muted p-2 rounded max-h-24 overflow-y-auto">
                                            {JSON.stringify(log.details, null, 2)}
                                        </div>
                                    )}
                                </div>
                                <div className="text-xs text-muted-foreground whitespace-nowrap">
                                    {new Date(log.created_at).toLocaleString()}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
