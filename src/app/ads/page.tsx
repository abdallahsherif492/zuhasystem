"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Upload, Megaphone, Trash2, Calendar as CalendarIcon, Filter } from "lucide-react";
import Papa from "papaparse";
import { toast } from "sonner";
import { formatCurrency, cn } from "@/lib/utils";
import { format, subDays } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { DateRange } from "react-day-picker";

type AdExpense = {
    id: string;
    ad_date: string;
    amount: number;
    currency: string;
    platform: string;
};

export default function AdsPage() {
    const [expenses, setExpenses] = useState<AdExpense[]>([]);
    const [filteredExpenses, setFilteredExpenses] = useState<AdExpense[]>([]);
    const [loading, setLoading] = useState(true);

    // Upload State
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [progress, setProgress] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Filter State
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: subDays(new Date(), 30),
        to: new Date(),
    });

    useEffect(() => {
        fetchExpenses();
    }, []);

    useEffect(() => {
        applyFilters();
    }, [expenses, dateRange]);

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

    const applyFilters = () => {
        if (!dateRange?.from) {
            setFilteredExpenses(expenses);
            return;
        }

        const start = dateRange.from.getTime();
        const end = dateRange.to ? dateRange.to.getTime() : start; // Default to single day if no end

        const filtered = expenses.filter(item => {
            const itemDate = new Date(item.ad_date).getTime();
            // Ensure itemDate is within the selected range (inclusive)
            return itemDate >= start && itemDate <= end;
        });

        setFilteredExpenses(filtered);
    };

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) setSelectedFile(file);
    };

    const handleProcessCSV = () => {
        if (!selectedFile) return;

        setIsProcessing(true);
        setProgress(10); // Start progress

        Papa.parse(selectedFile, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                setProgress(50); // Parsed locally
                try {
                    const parsedData = results.data as any[];

                    const recordsToInsert = parsedData
                        .filter(row => row["Day"] && row["Amount spent"])
                        .map(row => {
                            const [day, month, year] = row["Day"].split("/");
                            const isoDate = `${year}-${month}-${day}`;
                            return {
                                ad_date: isoDate,
                                amount: parseFloat(row["Amount spent"]) * 1.14, // Add 14% VAT
                                currency: row["Currency"] || "EGP",
                                platform: "Facebook"
                            };
                        });

                    if (recordsToInsert.length === 0) {
                        toast.error("No valid data found in CSV");
                        setIsProcessing(false);
                        setProgress(0);
                        return;
                    }

                    setProgress(70); // Inserting...

                    const { error } = await supabase
                        .from("ads_expenses")
                        .upsert(recordsToInsert, { onConflict: "ad_date,platform" });

                    if (error) throw error;

                    setProgress(100);
                    toast.success(`Successfully imported ${recordsToInsert.length} records`);
                    await fetchExpenses();

                    // Reset
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                    setTimeout(() => setProgress(0), 1000); // Hide progress after distinct delay

                } catch (error) {
                    console.error("Import error:", error);
                    toast.error("Failed to import data");
                } finally {
                    setIsProcessing(false);
                }
            },
            error: (error) => {
                console.error("CSV Parse error:", error);
                toast.error("Failed to parse CSV file");
                setIsProcessing(false);
                setProgress(0);
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

    const totalSpend = filteredExpenses.reduce((sum, item) => sum + item.amount, 0);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Ads Spent</h1>
                    <p className="text-muted-foreground">Import and analyze your daily ad spend.</p>
                </div>

                {/* Upload Section */}
                <Card className="w-full sm:w-auto p-4 flex flex-col sm:flex-row items-center gap-4">
                    <div className="grid w-full max-w-sm items-center gap-1.5">
                        <Input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv"
                            onChange={handleFileSelect}
                            disabled={isProcessing}
                        />
                    </div>
                    <Button
                        onClick={handleProcessCSV}
                        disabled={!selectedFile || isProcessing}
                    >
                        {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                        {isProcessing ? "Processing..." : "Import CSV"}
                    </Button>
                </Card>
            </div>

            {/* Progress Bar */}
            {progress > 0 && (
                <div className="w-full">
                    <p className="text-xs text-muted-foreground mb-1 text-right">{progress}%</p>
                    <Progress value={progress} className="h-2" />
                </div>
            )}

            {/* Filters & Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Spend (Filtered)</CardTitle>
                        <Megaphone className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(totalSpend)}</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            {filteredExpenses.length} days recorded
                        </p>
                    </CardContent>
                </Card>

                <Card className="md:col-span-2">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base">Filter by Date</CardTitle>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        id="date"
                                        variant={"outline"}
                                        className={cn(
                                            "w-[260px] justify-start text-left font-normal",
                                            !dateRange && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {dateRange?.from ? (
                                            dateRange.to ? (
                                                <>
                                                    {format(dateRange.from, "LLL dd, y")} -{" "}
                                                    {format(dateRange.to, "LLL dd, y")}
                                                </>
                                            ) : (
                                                format(dateRange.from, "LLL dd, y")
                                            )
                                        ) : (
                                            <span>Pick a date</span>
                                        )}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="end">
                                    <Calendar
                                        initialFocus
                                        mode="range"
                                        defaultMonth={dateRange?.from}
                                        selected={dateRange}
                                        onSelect={setDateRange}
                                        numberOfMonths={2}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                    </CardHeader>
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
                            ) : filteredExpenses.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center">
                                        No data found for this period.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredExpenses.map((item) => (
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
