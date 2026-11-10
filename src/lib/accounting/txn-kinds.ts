/**
 * What each kind of treasury movement is, for showing it. The stored values
 * (transactions.type and .category) are unchanged; these only name and colour
 * them.
 *
 * withdrawal ("سحب استثمار") is money the owners take out of the business. It
 * is stored with a negative amount, so it lowers the treasury it leaves like an
 * expense does, but its type is not 'expense', so no operating-expense figure
 * (dashboard, Actual Returns, insights, the monthly report) ever counts it.
 */

export type TxnKind = "revenue" | "expense" | "investment" | "withdrawal" | "transfer";

export const kindOf = (type: string | null | undefined): TxnKind => {
    const t = (type || "").toLowerCase();
    if (t === "revenue" || t === "expense" || t === "investment" || t === "withdrawal") return t;
    return "transfer";
};

export const KIND_META: Record<TxnKind, {
    ar: string; en: string;
    /** text colour for the amount and icon */
    tone: string;
    /** soft background for the icon */
    soft: string;
    /** solid swatch */
    swatch: string;
}> = {
    revenue:    { ar: "دخل",          en: "Income",           tone: "text-emerald-700 dark:text-emerald-400", soft: "bg-emerald-50 dark:bg-emerald-950/50", swatch: "bg-emerald-500" },
    expense:    { ar: "مصروف",        en: "Expense",          tone: "text-rose-700 dark:text-rose-400",       soft: "bg-rose-50 dark:bg-rose-950/50",       swatch: "bg-rose-500" },
    investment: { ar: "ضخ استثمار",   en: "Capital in",       tone: "text-indigo-700 dark:text-indigo-400",   soft: "bg-indigo-50 dark:bg-indigo-950/50",   swatch: "bg-indigo-500" },
    withdrawal: { ar: "سحب استثمار",  en: "Capital out",      tone: "text-amber-700 dark:text-amber-400",     soft: "bg-amber-50 dark:bg-amber-950/50",     swatch: "bg-amber-500" },
    transfer:   { ar: "تحويل بين الخزن", en: "Transfer",      tone: "text-slate-600 dark:text-slate-400",     soft: "bg-slate-100 dark:bg-slate-800/60",    swatch: "bg-slate-400" },
};

/** Stored category → Arabic, for the ones the app writes. Others show as stored. */
const CATEGORY_AR: Record<string, string> = {
    "ads": "إعلانات",
    "website": "الموقع",
    "purchases": "مشتريات بضاعة",
    "salaries": "مرتبات",
    "rent": "إيجار",
    "transportation": "مواصلات",
    "fulfilment": "تجهيز وتغليف",
    "returns": "مرتجعات",
    "printing": "طباعة",
    "wrapping": "تغليف",
    "software/tools": "برامج وأدوات",
    "marketing": "تسويق",
    "other": "أخرى",
    "orders collection": "تحصيل أوردرات",
    "orders_collection": "تحصيل أوردرات",
    "deposit": "عربون",
    "deposits": "عربون",
    "investment": "ضخ استثمار",
    "withdrawal": "سحب استثمار",
    "internal transfer": "تحويل بين الخزن",
};

export const categoryLabel = (category: string | null | undefined, ar: boolean) => {
    const c = (category || "").trim();
    if (!c) return ar ? "بدون تصنيف" : "Uncategorised";
    return ar ? (CATEGORY_AR[c.toLowerCase()] ?? c) : c;
};

export const WITHDRAWAL_CATEGORY = "Withdrawal";
export const WITHDRAWAL_MIGRATION = "supabase/migrations/20261110_investment_withdrawal.sql";
