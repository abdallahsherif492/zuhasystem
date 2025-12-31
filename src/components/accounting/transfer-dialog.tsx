"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2, ArrowRightLeft } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

interface TransferDialogProps {
    onSuccess: () => void;
}

const ACCOUNTS = ["Mohamed Adel", "Abdallah Sherif"];

export function TransferDialog({ onSuccess }: TransferDialogProps) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const [fromAccount, setFromAccount] = useState("");
    const [toAccount, setToAccount] = useState("");
    const [amount, setAmount] = useState("");
    const [date, setDate] = useState<Date>(new Date());

    const handleSubmit = async () => {
        if (!amount || !fromAccount || !toAccount || !date) return;
        if (fromAccount === toAccount) {
            alert("Cannot transfer to the same account");
            return;
        }

        setLoading(true);
        const numAmount = parseFloat(amount);

        try {
            // Create two transactions:
            // 1. Outflow from Sender (Negative)
            // 2. Inflow to Receiver (Positive)

            const { error } = await supabase.from("transactions").insert([
                {
                    transaction_date: format(date, "yyyy-MM-dd"),
                    type: "transfer_out", // Special type to exclude from P&L
                    category: "Internal Transfer",
                    description: `Transfer to ${toAccount}`,
                    amount: -numAmount,
                    account_name: fromAccount,
                },
                {
                    transaction_date: format(date, "yyyy-MM-dd"),
                    type: "transfer_in", // Special type
                    category: "Internal Transfer",
                    description: `Transfer from ${fromAccount}`,
                    amount: numAmount,
                    account_name: toAccount,
                },
            ]);

            if (error) throw error;

            setOpen(false);
            onSuccess();

            // Reset form
            setAmount("");
            setFromAccount("");
            setToAccount("");
            setDate(new Date());

        } catch (error: any) {
            console.error("Error creating transfer:", error);
            alert("Failed to create transfer: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <ArrowRightLeft className="h-4 w-4" />
                    Transfer Funds
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Internal Transfer</DialogTitle>
                    <DialogDescription>
                        Move funds between accounts. This will not affect revenue or expenses.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>From</Label>
                            <Select value={fromAccount} onValueChange={setFromAccount}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Sender" />
                                </SelectTrigger>
                                <SelectContent>
                                    {ACCOUNTS.map((acc) => (
                                        <SelectItem key={acc} value={acc} disabled={acc === toAccount}>
                                            {acc}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>To</Label>
                            <Select value={toAccount} onValueChange={setToAccount}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Receiver" />
                                </SelectTrigger>
                                <SelectContent>
                                    {ACCOUNTS.map((acc) => (
                                        <SelectItem key={acc} value={acc} disabled={acc === fromAccount}>
                                            {acc}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Amount (EGP)</Label>
                        <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Date</Label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant={"outline"}
                                    className={cn(
                                        "w-full justify-start text-left font-normal",
                                        !date && "text-muted-foreground"
                                    )}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {date ? format(date, "PPP") : <span>Pick a date</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <Calendar
                                    mode="single"
                                    selected={date}
                                    onSelect={(d) => d && setDate(d)}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSubmit} disabled={loading || !amount || !fromAccount || !toAccount}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Transfer
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
