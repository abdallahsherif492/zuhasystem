"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Store, CheckCircle, XCircle } from "lucide-react";

import { useBusiness } from "@/contexts/BusinessContext";
import { logAuditAction } from "@/lib/audit";

type Business = {
    id: string;
    name: string;
    subscription_status: string;
    trial_ends_at: string;
    created_at: string;
};

export default function BusinessesManagement() {
    const { impersonateBusiness } = useBusiness();
    const [businesses, setBusinesses] = useState<Business[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchBusinesses = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("businesses")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Error fetching businesses:", error);
        } else {
            setBusinesses(data || []);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchBusinesses();
    }, []);

    const updateStatus = async (id: string, newStatus: string) => {
        const { error } = await supabase
            .from("businesses")
            .update({ subscription_status: newStatus })
            .eq("id", id);
            
        if (!error) {
            await logAuditAction(
                newStatus === "active" ? "BUSINESS_ACTIVATED" : "BUSINESS_SUSPENDED",
                "Business",
                id,
                { new_status: newStatus }
            );
            fetchBusinesses();
        }
    };

    const extendTrial = async (biz: Business) => {
        const currentEndsAt = biz.trial_ends_at ? new Date(biz.trial_ends_at) : new Date();
        const newEndsAt = new Date(currentEndsAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        
        const { error } = await supabase
            .from("businesses")
            .update({ trial_ends_at: newEndsAt })
            .eq("id", biz.id);
            
        if (!error) {
            await logAuditAction("TRIAL_EXTENDED", "Business", biz.id, {
                old_ends_at: currentEndsAt.toISOString(),
                new_ends_at: newEndsAt
            });
            fetchBusinesses();
        } else {
            console.error("Failed to extend trial:", error);
            alert("Failed to extend trial: " + error.message);
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "active":
                return <Badge className="bg-green-500 hover:bg-green-600">Active</Badge>;
            case "trialing":
            case "trial":
                return <Badge variant="secondary">Trial</Badge>;
            case "suspended":
                return <Badge variant="destructive">Suspended</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Businesses</h1>
                <p className="text-muted-foreground">Manage tenant subscriptions and statuses across the platform.</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Store className="h-5 w-5 text-primary" />
                        All Registered Businesses
                    </CardTitle>
                    <CardDescription>
                        A list of all tenants. You can approve or suspend their access from here.
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
                                        <TableHead>Business Name</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Trial Ends</TableHead>
                                        <TableHead>Joined</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {businesses.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center p-8 text-muted-foreground">
                                                No businesses found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        businesses.map((biz) => (
                                            <TableRow key={biz.id}>
                                                <TableCell className="font-medium">{biz.name}</TableCell>
                                                <TableCell>{getStatusBadge(biz.subscription_status)}</TableCell>
                                                <TableCell>
                                                    {biz.trial_ends_at ? new Date(biz.trial_ends_at).toLocaleDateString() : "N/A"}
                                                </TableCell>
                                                <TableCell>{new Date(biz.created_at).toLocaleDateString()}</TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button size="sm" variant="secondary" onClick={() => impersonateBusiness(biz.id)}>
                                                            Open Dashboard
                                                        </Button>
                                                        {biz.subscription_status === "trialing" || biz.subscription_status === "trial" ? (
                                                            <Button size="sm" variant="outline" className="text-blue-600 border-blue-200 hover:bg-blue-50" onClick={() => extendTrial(biz)}>
                                                                +7 Days Trial
                                                            </Button>
                                                        ) : null}
                                                        {biz.subscription_status !== "active" && (
                                                            <Button size="sm" variant="outline" className="text-green-600 border-green-200 hover:bg-green-50" onClick={() => updateStatus(biz.id, "active")}>
                                                                <CheckCircle className="mr-1 h-4 w-4" /> Activate
                                                            </Button>
                                                        )}
                                                        {biz.subscription_status !== "suspended" && (
                                                            <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => updateStatus(biz.id, "suspended")}>
                                                                <XCircle className="mr-1 h-4 w-4" /> Suspend
                                                            </Button>
                                                        )}
                                                    </div>
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
