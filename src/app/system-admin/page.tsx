"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Store, Users, Ticket, Banknote, Loader2 } from "lucide-react";

export default function SystemAdminOverview() {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        totalBusinesses: 0,
        activeBusinesses: 0,
        totalUsers: 0,
        openTickets: 0,
    });

    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            
            // Note: In a production scale app, these should be done via an RPC function
            // to avoid multiple round trips, but this works well for our scale.
            const [
                { count: totalBiz },
                { count: activeBiz },
                { count: totalUsers },
                { count: openTickets }
            ] = await Promise.all([
                supabase.from('businesses').select('*', { count: 'exact', head: true }),
                supabase.from('businesses').select('*', { count: 'exact', head: true }).eq('subscription_status', 'active'),
                supabase.from('business_users').select('*', { count: 'exact', head: true }),
                supabase.from('support_tickets').select('*', { count: 'exact', head: true }).neq('status', 'resolved'),
            ]);

            setStats({
                totalBusinesses: totalBiz || 0,
                activeBusinesses: activeBiz || 0,
                totalUsers: totalUsers || 0,
                openTickets: openTickets || 0,
            });
            
            setLoading(false);
        };

        fetchStats();
    }, []);

    if (loading) {
        return (
            <div className="flex min-h-[400px] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    const estimatedMRR = stats.activeBusinesses * 250; // 250 EGP per month

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Platform Overview</h1>
                <p className="text-muted-foreground">High-level metrics for the entire SaaS platform.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Estimated MRR</CardTitle>
                        <Banknote className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{estimatedMRR} EGP</div>
                        <p className="text-xs text-muted-foreground">
                            Based on {stats.activeBusinesses} active subscriptions
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Stores</CardTitle>
                        <Store className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalBusinesses}</div>
                        <p className="text-xs text-muted-foreground">
                            Registered on the platform
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Platform Users</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalUsers}</div>
                        <p className="text-xs text-muted-foreground">
                            Team members across all stores
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Open Tickets</CardTitle>
                        <Ticket className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.openTickets}</div>
                        <p className="text-xs text-muted-foreground">
                            Requires admin attention
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
