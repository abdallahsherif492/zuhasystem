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
import { CalendarIcon, Loader2, ArrowRightLeft } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

const transferSchema = z.object({
    date: z.date(),
    amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
    fromAccount: z.string().min(1, "Source account is required"),
    toAccount: z.string().min(1, "Destination account is required"),
    description: z.string().optional(),
}).refine((data) => data.fromAccount !== data.toAccount, {
    message: "Source and destination accounts must be different",
    path: ["toAccount"],
});

export function SystemTransferDialog({ onSuccess }: { onSuccess: () => void }) {
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
        resolver: zodResolver(transferSchema),
        defaultValues: {
            date: new Date(),
            amount: 0,
            fromAccount: "",
            toAccount: "",
            description: "",
        },
    });

    async function onSubmit(values: z.infer<typeof transferSchema>) {
        setSubmitting(true);
        try {
            const dateStr = values.date.toISOString();
            const desc = values.description || `Transfer from ${values.fromAccount} to ${values.toAccount}`;
            
            // Insert two transactions for the transfer
            const { error } = await supabase.from("revenue_transactions").insert([
                {
                    created_at: dateStr,
                    type: "transfer_out",
                    category: "Transfer",
                    description: desc,
                    amount: values.amount,
                    account_name: values.fromAccount,
                    status: 'paid'
                },
                {
                    created_at: dateStr,
                    type: "transfer_in",
                    category: "Transfer",
                    description: desc,
                    amount: values.amount,
                    account_name: values.toAccount,
                    status: 'paid'
                }
            ]);

            if (error) throw error;

            setOpen(false);
            form.reset();
            onSuccess();
        } catch (error) {
            console.error("Error creating transfer:", error);
            alert(t("Failed to complete transfer"));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <ArrowRightLeft className="h-4 w-4" />
                    {t("Transfer Funds")}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{t("Transfer Funds")}</DialogTitle>
                    <DialogDescription>
                        {t("Move money between your system treasury accounts.")}
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
                                                    {field.value ? format(field.value, "PPP") : <span>{t("Pick a date")}</span>}
                                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                </Button>
                                            </FormControl>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={field.value}
                                                onSelect={field.onChange}
                                                disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
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

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="fromAccount"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("From")}</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder={t("Source")} />
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
                                name="toAccount"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("To")}</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder={t("Destination")} />
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
                        </div>

                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t("Description (Optional)")}</FormLabel>
                                    <FormControl>
                                        <Input {...field} placeholder={t("Transfer details...")} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <DialogFooter>
                            <Button type="submit" disabled={submitting}>
                                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {t("Complete Transfer")}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
