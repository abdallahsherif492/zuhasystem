"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
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
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const transactionSchema = z.object({
    date: z.date(),
    amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
    type: z.enum(["investment", "revenue", "expense"]),
    category: z.string().min(1, "Category is required"),
    description: z.string().optional(),
    account: z.string().min(1, "Account is required"), // 'Mohamed Adel', 'Abdallah Sherif', 'Split'
});

interface AddTransactionDialogProps {
    type: "investment" | "revenue" | "expense";
    onSuccess: () => void;
}

const ACCOUNTS = ["Mohamed Adel", "Abdallah Sherif"];
const EXPENSE_CATEGORIES = ["Ads", "Website", "Purchases", "Other"];
const REVENUE_CATEGORIES = ["Orders Collection", "Deposit", "Other"];

// Define the form values type explicitly for better type inference
type TransactionFormValues = z.infer<typeof transactionSchema>;

export function AddTransactionDialog({ type, onSuccess }: AddTransactionDialogProps) {
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const form = useForm<TransactionFormValues>({
        resolver: zodResolver(transactionSchema),
        defaultValues: {
            type: type,
            date: new Date(),
            account: "",
            amount: 0,
            description: "",
            category: type === "investment" ? "Investment" : "", // Default for investment
        },
    });

    async function onSubmit(values: z.infer<typeof transactionSchema>) {
        setSubmitting(true);
        try {
            const finalAmount = values.type === "expense" ? -values.amount : values.amount;
            const payload = {
                transaction_date: values.date.toISOString(),
                type: values.type,
                category: values.category,
                description: values.description,
            };

            if (values.type === "expense" && values.account === "Split") {
                // Split logic: Create 2 transactions, half amount each
                const halfAmount = finalAmount / 2;
                const { error } = await supabase.from("transactions").insert([
                    { ...payload, amount: halfAmount, account_name: "Mohamed Adel" },
                    { ...payload, amount: halfAmount, account_name: "Abdallah Sherif" },
                ]);
                if (error) throw error;
            } else {
                // Standard single transaction
                const { error } = await supabase.from("transactions").insert({
                    ...payload,
                    amount: finalAmount,
                    account_name: values.account,
                });
                if (error) throw error;
            }

            setOpen(false);
            form.reset();
            onSuccess();
        } catch (error) {
            console.error("Error adding transaction:", error);
            alert("Failed to add transaction");
        } finally {
            setSubmitting(false);
        }
    }

    const titleMap = {
        investment: "Add Investment",
        revenue: "Add Revenue",
        expense: "Add Expense",
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant={type === "expense" ? "destructive" : type === "revenue" ? "default" : "secondary"}>
                    {titleMap[type]}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{titleMap[type]}</DialogTitle>
                    <DialogDescription>
                        Enter the details for this {type}.
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

                        {/* Date Field */}
                        <FormField
                            control={form.control}
                            name="date"
                            render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>Date</FormLabel>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <FormControl>
                                                <Button
                                                    variant={"outline"}
                                                    className={cn(
                                                        "w-full pl-3 text-left font-normal",
                                                        !field.value && "text-muted-foreground"
                                                    )}
                                                >
                                                    {field.value ? (
                                                        format(field.value, "PPP")
                                                    ) : (
                                                        <span>Pick a date</span>
                                                    )}
                                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                </Button>
                                            </FormControl>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={field.value}
                                                onSelect={field.onChange}
                                                disabled={(date) =>
                                                    date > new Date() || date < new Date("1900-01-01")
                                                }
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Amount Field */}
                        <FormField
                            control={form.control}
                            name="amount"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Amount (EGP)</FormLabel>
                                    <FormControl>
                                        <Input type="number" step="0.01" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Category Field */}
                        {type !== "investment" && (
                            <FormField
                                control={form.control}
                                name="category"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Category</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select Category" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {type === "revenue"
                                                    ? REVENUE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)
                                                    : EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)
                                                }
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}

                        {/* Account Field */}
                        <FormField
                            control={form.control}
                            name="account"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Account</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select Account" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {ACCOUNTS.map((acc) => (
                                                <SelectItem key={acc} value={acc}>{acc}</SelectItem>
                                            ))}
                                            {type === "expense" && (
                                                <SelectItem value="Split">Split (50/50)</SelectItem>
                                            )}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Description */}
                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Description</FormLabel>
                                    <FormControl>
                                        <Input {...field} placeholder="Optional details..." />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <DialogFooter>
                            <Button type="submit" disabled={submitting}>
                                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Transaction
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
