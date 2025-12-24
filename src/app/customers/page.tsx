"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Users, Search, Loader2 } from "lucide-react";

export default function CustomersPage() {
    const [customers, setCustomers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    useEffect(() => {
        fetchCustomers();
    }, []);

    async function fetchCustomers() {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from("customers")
                .select("*")
                .order("created_at", { ascending: false });

            if (error) throw error;
            setCustomers(data || []);
        } catch (error) {
            console.error("Error fetching customers:", error);
        } finally {
            setLoading(false);
        }
    }

    const filteredCustomers = customers.filter(
        (customer) =>
            customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            customer.phone?.includes(searchTerm) ||
            customer.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
            </div>

            <div className="flex items-center gap-2 max-w-sm">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search by name, phone, or email..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Phone</TableHead>
                            <TableHead>Governorate</TableHead>
                            <TableHead>Total Orders</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">
                                    <div className="flex justify-center items-center">
                                        <Loader2 className="h-6 w-6 animate-spin mr-2" />
                                        Loading...
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : filteredCustomers.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">
                                    No customers found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredCustomers.map((customer) => (
                                <TableRow key={customer.id}>
                                    <TableCell className="font-medium text-primary">
                                        <Link href={`/customers/${customer.id}`} className="hover:underline">
                                            {customer.name}
                                        </Link>
                                    </TableCell>
                                    <TableCell>{customer.phone}</TableCell>
                                    <TableCell>{customer.governorate}</TableCell>
                                    <TableCell>
                                        {/* Future: Join with orders count */}
                                        -
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Link href={`/customers/${customer.id}`}>
                                            <Button variant="ghost" size="sm">
                                                View
                                            </Button>
                                        </Link>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
