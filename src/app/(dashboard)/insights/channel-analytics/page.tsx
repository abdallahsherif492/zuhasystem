"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { DateRangePicker } from "@/components/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { format, startOfMonth } from "date-fns";

function ChannelAnalyticsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    const [loading, setLoading] = useState(true);
    const [channelData, setChannelData] = useState<any[]>([]);

    useEffect(() => {
        if (!fromDate || !toDate) {
            const start = format(startOfMonth(new Date()), "yyyy-MM-dd");
            const end = format(new Date(), "yyyy-MM-dd");
            router.replace(`?from=${start}&to=${end}`);
            return;
        }
        fetchData();
    }, [fromDate, toDate]);

    async function fetchData() {
        setLoading(true);
        try {
            const start = `${fromDate}T00:00:00`;
            const end = `${toDate}T23:59:59`;

            const { data, error } = await supabase.rpc('get_channel_performance', {
                from_date: start,
                to_date: end
            });

            if (error) throw error;
            setChannelData(data || []);

        } catch (error) {
            console.error("Error fetching channel data:", error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="space-y-8 p-8 pt-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <h1 className="text-3xl font-bold tracking-tight">Channel Analytics</h1>
                <DateRangePicker />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Chart 1: Orders Volume & Collection */}
                <Card className="col-span-1">
                    <CardHeader>
                        <CardTitle>Orders Volume by Channel</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={channelData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="channel" />
                                <YAxis />
                                <Tooltip cursor={{ fill: 'transparent' }} />
                                <Legend />
                                <Bar dataKey="total_orders" name="Total Orders" fill="#8884d8" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="delivered_orders" name="Collected (Delivered)" fill="#82ca9d" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Chart 2: Revenue Share */}
                <Card className="col-span-1">
                    <CardHeader>
                        <CardTitle>Revenue by Channel</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={channelData} layout="vertical" margin={{ top: 20, right: 30, left: 40, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" tickFormatter={(val) => `${val / 1000}k`} />
                                <YAxis dataKey="channel" type="category" width={100} />
                                <Tooltip formatter={(value) => formatCurrency(Number(value))} cursor={{ fill: 'transparent' }} />
                                <Bar dataKey="total_revenue" name="Total Revenue" fill="#ffc658" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            {/* Detailed Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {channelData.map((channel) => {
                    const total = Number(channel.total_orders);
                    const delivered = Number(channel.delivered_orders);
                    const collectedPercentage = total > 0 ? (delivered / total) * 100 : 0;

                    return (
                        <Card key={channel.channel}>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base font-medium">{channel.channel}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Orders:</span>
                                        <span className="font-bold">{total}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Collected:</span>
                                        <span className="font-bold text-green-600">{delivered}</span>
                                    </div>
                                    <div className="flex justify-between text-sm pt-2 border-t mt-2">
                                        <span className="text-muted-foreground">Collection Rate:</span>
                                        <span className={`font-bold ${collectedPercentage >= 80 ? 'text-green-600' : collectedPercentage >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                                            {collectedPercentage.toFixed(1)}%
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-sm pt-2 border-t mt-2">
                                        <span className="text-muted-foreground">Revenue:</span>
                                        <span className="font-bold">{formatCurrency(channel.total_revenue)}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}

export default function ChannelAnalyticsPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <ChannelAnalyticsContent />
        </Suspense>
    );
}
