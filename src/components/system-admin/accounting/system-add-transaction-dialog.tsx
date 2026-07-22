"use client";

import { useState, useEffect } from "react";
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
import { useLanguage } from "@/contexts/LanguageContext";

const transactionSchema = z.object({
    date: z.date(),
    amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
    type: z.enum(["investment", "revenue", "expense"]),
    category: z.string().min(1, "Category is required"),
    description: z.string().optional(),
    account: z.string().min(1, "Account is required"),
});

interface SystemAddTransactionDialogProps {
    type: "investment" | "revenue" | "expense";
    onSuccess: () => void;
}

const EXPENSE_CATEGORIES = ["Salaries", "Server Hosting", "APIs & Third Party", "Marketing", "Legal", "Office", "Other"];
const REVENUE_CATEGORIES = ["Manual Subscription", "Deposit", "Consulting", "Other"];

export function SystemAddTransactionDialog({ type, onSuccess }: SystemAddTransactionDialogProps) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [accounts, setAccounts] = useState<any[]>([]);

    useEffect(() => {
        if (open) {
            fetchAccounts();
        }
    }, [open]);

    async function fetchAccounts() {
        const { data } = await supabase
            .from("system_financial_accounts")
            .select("name")
            .order("name");
        if (data) {
            setAccounts(data);
        }
    }

    const form = useForm({
        resolver: zodResolver(transactionSchema),
        defaultValues: {
            type: type,
            date: new Date(),
            account: "",
            amount: 0,
            description: "",
            category: type === "investment" ? "Investment" : "",
        },
    });

    async function onSubmit(values: z.infer<typeof transactionSchema>) {
        setSubmitting(true);
        try {
            const payload = {
                created_at: values.date.toISOString(),
                type: values.type,
                category: values.category,
                description: values.description,
                amount: values.amount,
                account_name: values.account,
                status: 'paid'
            };

            const { error } = await supabase.from("revenue_transactions").insert(payload);
            if (error) throw error;

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
                    {t(titleMap[type])}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{t(titleMap[type])}</DialogTitle>
                    <DialogDescription>
                        {t("Enter the details for this")} {t(type)}.
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

                        <FormField
                            control={form.control}
                            name="date"
                            render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>{t("Date")}</FormLabel>
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
                                                        <span>{t("Pick a date")}</span>
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

                        <FormField
                            control={form.control}
                            name="amount"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t("Amount (EGP)")}</FormLabel>
                                    <FormControl>
                                        <Input type="number" step="0.01" {...field} value={field.value as number} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {type !== "investment" && (
                            <FormField
                                control={form.control}
                                name="category"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("Category")}</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder={t("Select Category")} />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {type === "revenue"
                                                    ? REVENUE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{t(c)}</SelectItem>)
                                                    : EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{t(c)}</SelectItem>)
                                                }
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}

                        <FormField
                            control={form.control}
                            name="account"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t("Account")}</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder={t("Select Account")} />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {accounts.map((acc) => (
                                                <SelectItem key={acc.name} value={acc.name}>{acc.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t("Description")}</FormLabel>
                                    <FormControl>
                                        <Input {...field} placeholder={t("Optional details...")} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <DialogFooter>
                            <Button type="submit" disabled={submitting}>
                                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {t("Save Transaction")}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
