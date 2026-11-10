"use client";

import { useState, useEffect, type ReactNode } from "react";
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
import { ar as arLocale } from "date-fns/locale";
import { toast } from "sonner";
import { cn, formatCurrency } from "@/lib/utils";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { KIND_META, WITHDRAWAL_CATEGORY, WITHDRAWAL_MIGRATION, categoryLabel } from "@/lib/accounting/txn-kinds";


const transactionSchema = z.object({
    date: z.date(),
    amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
    type: z.enum(["investment", "revenue", "expense", "withdrawal"]),
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

export type TransactionDialogType = "investment" | "revenue" | "expense" | "withdrawal";

interface AddTransactionDialogProps {
    type: TransactionDialogType;
    onSuccess: () => void;
    /** The button that opens it; a default one when left out. */
    trigger?: ReactNode;
}

const SPLIT = "Split";
const EXPENSE_CATEGORIES = ["Ads", "Website", "Purchases", "Salaries", "Rent", "Transportation", "Fulfilment", "Returns", "Printing", "Wrapping", "Software/Tools", "Marketing", "Other"];
const REVENUE_CATEGORIES = ["Orders Collection", "Deposit", "Other"];
const COLLECTION_CATEGORY = "Orders Collection";
/** Types whose amount leaves the treasury, stored negative. */
const OUTFLOW = new Set<TransactionDialogType>(["expense", "withdrawal"]);

const COPY: Record<TransactionDialogType, { ar: [string, string]; en: [string, string] }> = {
    revenue: {
        ar: ["دخل جديد", "فلوس دخلت الخزنة: تحصيل من شركة شحن، عربون، أو غيره."],
        en: ["Add income", "Money that came into a treasury: a courier collection, a deposit, or other."],
    },
    expense: {
        ar: ["مصروف جديد", "فلوس صرفتها على الشغل. بتتحسب في المصاريف وفي صافي الربح."],
        en: ["Add expense", "Money spent running the business. Counted in expenses and net profit."],
    },
    investment: {
        ar: ["ضخ استثمار", "فلوس الشركا حطوها في البيزنس. بتزوّد الخزنة، ومش بتتحسب دخل."],
        en: ["Add capital", "Money the owners put into the business. Adds to the treasury; not income."],
    },
    withdrawal: {
        ar: ["سحب استثمار", "فلوس الشركا خدوها من البيزنس. بتتخصم من الخزنة، ومش بتتحسب مصروف تشغيل."],
        en: ["Withdraw capital", "Money the owners take out of the business. Leaves the treasury; not an operating expense."],
    },
};

export function AddTransactionDialog({ type, onSuccess, trigger }: AddTransactionDialogProps) {
    const { activeBusiness, currentUser } = useBusiness();
    const { language } = useLanguage();
    const ar = language === "ar";
    const L = (a: string, e: string) => (ar ? a : e);
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [accounts, setAccounts] = useState<any[]>([]);
    const [couriers, setCouriers] = useState<any[]>([]);
    const [balances, setBalances] = useState<Record<string, number>>({});

    useEffect(() => {
        if (open && activeBusiness) {
            fetchAccounts();
            fetchCouriers();
            fetchBalances();
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

    // Shown beside each account, so whoever records money going out sees
    // what is in there first.
    async function fetchBalances() {
        const { data } = await supabase.rpc("get_treasury_balances", { p_business_id: activeBusiness?.id });
        const next: Record<string, number> = {};
        (data || []).forEach((r: { account_name: string; balance: number }) => {
            if (r.account_name) next[r.account_name] = Number(r.balance) || 0;
        });
        setBalances(next);
    }

    const form = useForm({
        resolver: zodResolver(transactionSchema),
        defaultValues: {
            type: type,
            date: new Date(),
            account: "",
            amount: 0,
            description: "",
            category: type === "investment" ? "Investment" : type === "withdrawal" ? WITHDRAWAL_CATEGORY : "",
            splitAccounts: [] as string[],
            shippingCompanyId: "",
        },
    });

    const category = form.watch("category");
    const account = form.watch("account");
    const splitAccounts = form.watch("splitAccounts") || [];
    const amount = Number(form.watch("amount")) || 0;
    const isCollection = type === "revenue" && category === COLLECTION_CATEGORY;
    const isOut = OUTFLOW.has(type);
    const chosenBalance = account && account !== SPLIT ? balances[account] : undefined;
    const overdraws = isOut && chosenBalance !== undefined && amount > 0 && amount > chosenBalance;

    async function onSubmit(values: z.infer<typeof transactionSchema>) {
        setSubmitting(true);
        try {
            const finalAmount = OUTFLOW.has(values.type) ? -values.amount : values.amount;
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

            toast.success(L(`اتسجل: ${COPY[type].ar[0]} ${formatCurrency(values.amount)}`, `Saved: ${COPY[type].en[0]} ${formatCurrency(values.amount)}`));
            setOpen(false);
            form.reset();
            onSuccess();
        } catch (error) {
            console.error("Error adding transaction:", error);
            const code = (error as { code?: string })?.code;
            toast.error(code === "23514" && values.type === "withdrawal"
                ? L(`شغّل ${WITHDRAWAL_MIGRATION} في Supabase الأول.`, `Run ${WITHDRAWAL_MIGRATION} in Supabase first.`)
                : L("ماتسجلش، جرّب تاني.", "Not saved. Try again."));
        } finally {
            setSubmitting(false);
        }
    }

    const meta = KIND_META[type];
    const [title, description] = ar ? COPY[type].ar : COPY[type].en;
    const categories = type === "revenue" ? REVENUE_CATEGORIES : type === "expense" ? EXPENSE_CATEGORIES : [];

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger ?? <Button variant="outline">{title}</Button>}
            </DialogTrigger>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[480px]" dir={ar ? "rtl" : "ltr"}>
                <DialogHeader className="pr-6 text-start">
                    <DialogTitle className="flex items-center gap-2">
                        <span className={cn("h-2.5 w-2.5 rounded-full", meta.swatch)} aria-hidden />
                        {title}
                    </DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

                        {/* The amount first, large: it is what this is about. */}
                        <FormField
                            control={form.control}
                            name="amount"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{L("المبلغ", "Amount")}</FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Input
                                                type="number" step="0.01" inputMode="decimal" autoFocus
                                                {...field}
                                                value={(field.value as number) || ""}
                                                placeholder="0"
                                                className={cn("h-14 pe-16 text-2xl font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none", meta.tone)}
                                            />
                                            <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-muted-foreground">{L("ج.م", "EGP")}</span>
                                        </div>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Category, as choices rather than a dropdown. */}
                        {categories.length > 0 && (
                            <FormField
                                control={form.control}
                                name="category"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{L("التصنيف", "Category")}</FormLabel>
                                        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={L("التصنيف", "Category")}>
                                            {categories.map(c => (
                                                <button
                                                    key={c}
                                                    type="button"
                                                    role="radio"
                                                    aria-checked={field.value === c}
                                                    onClick={() => field.onChange(c)}
                                                    className={cn(
                                                        "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                        field.value === c ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
                                                    )}
                                                >
                                                    {categoryLabel(c, ar)}
                                                </button>
                                            ))}
                                        </div>
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
                                        <FormLabel>{L("من شركة الشحن", "From courier")}</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value || ""}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder={L("مين اللي دفع؟", "Which courier paid this?")} />
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

                        {/* Treasury, each with what is in it now. */}
                        <FormField
                            control={form.control}
                            name="account"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{isOut ? L("من خزنة", "From treasury") : L("في خزنة", "Into treasury")}</FormLabel>
                                    <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label={L("الخزنة", "Treasury")}>
                                        {accounts.map(acc => (
                                            <button
                                                key={acc.name}
                                                type="button"
                                                role="radio"
                                                aria-checked={field.value === acc.name}
                                                onClick={() => field.onChange(acc.name)}
                                                className={cn(
                                                    "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                    field.value === acc.name ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/60",
                                                )}
                                            >
                                                <span className="truncate font-medium">{acc.name}</span>
                                                {balances[acc.name] !== undefined && (
                                                    <span className={cn("shrink-0 text-xs tabular-nums", balances[acc.name] < 0 ? "text-destructive" : "text-muted-foreground")}>
                                                        {formatCurrency(balances[acc.name])}
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                        {type === "expense" && accounts.length >= 2 && (
                                            <button
                                                type="button"
                                                role="radio"
                                                aria-checked={field.value === SPLIT}
                                                onClick={() => {
                                                    field.onChange(SPLIT);
                                                    // Split starts with every account ticked.
                                                    form.setValue("splitAccounts", accounts.map(a => a.name));
                                                }}
                                                className={cn(
                                                    "rounded-lg border border-dashed px-3 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                    field.value === SPLIT ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/60",
                                                )}
                                            >
                                                {L("قسّمه بالتساوي على كذا خزنة", "Split equally between treasuries")}
                                            </button>
                                        )}
                                    </div>
                                    {accounts.length === 0 && (
                                        <p className="text-sm text-muted-foreground">{L("مفيش خزن لسه. ضيف خزنة من «إدارة الخزن» الأول.", "No treasuries yet. Add one from Manage treasuries first.")}</p>
                                    )}
                                    {overdraws && (
                                        <p className="text-sm text-amber-700 dark:text-amber-400">
                                            {L(`المبلغ أكبر من اللي في الخزنة (${formatCurrency(chosenBalance!)}). الرصيد هيبقى بالسالب.`,
                                                `More than this treasury holds (${formatCurrency(chosenBalance!)}). Its balance will go negative.`)}
                                        </p>
                                    )}
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
                                        <FormLabel>{L("مقسوم على", "Split between")}</FormLabel>
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
                                                                {formatCurrency(amount / splitAccounts.length)}
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

                        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
                            {/* Date */}
                            <FormField
                                control={form.control}
                                name="date"
                                render={({ field }) => (
                                    <FormItem className="flex flex-col">
                                        <FormLabel>{L("التاريخ", "Date")}</FormLabel>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <FormControl>
                                                    <Button variant="outline" className="w-full justify-between gap-2 font-normal sm:w-44">
                                                        {field.value ? format(field.value, "d MMM yyyy", ar ? { locale: arLocale } : undefined) : L("اختار يوم", "Pick a date")}
                                                        <CalendarIcon className="h-4 w-4 opacity-50" />
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

                            {/* Description */}
                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{L("ملاحظة", "Note")}</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder={L("اختياري", "Optional")} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <DialogFooter className="gap-2 sm:justify-between">
                            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{L("رجوع", "Cancel")}</Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                                {L(`سجّل ${title}`, `Save ${title.toLowerCase()}`)}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
