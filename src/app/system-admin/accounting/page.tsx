"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Banknote, CalendarCheck } from "lucide-react";

type Business = {
    id: string;
    name: string;
    subscription_status: string;
    trial_ends_at: string;
};

export default function PlatformAccounting() {
    const [businesses, setBusinesses] = useState<Business[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchBusinesses = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from("businesses")
                .select("id, name, subscription_status, trial_ends_at")
                .order("subscription_status", { ascending: true });

            if (!error && data) {
                setBusinesses(data);
            }
            setLoading(false);
        };

        fetchBusinesses();
    }, []);

    const activeCount = businesses.filter(b => b.subscription_status === "active").length;
    const mrr = activeCount * 250;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Accounting</h1>
                <p className="text-muted-foreground">Track platform revenue and subscription statuses.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <Card className="bg-primary/5 border-primary/20">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Banknote className="h-4 w-4" /> Expected MRR
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{mrr} EGP</div>
                        <p className="text-xs text-muted-foreground mt-1">Based on {activeCount} active subscriptions paying 250 EGP/mo.</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <CalendarCheck className="h-5 w-5 text-primary" />
                        Subscription Ledger
                    </CardTitle>
                    <CardDescription>
                        Overview of billing status for all tenants. Future updates will include InstaPay transaction verification.
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
                                        <TableHead>Store Name</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Billing Cycle</TableHead>
                                        <TableHead className="text-right">Expected Amount</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {businesses.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="text-center p-8 text-muted-foreground">
                                                No subscriptions found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        businesses.map((biz) => (
                                            <TableRow key={biz.id}>
                                                <TableCell className="font-medium">{biz.name}</TableCell>
                                                <TableCell>
                                                    <Badge variant={biz.subscription_status === "active" ? "default" : "secondary"}>
                                                        {biz.subscription_status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>Monthly</TableCell>
                                                <TableCell className="text-right font-medium">
                                                    {biz.subscription_status === "active" ? "250 EGP" : "0 EGP"}
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
