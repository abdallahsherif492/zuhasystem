"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
    AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FileText, ListChecks, Loader2, Lock, Pencil, Plus, Trash2, Unlock, Wallet,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
    ADJUSTMENT_KINDS, addMonths, applies, attendanceSummary, dayRate, kindInfo, monthLabel, payTotals, payslipTotals, periodDate, periodKey,
    type Adjustment, type AdjustmentKind, type AttendanceSummary, type PayTotals, type Payslip,
} from "@/lib/payroll";

const MIGRATION = "supabase/migrations/20261001_payroll.sql";
const isMissing = (e: { code?: string; message?: string } | null) =>
    !!e && (["42P01", "42703", "PGRST202", "PGRST205", "PGRST204"].includes(e.code || "") || /does not exist|could not find/i.test(e.message || ""));
const today = () => new Date().toISOString().slice(0, 10);

interface Row {
    id: string;              // business_users.id
    email: string;
    role: string;
    name: string;
    title: string | null;
    salary: number;
    hasSalaryRow: boolean;
    items: Adjustment[];
    totals: PayTotals;
    payslip: Payslip | null;
    attendance: AttendanceSummary;
}

/**
 * Payroll for one month: each employee's salary, the bonuses, deductions and
 * advances recorded against it during the month, and settling it — which
 * books the net in accounting and produces the payslip.
 */
export default function PayrollPage() {
    const { activeBusiness, currentUser } = useBusiness();
    const { language } = useLanguage();
    const ar = language !== "en";
    const t = useCallback((a: string, e: string) => (ar ? a : e), [ar]);

    const [period, setPeriod] = useState(() => periodKey(new Date()));
    const [rows, setRows] = useState<Row[]>([]);
    const [accounts, setAccounts] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);
    const [showAll, setShowAll] = useState(false);

    const [adding, setAdding] = useState<{ row: Row; kind: AdjustmentKind; editing?: Adjustment } | null>(null);
    const [details, setDetails] = useState<string | null>(null);
    const [settling, setSettling] = useState<string | null>(null);
    const [bulkOpen, setBulkOpen] = useState(false);

    const load = useCallback(async () => {
        if (!activeBusiness) return;
        const b = activeBusiness.id;
        try {
            const start = periodDate(period);
            const end = periodDate(addMonths(period, 1));
            const [members, salaries, adjustments, payslips, logs, accs] = await Promise.all([
                supabase.from("business_users").select("id, user_email, role, weekend_days").eq("business_id", b),
                supabase.from("employee_salaries").select("business_user_id, monthly_salary, employee_name, job_title").eq("business_id", b),
                supabase.from("payroll_adjustments").select("id, business_user_id, kind, amount, reason, entry_date, transaction_id, apply_to_salary").eq("business_id", b).eq("period", start).order("entry_date"),
                supabase.from("payslips").select("*").eq("business_id", b).eq("period", start),
                supabase.from("attendance_logs").select("user_email, date, delay_minutes").eq("business_id", b).gte("date", start).lt("date", end),
                supabase.from("financial_accounts").select("name").eq("business_id", b),
            ]);
            if ([salaries.error, adjustments.error, payslips.error].some(isMissing)) {
                setMissing(true);
                return;
            }
            setMissing(false);
            setAccounts((accs.data || []).map(a => a.name).filter(Boolean));

            const sal = new Map((salaries.data || []).map(s => [s.business_user_id, s]));
            const out: Row[] = (members.data || []).map(m => {
                const s = sal.get(m.id);
                const items = (adjustments.data || []).filter(a => a.business_user_id === m.id).map(a => ({ ...a, amount: Number(a.amount) })) as Adjustment[];
                const payslip = ((payslips.data || []) as Payslip[]).find(p => p.business_user_id === m.id) ?? null;
                const salary = Number(s?.monthly_salary || 0);
                const email = (m.user_email || "").toLowerCase().trim();
                return {
                    id: m.id,
                    email: m.user_email,
                    role: m.role,
                    name: s?.employee_name?.trim() || m.user_email.split("@")[0],
                    title: s?.job_title || null,
                    salary,
                    hasSalaryRow: !!s,
                    items,
                    payslip,
                    totals: payslip ? payslipTotals(payslip) : payTotals(salary, items),
                    attendance: attendanceSummary(period, m.weekend_days, (logs.data || []).filter(l => (l.user_email || "").toLowerCase().trim() === email)),
                };
            });
            out.sort((a, z) => z.salary - a.salary || a.name.localeCompare(z.name));
            setRows(out);
        } catch (e) {
            console.error("Payroll load failed:", e);
            toast.error(t("مش قادر أحمّل المرتبات", "Could not load payroll"));
        } finally {
            setLoading(false);
        }
    }, [activeBusiness, period, t]);

    useEffect(() => { load(); }, [load]);

    const changeMonth = (n: number) => { setLoading(true); setPeriod(p => addMonths(p, n)); };

    const visible = rows.filter(r => showAll || r.salary > 0 || r.items.length > 0 || r.payslip);
    const sum = (f: (r: Row) => number) => visible.reduce((s, r) => s + f(r), 0);
    const settledCount = visible.filter(r => r.payslip).length;
    const detailRow = rows.find(r => r.id === details) ?? null;

    if (!activeBusiness) return null;

    return (
        <div className="space-y-5" dir={ar ? "rtl" : "ltr"}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t("المرتبات", "Payroll")}</h1>
                    <p className="text-muted-foreground">{t("سجّل البونص والخصومات والسلف طول الشهر، وفي الآخر سوّي المرتب واطبع القسيمة.", "Record bonuses, deductions and advances during the month, then settle and print the payslip.")}</p>
                </div>
                <div className="flex items-center gap-1 rounded-lg border bg-background p-1">
                    <Button variant="ghost" size="icon" onClick={() => changeMonth(-1)} aria-label={t("الشهر اللي فات", "Previous month")}>
                        {ar ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    </Button>
                    <div className="min-w-[130px] text-center font-semibold">{monthLabel(period, ar)}</div>
                    <Button variant="ghost" size="icon" onClick={() => changeMonth(1)} aria-label={t("الشهر الجاي", "Next month")}>
                        {ar ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            {missing ? (
                <Card className="border-amber-300">
                    <CardContent className="flex gap-3 p-5 text-sm">
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                        <div>
                            <div className="font-medium">{t("محتاج تشغّل migration الأول", "Run the migration first")}</div>
                            <p className="mt-1 text-muted-foreground">{t("شغّل الملف ده في Supabase → SQL Editor:", "Run this file in Supabase → SQL Editor:")} <code className="rounded bg-muted px-1" dir="ltr">{MIGRATION}</code></p>
                        </div>
                    </CardContent>
                </Card>
            ) : loading ? (
                <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                        <Kpi label={t("المرتبات الأساسية", "Base salaries")} value={formatCurrency(sum(r => r.totals.base))} />
                        <Kpi label={t("بونص", "Bonuses")} value={`+ ${formatCurrency(sum(r => r.totals.bonuses))}`} tone="good" />
                        <Kpi label={t("خصومات", "Deductions")} value={`− ${formatCurrency(sum(r => r.totals.deductions))}`} tone="bad" />
                        <Kpi label={t("سلف", "Advances")} value={`− ${formatCurrency(sum(r => r.totals.advances))}`} tone="bad" />
                        <Kpi label={t("الصافي المستحق", "Net to pay")} value={formatCurrency(sum(r => Math.max(0, r.totals.net)))} hint={t(`اتصرف ${settledCount} من ${visible.length}`, `${settledCount} of ${visible.length} paid`)} strong />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-sm">
                            <Switch checked={showAll} onCheckedChange={setShowAll} />
                            {t("اعرض كل الفريق (حتى اللي ملهوش مرتب)", "Show the whole team (even without a salary)")}
                        </label>
                        {visible.some(r => !r.payslip && r.totals.base > 0) && (
                            <Button variant="outline" onClick={() => setBulkOpen(true)}><Wallet className="me-2 h-4 w-4" />{t("صرف كل المرتبات", "Pay everyone")}</Button>
                        )}
                    </div>

                    <Card>
                        <CardContent className="overflow-x-auto p-0">
                            <table className="w-full min-w-[820px] text-sm">
                                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                                    <tr className="[&>th]:px-2 [&>th]:py-2.5 [&>th]:text-start [&>th]:font-medium [&>th:first-child]:ps-3">
                                        <th>{t("الموظف", "Employee")}</th>
                                        <th>{t("الأساسي", "Base")}</th>
                                        <th>{t("بونص", "Bonus")}</th>
                                        <th>{t("خصومات", "Deductions")}</th>
                                        <th>{t("سلف", "Advances")}</th>
                                        <th>{t("الصافي", "Net")}</th>
                                        <th>{t("الحضور", "Attendance")}</th>
                                        <th>{t("الحالة", "Status")}</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {visible.length === 0 && (
                                        <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">
                                            {t("مفيش موظفين ليهم مرتب. حدّد المرتب من صفحة فريق العمل، أو شغّل \"اعرض كل الفريق\".", "No one has a salary yet. Set salaries on the Team page, or turn on \"Show the whole team\".")}
                                        </td></tr>
                                    )}
                                    {visible.map(r => (
                                        <tr key={r.id} className="whitespace-nowrap hover:bg-muted/30 [&>td]:px-2 [&>td]:py-2.5 [&>td:first-child]:ps-3 [&>td:last-child]:pe-3">
                                            <td>
                                                <button className="text-start" onClick={() => setDetails(r.id)}>
                                                    <div className="font-medium hover:underline">{r.name}</div>
                                                    <div className="text-xs text-muted-foreground">{r.title || r.email}</div>
                                                </button>
                                            </td>
                                            <td>{formatCurrency(r.totals.base)}</td>
                                            <td className="text-emerald-600 dark:text-emerald-400">{r.totals.bonuses ? <span dir="ltr">+{formatCurrency(r.totals.bonuses)}</span> : "—"}</td>
                                            <td className="text-red-600 dark:text-red-400">{r.totals.deductions ? <span dir="ltr">−{formatCurrency(r.totals.deductions)}</span> : "—"}</td>
                                            <td className="text-red-600 dark:text-red-400">{r.totals.advances ? <span dir="ltr">−{formatCurrency(r.totals.advances)}</span> : "—"}</td>
                                            <td className={cn("font-bold", r.totals.net < 0 && "text-red-600")}><span dir="ltr">{formatCurrency(r.totals.net)}</span></td>
                                            <td className="text-xs">
                                                {/* No clock-in at all this month: they don't use it, not 26 days absent. */}
                                                {r.attendance.present === 0 ? <span className="text-muted-foreground">—</span> : <>
                                                    <div className="whitespace-nowrap">{r.attendance.present}/{r.attendance.workdays} {t("يوم", "days")}</div>
                                                    {r.attendance.lateMinutes > 0 && <div className="text-muted-foreground">{t(`تأخير ${r.attendance.lateMinutes} د`, `${r.attendance.lateMinutes} min late`)}</div>}
                                                </>}
                                            </td>
                                            <td>
                                                {r.payslip
                                                    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" />{t("اتصرف", "Paid")} {r.payslip.paid_on.slice(8, 10)}/{r.payslip.paid_on.slice(5, 7)}</span>
                                                    : <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t("مفتوح", "Open")}</span>}
                                            </td>
                                            <td>
                                                <div className="flex justify-end gap-1">
                                                    {r.items.length > 0 && (
                                                        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setDetails(r.id)} title={t("عرض وتعديل الحركات", "View and edit entries")}>
                                                            <ListChecks className="me-1 h-3.5 w-3.5" />{r.items.length}
                                                        </Button>
                                                    )}
                                                    {!r.payslip && (
                                                        <Button size="sm" variant="outline" className="h-8" onClick={() => setAdding({ row: r, kind: "bonus" })}>
                                                            <Plus className="me-1 h-3.5 w-3.5" />{t("إضافة", "Add")}
                                                        </Button>
                                                    )}
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" asChild title={t("القسيمة", "Payslip")}>
                                                        <Link href={`/team/payroll/payslip?member=${r.id}&period=${period}`} target="_blank" aria-label={t("القسيمة", "Payslip")}><FileText className="h-4 w-4" /></Link>
                                                    </Button>
                                                    {!r.payslip && <Button size="sm" className="h-8" onClick={() => setSettling(r.id)}>{t("صرف", "Pay")}</Button>}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </CardContent>
                    </Card>
                    <p className="text-xs text-muted-foreground">
                        {t("مفيش حاجة بتتسجل في الحسابات غير لما تختار ده بنفسك، ولا خصم بيتخصم غير لما يكون متفعّل. لو سجّلت السلفة والمرتب الاتنين في الحسابات، الصرف بيسجّل الصافي بس فمفيش تكرار. الحضور من سجل البصمة، ومش بيطرح الإجازات.",
                            "Nothing is recorded in accounting unless you choose it, and nothing is deducted unless it is switched on. If both the advance and the salary are recorded, paying records only the net, so nothing is counted twice. Attendance comes from clock-ins and does not subtract leave.")}
                    </p>
                </>
            )}

            {adding && (
                <AddAdjustmentDialog
                    row={adding.row}
                    initialKind={adding.kind}
                    editing={adding.editing}
                    period={period}
                    accounts={accounts}
                    ar={ar}
                    onClose={() => setAdding(null)}
                    onSaved={() => { setAdding(null); load(); }}
                />
            )}
            {detailRow && (
                <DetailsDialog
                    row={detailRow}
                    period={period}
                    businessId={activeBusiness.id}
                    editorEmail={currentUser?.email || null}
                    ar={ar}
                    onClose={() => setDetails(null)}
                    onChanged={load}
                    onAdd={kind => setAdding({ row: detailRow, kind })}
                    onEdit={item => setAdding({ row: detailRow, kind: item.kind, editing: item })}
                />
            )}
            {settling && rows.some(r => r.id === settling && !r.payslip) && (
                <SettleDialog rows={rows.filter(r => r.id === settling)} period={period} accounts={accounts} ar={ar} onClose={() => setSettling(null)} onDone={() => { setSettling(null); load(); }} onChanged={load} />
            )}
            {bulkOpen && (
                <SettleDialog rows={visible.filter(r => !r.payslip && r.totals.base > 0)} period={period} accounts={accounts} ar={ar} onClose={() => setBulkOpen(false)} onDone={() => { setBulkOpen(false); load(); }} onChanged={load} />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------

function Kpi({ label, value, hint, tone, strong }: { label: string; value: string; hint?: string; tone?: "good" | "bad"; strong?: boolean }) {
    return (
        <Card className={cn(strong && "border-primary/40 bg-primary/[0.03]")}>
            <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className={cn("mt-1 text-lg font-bold", tone === "good" && "text-emerald-600 dark:text-emerald-400", tone === "bad" && "text-red-600 dark:text-red-400")}><span dir="ltr">{value}</span></div>
                {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
            </CardContent>
        </Card>
    );
}

/**
 * Whether something is booked in accounting, and from which account. Off by
 * default: nothing reaches accounting unless it is switched on here.
 */
function AccountingChoice({ on, onToggle, account, onAccount, accounts, label, hint, ar }: {
    on: boolean; onToggle: (v: boolean) => void; account: string; onAccount: (v: string) => void;
    accounts: string[]; label: string; hint: string; ar: boolean;
}) {
    return (
        <div className="space-y-2 rounded-md border p-2.5">
            <label className="flex items-center justify-between gap-3 text-sm">
                <span>{label}</span>
                <Switch checked={on} onCheckedChange={onToggle} disabled={!accounts.length} />
            </label>
            {on && (
                <Select value={account} onValueChange={onAccount}>
                    <SelectTrigger className="h-9"><SelectValue placeholder={ar ? "من أنهي حساب؟" : "From which account?"} /></SelectTrigger>
                    <SelectContent>{accounts.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
            )}
            <p className="text-xs text-muted-foreground">{accounts.length ? hint : (ar ? "مفيش حسابات متعرّفة في صفحة الحسابات." : "No accounts are set up on the Accounting page.")}</p>
        </div>
    );
}

/** A deduction or advance switched on or off for this month's pay. */
async function setApplies(item: Adjustment, on: boolean, ar: boolean) {
    const { error } = await supabase.from("payroll_adjustments").update({ apply_to_salary: on }).eq("id", item.id!);
    if (error) { console.error(error); toast.error(rpcError(error, ar ? "ماتحفظش" : "Not saved")); return false; }
    return true;
}

/** Yes/no with one extra, unticked-by-default choice — used where accounting may be touched. */
function ConfirmWithOption({ title, body, option, confirmLabel, ar, onCancel, onConfirm }: {
    title: string; body: string; option: string | null; confirmLabel: string; ar: boolean;
    onCancel: () => void; onConfirm: (optionChecked: boolean) => Promise<void>;
}) {
    const [checked, setChecked] = useState(false);
    const [busy, setBusy] = useState(false);
    return (
        <Dialog open onOpenChange={o => !o && !busy && onCancel()}>
            <DialogContent dir={ar ? "rtl" : "ltr"} className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{body}</DialogDescription>
                </DialogHeader>
                {option && (
                    <label className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
                        <Checkbox checked={checked} onCheckedChange={v => setChecked(v === true)} className="mt-0.5" />
                        <span>{option}</span>
                    </label>
                )}
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={onCancel} disabled={busy}>{ar ? "إلغاء" : "Cancel"}</Button>
                    <Button variant="destructive" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(checked); setBusy(false); }}>
                        {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const rpcError = (e: { message?: string } | null, fallback: string) => {
    const m = e?.message || "";
    return /[؀-ۿ]/.test(m) ? m : fallback;
};

/** Add an entry, or correct one already added (`editing`). */
function AddAdjustmentDialog({ row, initialKind, editing, period, accounts, ar, onClose, onSaved }: {
    row: Row; initialKind: AdjustmentKind; editing?: Adjustment; period: string; accounts: string[]; ar: boolean;
    onClose: () => void; onSaved: () => void;
}) {
    const t = (a: string, e: string) => (ar ? a : e);
    const [kind, setKind] = useState<AdjustmentKind>(editing?.kind ?? initialKind);
    const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
    const [days, setDays] = useState("");
    const [reason, setReason] = useState(editing?.reason ?? "");
    // Within the month being viewed; today when that is this month.
    const [date, setDate] = useState(() => editing?.entry_date ?? (today().startsWith(period) ? today() : `${period}-01`));
    const [book, setBook] = useState(false);
    const [account, setAccount] = useState<string>("");
    const [deduct, setDeduct] = useState(editing ? applies(editing) : true);
    // An advance already in accounting: whether its expense follows the edit. Off by default.
    const [syncTx, setSyncTx] = useState(false);
    const [saving, setSaving] = useState(false);
    const rate = dayRate(row.salary);
    // An entry belongs to the month of its date, not to whichever month is on screen.
    const month = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : period;

    const save = async () => {
        const value = parseFloat(amount);
        if (!(value > 0)) { toast.error(t("اكتب مبلغ أكبر من صفر", "Enter an amount above zero")); return; }
        if (kind === "advance" && book && !account) { toast.error(t("اختار الحساب اللي اتصرفت منه", "Pick the account it was paid from")); return; }
        setSaving(true);
        const { error } = editing ? await supabase.rpc("payroll_update_adjustment", {
            p_id: editing.id,
            p_kind: kind,
            p_amount: value,
            p_reason: reason.trim(),
            p_entry_date: date,
            p_apply_to_salary: kind === "bonus" ? true : deduct,
            p_update_transaction: syncTx,
        }) : await supabase.rpc("payroll_add_adjustment", {
            p_business_user_id: row.id,
            p_period: periodDate(month),
            p_kind: kind,
            p_amount: value,
            p_reason: reason.trim(),
            p_entry_date: date,
            p_account_name: kind === "advance" && book ? account : null,
            p_apply_to_salary: kind === "bonus" ? true : deduct,
        });
        setSaving(false);
        if (error) { console.error(error); toast.error(rpcError(error, t("ماتحفظش، جرّب تاني", "Not saved, try again"))); return; }
        toast.success(editing ? t("اتعدّل", "Updated") : t("اتسجّل", "Saved"));
        onSaved();
    };

    return (
        <Dialog open onOpenChange={o => !o && onClose()}>
            <DialogContent dir={ar ? "rtl" : "ltr"} className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{editing ? t("تعديل — ", "Edit — ") : ""}{row.name} — {monthLabel(month, ar)}</DialogTitle>
                    <DialogDescription>{t("المرتب الأساسي", "Base salary")} {formatCurrency(row.salary)}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                        {ADJUSTMENT_KINDS.map(k => (
                            <button key={k.key} onClick={() => setKind(k.key)} className={cn("rounded-md py-1.5 text-sm font-medium", kind === k.key ? "bg-background shadow-sm" : "text-muted-foreground")}>
                                {ar ? k.ar : k.en}
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>{t("المبلغ", "Amount")}</Label>
                            <Input type="number" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setDays(""); }} autoFocus />
                        </div>
                        <div className="space-y-1.5">
                            <Label>{t("التاريخ", "Date")}</Label>
                            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                        </div>
                    </div>
                    {kind === "deduction" && row.salary > 0 && (
                        <div className="flex items-end gap-2 rounded-md border border-dashed p-2.5">
                            <div className="flex-1 space-y-1">
                                <Label className="text-xs">{t(`أو بالأيام (اليوم = ${formatCurrency(rate)})`, `Or in days (a day = ${formatCurrency(rate)})`)}</Label>
                                <Input type="number" inputMode="decimal" step="0.5" value={days} placeholder={row.attendance.present > 0 && row.attendance.absent ? t(`غياب ${row.attendance.absent} يوم`, `${row.attendance.absent} days absent`) : ""}
                                    onChange={e => { setDays(e.target.value); const d = parseFloat(e.target.value); setAmount(d > 0 ? String(Math.round(d * rate)) : ""); }} />
                            </div>
                        </div>
                    )}
                    <div className="space-y-1.5">
                        <Label>{t("السبب", "Reason")}</Label>
                        <Input value={reason} onChange={e => setReason(e.target.value)} placeholder={kind === "bonus" ? t("مثلاً: تارجت الشهر", "e.g. monthly target") : kind === "deduction" ? t("مثلاً: غياب يوم", "e.g. one day absent") : t("مثلاً: سلفة", "e.g. advance")} />
                    </div>
                    {month !== period && (
                        <p className="text-xs text-amber-700 dark:text-amber-300">{t(`هتتسجل على مرتب ${monthLabel(month, ar)} حسب التاريخ.`, `Goes on ${monthLabel(month, ar)}'s pay, by its date.`)}</p>
                    )}
                    {kind !== "bonus" && (
                        <label className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm">
                            <span>
                                {kind === "advance" ? t("تتخصم من مرتب الشهر ده", "Deduct from this month's pay") : t("يتخصم من مرتب الشهر ده", "Deduct from this month's pay")}
                                {!deduct && <span className="block text-xs text-muted-foreground">{t("هتتسجل بس، وتقدر تفعّل الخصم بعدين من تفاصيل الموظف.", "Recorded only; switch the deduction on later from the employee's details.")}</span>}
                            </span>
                            <Switch checked={deduct} onCheckedChange={setDeduct} />
                        </label>
                    )}
                    {editing?.transaction_id && (
                        <label className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
                            <Checkbox checked={syncTx} onCheckedChange={v => setSyncTx(v === true)} className="mt-0.5" />
                            <span>
                                {t("عدّل المصروف المتسجل في الحسابات كمان (المبلغ والتاريخ)", "Also update the expense recorded in accounting (amount and date)")}
                                {!syncTx && <span className="block text-xs text-muted-foreground">{t("لو سيبتها، المصروف في الحسابات هيفضل زي ما هو.", "Left off, the expense in accounting stays as it is.")}</span>}
                            </span>
                        </label>
                    )}
                    {kind === "advance" && !editing && (
                        <AccountingChoice
                            on={book} onToggle={setBook} account={account} onAccount={setAccount} accounts={accounts} ar={ar}
                            label={t("سجّلها مصروف في الحسابات", "Record as an expense in accounting")}
                            hint={book
                                ? t("هتتسجل مصروف Salaries من الحساب ده بتاريخها.", "Recorded as a Salaries expense from this account, on its date.")
                                : t("مش هيتسجل حاجة في الحسابات — مناسب لو سجلتها هناك بإيدك قبل كده.", "Nothing goes to accounting — right if you already recorded it there by hand.")}
                        />
                    )}
                </div>
                <DialogFooter>
                    <Button onClick={save} disabled={saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{editing ? t("حفظ التعديل", "Save changes") : t("حفظ", "Save")}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function DetailsDialog({ row, period, businessId, editorEmail, ar, onClose, onChanged, onAdd, onEdit }: {
    row: Row; period: string; businessId: string; editorEmail: string | null; ar: boolean;
    onClose: () => void; onChanged: () => void; onAdd: (k: AdjustmentKind) => void; onEdit: (item: Adjustment) => void;
}) {
    const t = (a: string, e: string) => (ar ? a : e);
    const [name, setName] = useState(row.hasSalaryRow && row.name !== row.email.split("@")[0] ? row.name : "");
    const [title, setTitle] = useState(row.title || "");
    const [salary, setSalary] = useState(row.salary ? String(row.salary) : "");
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<Adjustment | null>(null);
    const [reopening, setReopening] = useState(false);
    const items = row.payslip ? row.payslip.items : row.items;

    const saveInfo = async () => {
        setSaving(true);
        const { error } = await supabase.from("employee_salaries").upsert({
            business_id: businessId,
            business_user_id: row.id,
            user_email: row.email,
            monthly_salary: parseFloat(salary) || 0,
            employee_name: name.trim() || null,
            job_title: title.trim() || null,
            updated_by: editorEmail,
            updated_at: new Date().toISOString(),
        }, { onConflict: "business_user_id" });
        setSaving(false);
        if (error) { console.error(error); toast.error(t("ماتحفظش", "Not saved")); return; }
        toast.success(t("اتحفظ", "Saved"));
        onChanged();
    };

    const remove = async (a: Adjustment, deleteTx: boolean) => {
        const { error } = await supabase.rpc("payroll_delete_adjustment", { p_id: a.id, p_delete_transaction: deleteTx });
        if (error) { toast.error(rpcError(error, t("ماتمسحش", "Not deleted"))); return; }
        setDeleting(null);
        onChanged();
    };

    const reopen = async (deleteTx: boolean) => {
        if (!row.payslip) return;
        const { error } = await supabase.rpc("payroll_reopen", { p_payslip_id: row.payslip.id, p_delete_transaction: deleteTx });
        if (error) { toast.error(rpcError(error, t("ماتفتحتش", "Could not reopen"))); return; }
        setReopening(false);
        toast.success(t("اتفتحت", "Reopened"));
        onChanged();
    };

    const toggle = async (it: Adjustment, on: boolean) => {
        setBusy(it.id!);
        if (await setApplies(it, on, ar)) onChanged();
        setBusy(null);
    };

    const a = row.attendance;
    return (
        <Dialog open onOpenChange={o => !o && onClose()}>
            <DialogContent dir={ar ? "rtl" : "ltr"} className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{row.name}</DialogTitle>
                    <DialogDescription dir="ltr" className={ar ? "text-right" : ""}>{row.email}</DialogDescription>
                </DialogHeader>

                {a.present === 0 ? (
                    <p className="rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">{t("مفيش تسجيل حضور الشهر ده للموظف ده.", "No clock-ins for this employee this month.")}</p>
                ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Mini label={t("أيام الشغل", "Workdays")} value={`${a.present}/${a.workdays}`} />
                        <Mini label={t("غياب", "Absent")} value={String(a.absent)} />
                        <Mini label={t("أيام تأخير", "Late days")} value={String(a.lateDays)} />
                        <Mini label={t("دقايق تأخير", "Late min")} value={String(a.lateMinutes)} />
                    </div>
                )}

                <div className="rounded-lg border">
                    <div className="flex items-center justify-between border-b px-3 py-2">
                        <span className="text-sm font-medium">{t(`حركات ${monthLabel(period, ar)}`, `${monthLabel(period, ar)} entries`)}</span>
                        {row.payslip
                            ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" />{t("اتسوّى — افتح التسوية عشان تعدّل", "Settled — reopen to edit")}</span>
                            : <div className="flex gap-1">
                                {ADJUSTMENT_KINDS.map(k => <Button key={k.key} size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onAdd(k.key)}>+ {ar ? k.ar : k.en}</Button>)}
                            </div>}
                    </div>
                    <div className="divide-y text-sm">
                        <div className="flex justify-between px-3 py-2"><span>{t("المرتب الأساسي", "Base salary")}</span><span className="font-medium">{formatCurrency(row.totals.base)}</span></div>
                        {items.map((it, i) => {
                            const k = kindInfo(it.kind);
                            const on = applies(it);
                            return (
                                <div key={it.id ?? i} className={cn("flex items-center justify-between gap-2 px-3 py-2", !on && "bg-muted/30")}>
                                    <div className="min-w-0">
                                        <div className={cn(!on && "text-muted-foreground")}>{ar ? k.ar : k.en}{it.reason && <span className="text-muted-foreground"> — {it.reason}</span>}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {it.entry_date}
                                            {it.transaction_id && t(" · متسجلة في الحسابات", " · in accounting")}
                                            {!on && t(" · مش هتتخصم الشهر ده", " · not deducted this month")}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span dir="ltr" className={cn("font-medium", !on ? "text-muted-foreground line-through" : k.sign > 0 ? "text-emerald-600" : "text-red-600")}>{k.sign > 0 ? "+" : "−"}{formatCurrency(it.amount)}</span>
                                        {!row.payslip && it.id && it.kind !== "bonus" && (
                                            <Switch checked={on} disabled={busy === it.id} onCheckedChange={v => toggle(it, v)} aria-label={t("يتخصم", "Deduct")} title={t("يتخصم من المرتب", "Deduct from pay")} />
                                        )}
                                        {!row.payslip && it.id && (
                                            <>
                                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(it)} aria-label={t("تعديل", "Edit")} title={t("تعديل", "Edit")}><Pencil className="h-3.5 w-3.5" /></Button>
                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => setDeleting(it)} aria-label={t("مسح", "Delete")} title={t("مسح", "Delete")}><Trash2 className="h-3.5 w-3.5" /></Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        <div className="flex justify-between bg-muted/40 px-3 py-2 font-bold"><span>{t("الصافي", "Net")}</span><span dir="ltr">{formatCurrency(row.totals.net)}</span></div>
                    </div>
                </div>

                {row.payslip && (
                    <div className="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
                        <span>{t(`اتصرف ${row.payslip.paid_on}`, `Paid ${row.payslip.paid_on}`)}{row.payslip.account_name && ` · ${row.payslip.account_name}`}</span>
                        <Button size="sm" variant="outline" onClick={() => setReopening(true)}><Unlock className="me-1 h-3.5 w-3.5" />{t("فتح التسوية", "Reopen")}</Button>
                    </div>
                )}

                <div className="space-y-3 rounded-lg border p-3">
                    <div className="text-sm font-medium">{t("بيانات القسيمة", "Payslip details")}</div>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1"><Label className="text-xs">{t("الاسم", "Name")}</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder={row.email.split("@")[0]} /></div>
                        <div className="space-y-1"><Label className="text-xs">{t("الوظيفة", "Job title")}</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
                        <div className="space-y-1"><Label className="text-xs">{t("المرتب الشهري", "Monthly salary")}</Label><Input type="number" inputMode="decimal" value={salary} onChange={e => setSalary(e.target.value)} /></div>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("تغيير المرتب بيأثر على الشهور اللي لسه ماتصرفتش بس.", "A salary change only affects months not paid yet.")}</p>
                    <Button size="sm" onClick={saveInfo} disabled={saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("حفظ البيانات", "Save details")}</Button>
                </div>

                {deleting && (
                    <ConfirmWithOption
                        ar={ar}
                        title={t(`تمسح ${kindInfo(deleting.kind).ar} ${formatCurrency(deleting.amount)}؟`, `Delete this ${kindInfo(deleting.kind).en.toLowerCase()} of ${formatCurrency(deleting.amount)}?`)}
                        body={t("هتتشال من مرتب الموظف.", "It comes off the employee's pay record.")}
                        option={deleting.transaction_id ? t("امسح المصروف اللي اتسجل ليها في الحسابات كمان", "Also delete the expense recorded for it in accounting") : null}
                        confirmLabel={t("مسح", "Delete")}
                        onCancel={() => setDeleting(null)}
                        onConfirm={opt => remove(deleting, opt)}
                    />
                )}
                {reopening && row.payslip && (
                    <ConfirmWithOption
                        ar={ar}
                        title={t("تفتح التسوية تاني؟", "Reopen this month?")}
                        body={t("القسيمة هتتلغي وتقدر تعدّل وتصرف من جديد.", "The payslip is cancelled so you can edit and pay again.")}
                        option={row.payslip.account_name ? t(`امسح مصروف المرتب اللي اتسجل في الحسابات (${row.payslip.account_name})`, `Also delete the salary expense recorded in accounting (${row.payslip.account_name})`) : null}
                        confirmLabel={t("فتح التسوية", "Reopen")}
                        onCancel={() => setReopening(false)}
                        onConfirm={opt => reopen(opt)}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function Mini({ label, value }: { label: string; value: string }) {
    return <div className="rounded-md border p-2 text-center"><div className="text-[11px] text-muted-foreground">{label}</div><div className="font-semibold">{value}</div></div>;
}

function SettleDialog({ rows, period, accounts, ar, onClose, onDone, onChanged }: {
    rows: Row[]; period: string; accounts: string[]; ar: boolean; onClose: () => void; onDone: () => void; onChanged: () => void;
}) {
    const t = (a: string, e: string) => (ar ? a : e);
    const [book, setBook] = useState(false);
    const [account, setAccount] = useState<string>("");
    const [carry, setCarry] = useState(true);
    const [busyItem, setBusyItem] = useState<string | null>(null);
    const [paidOn, setPaidOn] = useState(today());
    const [notes, setNotes] = useState("");
    const [saving, setSaving] = useState(false);
    const single = rows.length === 1 ? rows[0] : null;
    const total = useMemo(() => rows.reduce((s, r) => s + Math.max(0, r.totals.net), 0), [rows]);

    const owing = rows.filter(r => r.totals.net < 0);

    const settle = async () => {
        if (book && !account) { toast.error(t("اختار الحساب اللي اتصرف منه", "Pick the account it was paid from")); return; }
        setSaving(true);
        let ok = 0;
        for (const r of rows) {
            const { error } = await supabase.rpc("payroll_settle", {
                p_business_user_id: r.id,
                p_period: periodDate(period),
                p_paid_on: paidOn,
                p_account_name: book ? account : null,
                p_notes: single ? notes : "",
                p_carry_over: carry,
            });
            if (error) { console.error(error); toast.error(`${r.name}: ${rpcError(error, t("ماتصرفش", "not paid"))}`); }
            else ok++;
        }
        setSaving(false);
        if (ok) toast.success(t(`اتصرف ${ok} مرتب`, `${ok} paid`));
        onDone();
    };

    return (
        <Dialog open onOpenChange={o => !o && !saving && onClose()}>
            <DialogContent dir={ar ? "rtl" : "ltr"} className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{single ? t(`صرف مرتب ${single.name}`, `Pay ${single.name}`) : t(`صرف ${rows.length} مرتبات`, `Pay ${rows.length} salaries`)}</DialogTitle>
                    <DialogDescription>{monthLabel(period, ar)}</DialogDescription>
                </DialogHeader>
                {single ? (
                    <div className="space-y-1 rounded-lg border p-3 text-sm">
                        <Line label={t("الأساسي", "Base")} value={formatCurrency(single.totals.base)} />
                        {single.totals.bonuses > 0 && <Line label={t("بونص", "Bonuses")} value={`+ ${formatCurrency(single.totals.bonuses)}`} />}
                        {single.totals.deductions > 0 && <Line label={t("خصومات", "Deductions")} value={`− ${formatCurrency(single.totals.deductions)}`} />}
                        {single.totals.advances > 0 && <Line label={t("سلف", "Advances")} value={`− ${formatCurrency(single.totals.advances)}`} />}
                        <div className="border-t pt-1"><Line label={t("الصافي", "Net")} value={formatCurrency(single.totals.net)} bold /></div>
                    </div>
                ) : null}
                {single && single.items.some(i => i.kind !== "bonus") && (
                    <div className="rounded-lg border text-sm">
                        <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">{t("تتخصم الشهر ده؟", "Deduct this month?")}</div>
                        <div className="divide-y">
                            {single.items.filter(i => i.kind !== "bonus").map(it => (
                                <label key={it.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                                    <span className={cn(!applies(it) && "text-muted-foreground")}>
                                        {kindInfo(it.kind)[ar ? "ar" : "en"]}{it.reason && ` — ${it.reason}`} <span dir="ltr" className="text-xs">({formatCurrency(it.amount)})</span>
                                    </span>
                                    <Switch checked={applies(it)} disabled={busyItem === it.id}
                                        onCheckedChange={async v => { setBusyItem(it.id!); if (await setApplies(it, v, ar)) onChanged(); setBusyItem(null); }} />
                                </label>
                            ))}
                        </div>
                    </div>
                )}
                {single ? null : (
                    <div className="max-h-48 divide-y overflow-y-auto rounded-lg border text-sm">
                        {rows.map(r => <div key={r.id} className="flex justify-between px-3 py-1.5"><span>{r.name}</span><span className="font-medium">{formatCurrency(r.totals.net)}</span></div>)}
                        <div className="flex justify-between bg-muted/40 px-3 py-1.5 font-bold"><span>{t("الإجمالي", "Total")}</span><span>{formatCurrency(total)}</span></div>
                    </div>
                )}
                {owing.length > 0 && (
                    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                        <div className="flex gap-2">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            {t(`السلف أكبر من المرتب${single ? "" : ` عند ${owing.map(r => r.name).join("، ")}`}: مش هيتصرف حاجة.`, `Advances exceed the pay${single ? "" : ` for ${owing.map(r => r.name).join(", ")}`}: nothing is paid.`)}
                        </div>
                        <label className="flex items-center justify-between gap-3 text-sm">
                            <span>{t("رحّل الباقي يتخصم من مرتب الشهر الجاي", "Carry the rest into next month's pay")}{single && <span dir="ltr"> ({formatCurrency(-single.totals.net)})</span>}</span>
                            <Switch checked={carry} onCheckedChange={setCarry} />
                        </label>
                    </div>
                )}
                <div className="space-y-1.5">
                    <Label>{t("تاريخ الصرف", "Paid on")}</Label>
                    <Input type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} />
                </div>
                <AccountingChoice
                    on={book} onToggle={setBook} account={account} onAccount={setAccount} accounts={accounts} ar={ar}
                    label={t("سجّل الصافي مصروف في الحسابات", "Record the net as an expense in accounting")}
                    hint={book
                        ? t("هيتسجل الصافي مصروف Salaries من الحساب ده بتاريخ الصرف.", "The net is recorded as a Salaries expense from this account on the pay date.")
                        : t("القسيمة هتتقفل من غير ما يتسجل أي حاجة في الحسابات.", "The payslip is closed without anything recorded in accounting.")}
                />
                {single && <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("ملاحظات على القسيمة (اختياري)", "Notes on the payslip (optional)")} rows={2} />}
                <p className="text-xs text-muted-foreground">{t("بعد الصرف الشهر بيتقفل، وتقدر تفتحه تاني من تفاصيل الموظف.", "After paying, the month is closed; reopen it from the employee's details.")}</p>
                <DialogFooter>
                    <Button onClick={settle} disabled={saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("تأكيد الصرف", "Confirm payment")}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
    return <div className={cn("flex justify-between", bold && "font-bold")}><span>{label}</span><span dir="ltr">{value}</span></div>;
}
