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
import { Checkbox } from "@/components/ui/checkbox";
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
import { useBusiness } from "@/contexts/BusinessContext";
import { logBusinessAction } from "@/lib/logs/actions-logger";


const transactionSchema = z.object({
    date: z.date(),
    amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
    type: z.enum(["investment", "revenue", "expense"]),
    category: z.string().min(1, "Category is required"),
    description: z.string().optional(),
    account: z.string().min(1, "Account is required"), // one of the business's accounts, or 'Split'
    /** With 'Split': the accounts the expense is shared between, equally. */
    splitAccounts: z.array(z.string()).optional(),
    shippingCompanyId: z.string().optional(),
}).refine(
    v => v.account !== SPLIT || (v.splitAccounts?.length ?? 0) >= 2,
    { message: "Pick at least two accounts to split between", path: ["splitAccounts"] },
).refine(
    // A collection is money a courier handed over. Recording it without saying
    // which courier is what left 90 transfers worth 67,983 EGP attached to
    // nothing, reconstructable only by reading names out of free text.
    v => v.category !== COLLECTION_CATEGORY || !!v.shippingCompanyId,
    { message: "Pick the courier this collection came from", path: ["shippingCompanyId"] },
);

interface AddTransactionDialogProps {
    type: "investment" | "revenue" | "expense";
    onSuccess: () => void;
}

const SPLIT = "Split";
const EXPENSE_CATEGORIES = ["Ads", "Website", "Purchases", "Salaries", "Rent", "Transportation", "Fulfilment", "Returns", "Printing", "Wrapping", "Software/Tools", "Marketing", "Other"];
const REVENUE_CATEGORIES = ["Orders Collection", "Deposit", "Other"];
const COLLECTION_CATEGORY = "Orders Collection";

// Define the form values type explicitly for better type inference
type TransactionFormValues = z.infer<typeof transactionSchema>;

export function AddTransactionDialog({ type, onSuccess }: AddTransactionDialogProps) {
    const { activeBusiness, currentUser } = useBusiness();
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [accounts, setAccounts] = useState<any[]>([]);
    const [couriers, setCouriers] = useState<any[]>([]);

    useEffect(() => {
        if (open && activeBusiness) {
            fetchAccounts();
            fetchCouriers();
        }
    }, [open, activeBusiness]);

    async function fetchCouriers() {
        const { data } = await supabase
            .from("shipping_companies")
            .select("id, name")
            .eq("business_id", activeBusiness?.id)
            .order("name");
        setCouriers(data || []);
    }

    async function fetchAccounts() {
        const { data } = await supabase
            .from("financial_accounts")
            .select("name")
            .eq("business_id", activeBusiness?.id)
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
            splitAccounts: [] as string[],
            shippingCompanyId: "",
        },
    });

    const category = form.watch("category");
    const account = form.watch("account");
    const splitAccounts = form.watch("splitAccounts") || [];
    const amount = Number(form.watch("amount")) || 0;
    const isCollection = type === "revenue" && category === COLLECTION_CATEGORY;

    async function onSubmit(values: z.infer<typeof transactionSchema>) {
        setSubmitting(true);
        try {
            const finalAmount = values.type === "expense" ? -values.amount : values.amount;
            const payload = {
                business_id: activeBusiness!.id,
                transaction_date: values.date.toISOString(),
                type: values.type,
                category: values.category,
                description: values.description,
                shipping_company_id:
                    values.category === COLLECTION_CATEGORY && values.shippingCompanyId
                        ? values.shippingCompanyId
                        : null,
            };

            if (values.type === "expense" && values.account === SPLIT) {
                // Shared equally between the accounts picked — this business's
                // own. It used to be two names written into the code, so a
                // split in any other business put half the expense in an
                // account that business does not have. In piastres, so the
                // parts always add up to the amount: any odd piastre goes to
                // the last account.
                const names = (values.splitAccounts || []).filter(n => accounts.some(a => a.name === n));
                if (names.length < 2) throw new Error("Pick at least two accounts to split between");
                const totalPiastres = Math.round(finalAmount * 100);
                const share = Math.trunc(totalPiastres / names.length);
                const { error } = await supabase.from("transactions").insert(names.map((name, i) => ({
                    ...payload,
                    amount: (i === names.length - 1 ? totalPiastres - share * (names.length - 1) : share) / 100,
                    account_name: name,
                })));
                if (error) throw error;
            } else {
                const { error } = await supabase.from("transactions").insert({
                    ...payload,
                    amount: finalAmount,
                    account_name: values.account,
                });
                if (error) throw error;
            }

            logBusinessAction({
                businessId: activeBusiness!.id,
                userEmail: currentUser?.email || "Staff",
                actionType: "create",
                entityType: "transaction",
                entityId: `tx-${Date.now()}`,
                entityName: `${values.type.toUpperCase()}: ${values.amount} EGP (${values.category})`,
                changes: [
                    { field: "Amount", old_value: null, new_value: `${finalAmount} EGP` },
                    { field: "Account", old_value: null, new_value: values.account === SPLIT ? `Split: ${(values.splitAccounts || []).join(", ")}` : values.account }
                ]
            });

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
                                        <Input type="number" step="0.01" {...field} value={field.value as number} />
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

                        {/* Which courier handed this money over. Only asked for
                            a collection, where it is the whole point, and
                            required there — see the schema refinement. */}
                        {isCollection && (
                            <FormField
                                control={form.control}
                                name="shippingCompanyId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Shipping Company</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value || ""}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Which courier paid this?" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {couriers.map((c) => (
                                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                                ))}
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
                                    <Select defaultValue={field.value} onValueChange={v => {
                                        field.onChange(v);
                                        // Split starts with every account ticked.
                                        if (v === SPLIT) form.setValue("splitAccounts", accounts.map(a => a.name));
                                    }}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select Account" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {accounts.map((acc) => (
                                                <SelectItem key={acc.name} value={acc.name}>{acc.name}</SelectItem>
                                            ))}
                                            {type === "expense" && accounts.length >= 2 && (
                                                <SelectItem value={SPLIT}>Split equally between accounts</SelectItem>
                                            )}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Which of this business's accounts share a split, and how much each pays. */}
                        {type === "expense" && account === SPLIT && (
                            <FormField
                                control={form.control}
                                name="splitAccounts"
                                render={() => (
                                    <FormItem>
                                        <FormLabel>Split between</FormLabel>
                                        <div className="space-y-1.5 rounded-md border p-2">
                                            {accounts.map(acc => {
                                                const checked = splitAccounts.includes(acc.name);
                                                return (
                                                    <label key={acc.name} className="flex cursor-pointer items-center justify-between gap-3 rounded px-1.5 py-1 text-sm hover:bg-muted/50">
                                                        <span className="flex items-center gap-2">
                                                            <Checkbox checked={checked} onCheckedChange={c => form.setValue("splitAccounts",
                                                                c ? [...splitAccounts, acc.name] : splitAccounts.filter(n => n !== acc.name), { shouldValidate: true })} />
                                                            {acc.name}
                                                        </span>
                                                        {checked && splitAccounts.length >= 2 && amount > 0 && (
                                                            <span className="tabular-nums text-muted-foreground">
                                                                {(amount / splitAccounts.length).toLocaleString("en", { maximumFractionDigits: 2 })} EGP
                                                            </span>
                                                        )}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}

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
