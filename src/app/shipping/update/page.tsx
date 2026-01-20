"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Upload, CheckCircle2, AlertCircle } from "lucide-react";
import Papa from "papaparse";
import { toast } from "sonner";
import { formatCurrency, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type Order = {
    id: string;
    customer_info: {
        phone: string;
        name: string;
    };
    total_amount: number;
    status: string;
};

type MatchedOrder = {
    order: Order;
    csvRow: any;
    matchType: 'Exact' | 'Fuzzy';
};

export default function UpdateShippingPage() {
    const [shippedOrders, setShippedOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);

    // Upload State
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Matching Results
    const [matchedOrders, setMatchedOrders] = useState<MatchedOrder[]>([]);
    const [unmatchedRows, setUnmatchedRows] = useState<any[]>([]);

    useEffect(() => {
        fetchShippedOrders();
    }, []);

    const fetchShippedOrders = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("orders")
            .select("id, customer_info, total_amount, status")
            .eq("status", "Shipped");

        if (error) {
            console.error(error);
            toast.error("Failed to fetch shipped orders");
        } else {
            setShippedOrders(data || []);
        }
        setLoading(false);
    };

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) setSelectedFile(file);
    };

    const normalizePhone = (phone: string) => {
        if (!phone) return "";
        // Remove all non-digits
        return phone.replace(/\D/g, "");
    };

    const handleProcessCSV = () => {
        if (!selectedFile) return;
        setIsProcessing(true);

        Papa.parse(selectedFile, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                const rows = results.data as any[];
                const matched: MatchedOrder[] = [];
                const unmatched: any[] = [];
                const usedOrderIds = new Set<string>();

                rows.forEach((row, index) => {
                    const csvPhone = row["Phone Number"] || row["phone"] || row["Mobile"] || "";
                    const csvAmount = parseFloat(row["Amount"] || row["amount"] || "0");

                    if (!csvPhone && !csvAmount) return; // Skip empty rows

                    const normalizedCsvPhone = normalizePhone(csvPhone.toString());

                    // Find in Shipped Orders
                    const match = shippedOrders.find(order => {
                        if (usedOrderIds.has(order.id)) return false;

                        const orderPhone = normalizePhone(order.customer_info?.phone || "");
                        const orderAmount = order.total_amount;

                        // Strict Match: Phone includes CSV Phone (or vice versa) AND Amount matches
                        // Note: CSV matching often requires loose phone checks (e.g. without 0 prefix)
                        const phoneMatch = orderPhone.includes(normalizedCsvPhone) || normalizedCsvPhone.includes(orderPhone);
                        const amountMatch = Math.abs(orderAmount - csvAmount) < 1; // Tolerance of 1 EGP

                        return phoneMatch && amountMatch;
                    });

                    if (match) {
                        matched.push({
                            order: match,
                            csvRow: row,
                            matchType: "Exact"
                        });
                        usedOrderIds.add(match.id);
                    } else {
                        unmatched.push(row);
                    }
                });

                setMatchedOrders(matched);
                setUnmatchedRows(unmatched);
                setIsProcessing(false);
                toast.success(`Processed: ${matched.length} matched, ${unmatched.length} unmatched`);
            },
            error: () => {
                toast.error("Failed to parse CSV");
                setIsProcessing(false);
            }
        });
    };

    const handleBulkUpdate = async () => {
        if (matchedOrders.length === 0) return;
        if (!confirm(`Are you sure you want to update ${matchedOrders.length} orders to Delivered?`)) return;

        setIsProcessing(true);
        const ids = matchedOrders.map(m => m.order.id);

        const { error } = await supabase
            .from("orders")
            .update({ status: "Delivered" })
            .in("id", ids);

        if (error) {
            toast.error("Failed to update orders");
        } else {
            toast.success("Successfully updated orders");
            setMatchedOrders([]);
            setUnmatchedRows([]);
            setSelectedFile(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
            fetchShippedOrders(); // Refresh list
        }
        setIsProcessing(false);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight">Update Shipping Status</h1>
                <p className="text-muted-foreground">
                    Upload a CSV file with "Phone Number" and "Amount" columns to bulk update shipped orders to <strong>Delivered</strong>.
                </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-6 items-start">
                {/* Upload Card */}
                <Card className="w-full sm:w-1/3">
                    <CardHeader>
                        <CardTitle>Upload CSV</CardTitle>
                        <CardDescription>Currently {shippedOrders.length} orders are Shipped.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv"
                            onChange={handleFileSelect}
                            disabled={isProcessing}
                        />
                        <Button
                            className="w-full"
                            onClick={handleProcessCSV}
                            disabled={!selectedFile || isProcessing}
                        >
                            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                            Process File
                        </Button>
                    </CardContent>
                </Card>

                {/* Stat Cards */}
                <div className="flex-1 grid grid-cols-2 gap-4">
                    <Card className="bg-green-50 border-green-200">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-green-700 text-lg">Matched</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-green-800">{matchedOrders.length}</div>
                            <p className="text-xs text-green-600">Ready to update</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-red-50 border-red-200">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-red-700 text-lg">Unmatched</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-red-800">{unmatchedRows.length}</div>
                            <p className="text-xs text-red-600">Review required</p>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Results */}
            {(matchedOrders.length > 0 || unmatchedRows.length > 0) && (
                <Tabs defaultValue="matched" className="w-full">
                    <TabsList>
                        <TabsTrigger value="matched">Matched Orders ({matchedOrders.length})</TabsTrigger>
                        <TabsTrigger value="unmatched">Unmatched Rows ({unmatchedRows.length})</TabsTrigger>
                    </TabsList>

                    <TabsContent value="matched" className="space-y-4">
                        <div className="flex justify-end">
                            <Button onClick={handleBulkUpdate} className="bg-green-600 hover:bg-green-700">
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Approve & Set Delivered ({matchedOrders.length})
                            </Button>
                        </div>
                        <div className="border rounded-md">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Order ID</TableHead>
                                        <TableHead>Customer</TableHead>
                                        <TableHead>Phone (DB)</TableHead>
                                        <TableHead>Amount (DB)</TableHead>
                                        <TableHead>From CSV</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {matchedOrders.map((m, i) => (
                                        <TableRow key={i}>
                                            <TableCell className="font-mono text-xs">{m.order.id.slice(0, 8)}</TableCell>
                                            <TableCell>{m.order.customer_info.name}</TableCell>
                                            <TableCell>{m.order.customer_info.phone}</TableCell>
                                            <TableCell>{formatCurrency(m.order.total_amount)}</TableCell>
                                            <TableCell className="text-green-600 text-xs">
                                                {JSON.stringify(m.csvRow)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>

                    <TabsContent value="unmatched">
                        <div className="border rounded-md">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Row Data</TableHead>
                                        <TableHead>Reason</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {unmatchedRows.map((row, i) => (
                                        <TableRow key={i}>
                                            <TableCell className="font-mono text-xs max-w-[300px] truncate" title={JSON.stringify(row)}>
                                                {row["Phone Number"] || row["phone"]} - {row["Amount"] || row["amount"]}
                                            </TableCell>
                                            <TableCell className="text-red-500 flex items-center gap-2">
                                                <AlertCircle className="h-4 w-4" /> {row.reason}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
}
