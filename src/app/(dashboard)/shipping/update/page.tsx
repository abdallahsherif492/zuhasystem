"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Upload, CheckCircle2, AlertCircle, ArrowUpRight } from "lucide-react";
import Papa from "papaparse";
import { toast } from "sonner";
import { formatCurrency, cn } from "@/lib/utils";

type Order = {
    id: string;
    customer_info: {
        phone: string;
        phone2?: string;
        name: string;
    };
    total_amount: number;
    status: string;
    items: Array<{
        quantity: number;
        variant: {
            title: string;
            product: {
                name: string;
            };
        };
    }>;
};

type MatchedOrder = {
    order: Order;
    csvRow: any;
    matchType: 'Exact' | 'Fuzzy';
};

type UnmatchedRow = {
    row: any;
    reason: string;
    candidateOrder?: Order; // If matched by phone but rejected by content
};

export default function UpdateShippingPage() {
    const [allOrders, setAllOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);

    // Upload State
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Matching Results
    const [matchedOrders, setMatchedOrders] = useState<MatchedOrder[]>([]);
    const [unmatchedRows, setUnmatchedRows] = useState<UnmatchedRow[]>([]);

    useEffect(() => {
        fetchOrders();
    }, []);

    const fetchOrders = async () => {
        setLoading(true);
        // Fetch ALL orders (item details needed for matching)
        const { data, error } = await supabase
            .from("orders")
            .select(`
                id, 
                customer_info, 
                total_amount, 
                status,
                items:order_items (
                    quantity,
                    variant:variants (
                        title,
                        product:products (name)
                    )
                )
            `)
            .neq("status", "Cancelled");

        if (error) {
            console.error(error);
            toast.error("Failed to fetch orders");
        } else {
            // Transform/Cast data to match our Order type if needed, or just cast to any for simplicity in this complexity
            // The issue is likely that Supabase returns variant as an array (relational) or object depending on relationship.
            // Let's force cast for now as we know the shape.
            const formatted = (data as any).map((o: any) => ({
                ...o,
                items: o.items.map((i: any) => ({
                    quantity: i.quantity,
                    variant: Array.isArray(i.variant) ? i.variant[0] : i.variant
                }))
            }));
            setAllOrders(formatted as Order[]);
        }
        setLoading(false);
    };

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) setSelectedFile(file);
    };

    const normalizePhone = (phone: string) => {
        if (!phone) return "";
        return phone.replace(/\D/g, "");
    };

    // Helper to format DB items into CSV-like string: "Product (Variant) xQty + ..."
    const formatOrderContent = (order: Order) => {
        return order.items.map(item =>
            `${item.variant.product.name} (${item.variant.title}) x${item.quantity}`
        ).join(" + ");
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
                const unmatched: UnmatchedRow[] = [];
                const usedOrderIds = new Set<string>();

                rows.forEach((row, index) => {
                    const csvPhone = row["Phone Number"] || row["phone"] || row["Mobile"] || "";
                    // CSV content column - try a few common names if not standard, or just check the row string if plain text? 
                    // Assuming columns: "Phone Number", "Content" (or based on user request example)
                    // The user said: "Product Name (Varient) xQuantity" is how it looks in the sheet. Let's assume column name is "Content" or "Description"
                    const csvContent = row["Content"] || row["Description"] || row["Order Details"] || row["Items"] || "";

                    if (!csvPhone) return;

                    const normalizedCsvPhone = normalizePhone(csvPhone.toString());

                    // Find in Orders by Phone
                    let potentialMatches = allOrders.filter(order => {
                        const orderPhone = normalizePhone(order.customer_info?.phone || "");
                        const orderPhone2 = normalizePhone(order.customer_info?.phone2 || "");
                        return orderPhone.includes(normalizedCsvPhone) || normalizedCsvPhone.includes(orderPhone) ||
                            (orderPhone2 && (orderPhone2.includes(normalizedCsvPhone) || normalizedCsvPhone.includes(orderPhone2)));
                    });

                    // Prefer Shipped
                    const shippedMatch = potentialMatches.find(o => o.status === 'Shipped');
                    const match = shippedMatch || potentialMatches[0];

                    if (match) {
                        const dbContent = formatOrderContent(match);

                        // Content Match Logic: 
                        // Normalize both strings (remove extra spaces, lowercase)
                        // This comparison might be tricky given "Default" vs "Blue". 
                        // Let's do a loose inclusion check or simple equality. 
                        // User said: "Product Name (Varient) xQuantity"
                        // DB: "Product Name (Title) xQuantity"
                        const normalizeStr = (s: string) => s.toLowerCase().replace(/\s+/g, "").trim();
                        // Also remove "(Default)" if it exists as it's common noise
                        const cleanDB = normalizeStr(dbContent).replace("(default)", "");
                        const cleanCSV = normalizeStr(csvContent).replace("(default)", "");

                        const contentMatch = cleanDB === cleanCSV || cleanDB.includes(cleanCSV) || cleanCSV.includes(cleanDB);
                        const isShipped = match.status === 'Shipped';

                        if (isShipped && contentMatch) {
                            if (!usedOrderIds.has(match.id)) {
                                matched.push({
                                    order: match,
                                    csvRow: { ...row, reason: "Perfect Match" },
                                    matchType: "Exact"
                                });
                                usedOrderIds.add(match.id);
                            } else {
                                unmatched.push({
                                    row,
                                    reason: "Order already matched by another row",
                                    candidateOrder: match
                                });
                            }
                        } else {
                            // Explain why it failed
                            let start = `Found Order ${match.id.slice(0, 8)}`;
                            let reasons = [];
                            if (!isShipped) reasons.push(`Status is '${match.status}'`);
                            if (!contentMatch) reasons.push(`Content mismatch`);

                            unmatched.push({
                                row,
                                reason: start + ": " + reasons.join(", "),
                                candidateOrder: match
                            });
                        }
                    } else {
                        unmatched.push({ row, reason: "No order found with this phone number" });
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
        await updateOrders(matchedOrders.map(m => m.order.id));
    };

    const handleForceApprove = async (orderId: string, rowIndex: number) => {
        if (!confirm("Force approve this order as Delivered?")) return;

        await updateOrders([orderId]);

        // Remove from unmatched
        setUnmatchedRows(prev => prev.filter((_, idx) => idx !== rowIndex));
        toast.success("Order force approved");
    };

    const updateOrders = async (ids: string[]) => {
        setIsProcessing(true);
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
            fetchOrders();
        }
        setIsProcessing(false);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight">Update Shipping Status</h1>
                <p className="text-muted-foreground">
                    Upload CSV with "Phone Number" and "Content" to bulk update shipped orders to <strong>Delivered</strong>.
                </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-6 items-start">
                <Card className="w-full sm:w-1/3">
                    <CardHeader>
                        <CardTitle>Upload CSV</CardTitle>
                        <CardDescription>
                            Searching {allOrders.filter(o => o.status === 'Shipped').length} 'Shipped' orders.
                        </CardDescription>
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

                <div className="flex-1 grid grid-cols-2 gap-4">
                    <Card className="bg-green-50 border-green-200">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-green-700 text-lg">Matched</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-green-800">{matchedOrders.length}</div>
                            <p className="text-xs text-green-600">Perfect Content Match</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-red-50 border-red-200">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-red-700 text-lg">Unmatched</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-red-800">{unmatchedRows.length}</div>
                            <p className="text-xs text-red-600">Checks Failed</p>
                        </CardContent>
                    </Card>
                </div>
            </div>

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
                                        <TableHead>Order</TableHead>
                                        <TableHead>Customer</TableHead>
                                        <TableHead>Content (DB)</TableHead>
                                        <TableHead>Content (CSV)</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {matchedOrders.map((m, i) => (
                                        <TableRow key={i}>
                                            <TableCell className="font-mono text-xs">{m.order.id.slice(0, 8)}</TableCell>
                                            <TableCell>
                                                <div className="text-sm font-medium">{m.order.customer_info.name}</div>
                                                <div className="text-xs text-muted-foreground">{m.order.customer_info.phone}</div>
                                            </TableCell>
                                            <TableCell className="text-xs max-w-[250px]">{formatOrderContent(m.order)}</TableCell>
                                            <TableCell className="text-green-600 text-xs max-w-[250px]">
                                                {m.csvRow["Content"] || m.csvRow["Items"] || "N/A"}
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
                                        <TableHead className="text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {unmatchedRows.map((item, i) => (
                                        <TableRow key={i}>
                                            <TableCell className="font-mono text-xs max-w-[200px] truncate" title={JSON.stringify(item.row)}>
                                                <div>{item.row["Phone Number"]}</div>
                                                <div className="text-muted-foreground">{item.row["Content"] || item.row["Items"]}</div>
                                            </TableCell>
                                            <TableCell className="text-red-500 text-xs">
                                                <div className="flex items-center gap-2 font-semibold">
                                                    <AlertCircle className="h-4 w-4" /> {item.reason}
                                                </div>
                                                {item.candidateOrder && (
                                                    <div className="mt-1 text-black">
                                                        DB Says: <span className="font-mono">{formatOrderContent(item.candidateOrder)}</span>
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {item.candidateOrder && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-8 text-xs border-green-200 hover:bg-green-50 text-green-700"
                                                        onClick={() => handleForceApprove(item.candidateOrder!.id, i)}
                                                    >
                                                        Force Approve
                                                        <ArrowUpRight className="ml-1 h-3 w-3" />
                                                    </Button>
                                                )}
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
