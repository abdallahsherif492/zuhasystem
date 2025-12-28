"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Upload, Megaphone, Trash2 } from "lucide-react";
import Papa from "papaparse";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";

type AdExpense = {
    id: string;
    ad_date: string;
    amount: number;
    currency: string;
    platform: string;
};

export default function AdsPage() {
    const [expenses, setExpenses] = useState<AdExpense[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetchExpenses();
    }, []);

    const fetchExpenses = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("ads_expenses")
            .select("*")
            .order("ad_date", { ascending: false });

        if (error) {
            console.error(error);
            toast.error("Failed to load ads data");
        } else {
            setExpenses(data || []);
        }
        setLoading(false);
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setUploading(true);
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                try {
                    const parsedData = results.data as any[];

                    // Transform CSV data to DB format
                    // CSV headers: "Day", "Amount spent", "Currency"
                    const recordsToInsert = parsedData
                        .filter(row => row["Day"] && row["Amount spent"]) // Basic validation
                        .map(row => {
                            // Parse Date "28/12/2025" -> "2025-12-28"
                            const [day, month, year] = row["Day"].split("/");
                            const isoDate = `${year}-${month}-${day}`;

                            return {
                                ad_date: isoDate,
                                amount: parseFloat(row["Amount spent"]),
                                currency: row["Currency"] || "EGP",
                                platform: "Facebook" // Default for now
                            };
                        });

                    if (recordsToInsert.length === 0) {
                        toast.error("No valid data found in CSV");
                        setUploading(false);
                        return;
                    }

                    // Upsert to DB (Update if date exists)
                    const { error } = await supabase
                        .from("ads_expenses")
                        .upsert(recordsToInsert, { onConflict: "ad_date,platform" });

                    if (error) throw error;

                    toast.success(`Successfully imported ${recordsToInsert.length} records`);
                    fetchExpenses();
                    if (fileInputRef.current) fileInputRef.current.value = ""; // Reset input

                } catch (error) {
                    console.error("Import error:", error);
                    toast.error("Failed to import data");
                } finally {
                    setUploading(false);
                }
            },
            error: (error) => {
                console.error("CSV Parse error:", error);
                toast.error("Failed to parse CSV file");
                setUploading(false);
            }
        });
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this record?")) return;

        const { error } = await supabase.from("ads_expenses").delete().eq("id", id);
        if (error) {
            toast.error("Failed to delete");
        } else {
            toast.success("Deleted");
            setExpenses(prev => prev.filter(e => e.id !== id));
        }
    };

    const totalSpend = expenses.reduce((sum, item) => sum + item.amount, 0);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Ads Spent</h1>
                    <p className="text-muted-foreground">Manage your Facebook Ads daily spending.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        className="w-[250px]"
                        onChange={handleFileUpload}
                        disabled={uploading}
                    />
                    {uploading && <Loader2 className="animate-spin text-muted-foreground" />}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Lifetime Spend</CardTitle>
                        <Megaphone className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(totalSpend)}</div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Daily Spend History</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Platform</TableHead>
                                <TableHead>Currency</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead className="w-[100px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center">
                                        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                                    </TableCell>
                                </TableRow>
                            ) : expenses.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center">
                                        No data imported yet. Upload a CSV.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                expenses.map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell>
                                            {format(new Date(item.ad_date), "dd MMM yyyy")}
                                        </TableCell>
                                        <TableCell>{item.platform}</TableCell>
                                        <TableCell>{item.currency}</TableCell>
                                        <TableCell className="font-bold">
                                            {formatCurrency(item.amount)}
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleDelete(item.id)}
                                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
