"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Phone, MapPin, Mail } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

export default function CustomerDetailsPage() {
    const params = useParams();
    const id = params?.id as string;

    const [customer, setCustomer] = useState<any>(null);
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (id) fetchData();
    }, [id]);

    async function fetchData() {
        try {
            setLoading(true);
            // Fetch Customer
            const { data: customerData, error: custError } = await supabase
                .from("customers")
                .select("*")
                .eq("id", id)
                .single();
            if (custError) throw custError;

            // Fetch Orders
            const { data: ordersData, error: ordError } = await supabase
                .from("orders")
                .select("*")
                .eq("customer_id", id)
                .order("created_at", { ascending: false });
            if (ordError) throw ordError;

            setCustomer(customerData);
            setOrders(ordersData || []);

        } catch (error) {
            console.error("Error fetching data:", error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;
    if (!customer) return <div>Customer not found.</div>;

    const totalSpent = orders.reduce((sum, order) => sum + (order.total_amount || 0), 0);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Link href="/customers">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Contact Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span>{customer.phone || "N/A"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <span>{customer.email || "N/A"}</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 mt-1 text-muted-foreground" />
                            <div className="flex flex-col">
                                <span>{customer.address || "N/A"}</span>
                                <span className="text-sm text-muted-foreground">{customer.governorate}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Overview</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col">
                            <span className="text-sm text-muted-foreground">Total Orders</span>
                            <span className="text-2xl font-bold">{orders.length}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm text-muted-foreground">Total Spent</span>
                            <span className="text-2xl font-bold">{formatCurrency(totalSpent)}</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="space-y-4">
                <h2 className="text-xl font-semibold">Order History</h2>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Order ID</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Channel</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {orders.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center h-24">
                                        No orders yet.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                orders.map((order) => (
                                    <TableRow key={order.id}>
                                        <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}</TableCell>
                                        <TableCell>{new Date(order.created_at).toLocaleDateString()}</TableCell>
                                        <TableCell>
                                            <Badge variant="secondary">{order.status}</Badge>
                                        </TableCell>
                                        <TableCell>{order.channel || "-"}</TableCell>
                                        <TableCell>{formatCurrency(order.total_amount)}</TableCell>
                                        <TableCell>
                                            {/* Link to order details later */}
                                            <Button variant="ghost" size="sm">View</Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>
        </div>
    );
}
