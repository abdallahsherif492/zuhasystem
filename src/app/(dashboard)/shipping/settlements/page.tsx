"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Lock, Truck, Upload } from "lucide-react";
import { fetchAll, supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { cn } from "@/lib/utils";
import { cairoDayStart } from "@/lib/cairo-day";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { parseStatement, statementBounds, type StatementRow } from "@/lib/shipping/statement";

/**
 * Courier accounts (20261115_courier_account_settlement.sql).
 *
 * What each courier owes us, counted from its latest settlement: a statement
 * the courier sent ("on this date we owed you X") or a closing ("we are
 * square"). After it: what is due on orders it did not cover, less the
 * collections booked since. Upload the courier's statement here to settle by
 * it; close an account that is square.
 */

const MIGRATION = "supabase/migrations/20261115_courier_account_settlement.sql";

interface Company { id: string; name: string }
interface Balance { shipping_company_id: string | null; company_name: string | null; due_total: number; received_total: number; outstanding: number }
interface Settlement {
    id: string; shipping_company_id: string | null; kind: string; as_of: string | null; closing_balance: number | null;
    order_count: number; source_file: string | null; created_by: string | null; created_at: string; notes: string | null;
    totals: { lines?: number; deliveries?: number; fees?: number; cash?: number; matched?: number; unknown_refs?: number } | null;
}

const egp = (v: number) => `⁦${Math.round(v) < 0 ? "−" : ""}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.abs(Math.round(v)))}⁩ ج.م`;
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("ar-EG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" });
/** "yyyy-MM-dd HH:mm:ss" in Cairo time, as an instant. */
const cairoInstant = (s: string) => {
    const [d, t = "00:00:00"] = s.split(" ");
    const [h, m, sec] = t.split(":").map(Number);
    return new Date(Date.parse(cairoDayStart(d)) + ((h || 0) * 3600 + (m || 0) * 60 + (sec || 0)) * 1000).toISOString();
};

export default function CourierAccountsPage() {
    const { activeBusiness, currentUser } = useBusiness();
    const businessId = activeBusiness?.id;
    const [companies, setCompanies] = useState<Company[]>([]);
    const [balances, setBalances] = useState<Balance[]>([]);
    const [history, setHistory] = useState<Settlement[]>([]);
    const [missing, setMissing] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [tab, setTab] = useState("accounts");
    const [importFor, setImportFor] = useState("");
    const [reload, setReload] = useState(0);

    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        Promise.all([
            supabase.from("shipping_companies").select("id, name").eq("business_id", businessId).order("name"),
            supabase.rpc("get_courier_collection_match", { p_business_id: businessId, p_from: "2000-01-01T00:00:00Z", p_to: new Date().toISOString() }),
            supabase.from("shipping_settlements").select("id, shipping_company_id, kind, as_of, closing_balance, order_count, source_file, created_by, created_at, notes, totals")
                .eq("business_id", businessId).order("created_at", { ascending: false }).limit(100),
        ]).then(([c, b, h]) => {
            if (gone) return;
            setCompanies((c.data || []) as Company[]);
            setBalances(((b.data || []) as Balance[]).map(x => ({ ...x, due_total: Number(x.due_total) || 0, received_total: Number(x.received_total) || 0, outstanding: Number(x.outstanding) || 0 })));
            setMissing(!!h.error);
            setHistory(h.error ? [] : (h.data || []) as Settlement[]);
            setLoaded(true);
        });
        return () => { gone = true; };
    }, [businessId, reload]);

    const latest = useMemo(() => {
        const m = new Map<string, Settlement>();
        for (const s of history) {
            if (!s.shipping_company_id || s.closing_balance === null || !s.as_of) continue;
            const cur = m.get(s.shipping_company_id);
            if (!cur || Date.parse(s.as_of) > Date.parse(cur.as_of!)) m.set(s.shipping_company_id, s);
        }
        return m;
    }, [history]);

    const closeAccount = async (company: Company) => {
        if (!businessId) return;
        const { error } = await supabase.rpc("settle_courier_account", {
            p_business_id: businessId, p_shipping_company_id: company.id, p_kind: "closing",
            p_as_of: new Date().toISOString(), p_closing_balance: 0, p_notes: "الحساب متسوّي",
        });
        if (error) { toast.error(/settle_courier_account|schema cache/i.test(error.message) ? `شغّل ${MIGRATION} الأول.` : error.message); return; }
        logBusinessAction({ businessId, userEmail: currentUser?.email || "Staff", actionType: "edit", entityType: "shipping", entityId: company.id, entityName: `قفل حساب ${company.name}`, changes: [{ field: "Balance", old_value: null, new_value: "0 (متسوّي)" }] });
        toast.success(`حساب ${company.name} اتقفل على صفر.`);
        setReload(n => n + 1);
    };

    const undo = async (s: Settlement) => {
        const { error } = await supabase.rpc("undo_courier_settlement", { p_settlement_id: s.id });
        if (error) { toast.error(error.message); return; }
        toast.success("التسوية اتلغت.");
        setReload(n => n + 1);
    };

    if (!loaded) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

    const byId = new Map(balances.filter(b => b.shipping_company_id).map(b => [b.shipping_company_id!, b]));
    const total = companies.reduce((s, c) => s + Math.max(0, byId.get(c.id)?.outstanding || 0), 0);

    return (
        <div className="mx-auto max-w-6xl space-y-6" dir="rtl">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">تسوية حسابات الشحن</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        كل شركة شحن عليها كام لينا، محسوب من آخر تسوية. سجّل التسوية بكشف الحساب اللي الشركة بتبعته، أو اقفل الحساب لو متسوّي.
                    </p>
                </div>
                <Button asChild variant="outline"><Link href="/shipping/statement">مطابقة كشف بالتفصيل</Link></Button>
            </div>

            {missing && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    شغّل <code className="font-mono">{MIGRATION}</code> في Supabase الأول.
                </div>
            )}

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                    <TabsTrigger value="accounts">الأرصدة</TabsTrigger>
                    <TabsTrigger value="import">ارفع كشف حساب</TabsTrigger>
                    <TabsTrigger value="history">السجل</TabsTrigger>
                </TabsList>

                <TabsContent value="accounts" className="space-y-4 pt-4">
                    <div className="rounded-2xl border bg-card p-5">
                        <p className="text-sm text-muted-foreground">إجمالي اللي لينا عند شركات الشحن</p>
                        <p className="mt-1 text-4xl font-bold tabular-nums">{egp(total)}</p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {companies.map(c => {
                            const b = byId.get(c.id);
                            const s = latest.get(c.id);
                            const owed = b?.outstanding || 0;
                            const sinceDue = s && b ? b.due_total - Number(s.closing_balance) : null;
                            return (
                                <section key={c.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <h2 className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4 text-muted-foreground" />{c.name}</h2>
                                        {s ? (
                                            <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                                                <CheckCircle2 className="h-3 w-3" />{s.kind === "closing" ? "اتقفل" : "اتسوّى بكشف"}
                                            </span>
                                        ) : (
                                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">متسوّاش قبل كده</span>
                                        )}
                                    </div>
                                    <div>
                                        <p className={cn("text-2xl font-bold tabular-nums", owed < 0 && "text-rose-700 dark:text-rose-400")}>{egp(owed)}</p>
                                        <p className="text-xs text-muted-foreground">{owed >= 0 ? "ليك عندهم" : "زيادة اتسجلت كتحصيل عن المستحق"}</p>
                                    </div>
                                    {s ? (
                                        <ul className="space-y-1 text-xs text-muted-foreground">
                                            <li className="flex justify-between gap-2"><span>رصيد آخر تسوية ({fmtWhen(s.as_of!)})</span><span className="tabular-nums text-foreground">{egp(Number(s.closing_balance))}</span></li>
                                            <li className="flex justify-between gap-2"><span>+ مستحق أوردرات خلصت بعدها</span><span className="tabular-nums text-foreground">{egp(sinceDue || 0)}</span></li>
                                            <li className="flex justify-between gap-2"><span>− تحصيل اتسجل بعدها</span><span className="tabular-nums text-foreground">{egp(b?.received_total || 0)}</span></li>
                                        </ul>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">محسوب من أول أوردر: كل المستحق ناقص كل التحصيل اللي اتسجل. غالبًا مش دقيق لحد ما يتسوّى.</p>
                                    )}
                                    <div className="mt-auto flex flex-wrap gap-2 pt-1">
                                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setImportFor(c.id); setTab("import"); }}>
                                            <Upload className="h-3.5 w-3.5" />ارفع كشف حساب
                                        </Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button size="sm" variant="ghost" className="gap-1.5"><Lock className="h-3.5 w-3.5" />اقفل الحساب</Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent dir="rtl">
                                                <AlertDialogHeader className="text-start">
                                                    <AlertDialogTitle>تقفل حساب {c.name} على صفر؟</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        يعني الحساب معاهم متسوّي النهارده: مش ليك ولا عليك. كل الأوردرات اللي خلصت (اتسلمت أو رجعت) لحد دلوقتي هتتحسب متسوية،
                                                        والرصيد يبدأ من الصفر بالأوردرات الجديدة والتحصيل الجديد. الرصيد دلوقتي في السيستم {egp(owed)}.
                                                        لو غلط، تقدر تلغيها من السجل.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>رجوع</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => closeAccount(c)}>اقفل على صفر</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                </TabsContent>

                <TabsContent value="import" className="pt-4">
                    <ImportStatement key={importFor} businessId={businessId!} companies={companies} preset={importFor}
                        onDone={() => { setReload(n => n + 1); setTab("accounts"); }} userEmail={currentUser?.email || "Staff"} />
                </TabsContent>

                <TabsContent value="history" className="space-y-3 pt-4">
                    {history.filter(h => h.closing_balance !== null).length === 0 ? (
                        <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">مفيش تسويات لسه.</p>
                    ) : (
                        <div className="overflow-x-auto rounded-xl border">
                            <table className="w-full min-w-[640px] text-sm">
                                <thead className="bg-muted/50 text-xs text-muted-foreground">
                                    <tr>
                                        <th className="p-3 text-start font-medium">الشركة</th>
                                        <th className="p-3 text-start font-medium">النوع</th>
                                        <th className="p-3 text-start font-medium">لحد</th>
                                        <th className="p-3 text-start font-medium">الرصيد وقتها</th>
                                        <th className="p-3 text-start font-medium">أوردرات اتسوّت</th>
                                        <th className="p-3 text-start font-medium">مين</th>
                                        <th className="w-16" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {history.filter(h => h.closing_balance !== null).map(h => {
                                        const isLatest = h.shipping_company_id && latest.get(h.shipping_company_id)?.id === h.id;
                                        return (
                                            <tr key={h.id}>
                                                <td className="p-3 font-medium">{companies.find(c => c.id === h.shipping_company_id)?.name || "—"}</td>
                                                <td className="p-3">{h.kind === "closing" ? "قفل حساب" : <span className="flex items-center gap-1"><FileSpreadsheet className="h-3.5 w-3.5" />{h.source_file || "كشف حساب"}</span>}</td>
                                                <td className="p-3 whitespace-nowrap">{h.as_of ? fmtWhen(h.as_of) : "—"}</td>
                                                <td className="p-3 tabular-nums">{egp(Number(h.closing_balance))}</td>
                                                <td className="p-3 tabular-nums">{h.order_count}</td>
                                                <td className="p-3 text-xs text-muted-foreground">{h.created_by}</td>
                                                <td className="p-3">
                                                    {isLatest && (
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild><Button size="sm" variant="ghost" className="text-destructive">الغي</Button></AlertDialogTrigger>
                                                            <AlertDialogContent dir="rtl">
                                                                <AlertDialogHeader className="text-start">
                                                                    <AlertDialogTitle>تلغي التسوية دي؟</AlertDialogTitle>
                                                                    <AlertDialogDescription>الأوردرات اللي غطتها هترجع مش متسوية، والرصيد يرجع يتحسب من التسوية اللي قبلها.</AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>رجوع</AlertDialogCancel>
                                                                    <AlertDialogAction onClick={() => undo(h)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">الغي التسوية</AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Settle by the courier's statement
// ---------------------------------------------------------------------------

function ImportStatement({ businessId, companies, preset, onDone, userEmail }: {
    businessId: string; companies: Company[]; preset: string; onDone: () => void; userEmail: string;
}) {
    const [companyId, setCompanyId] = useState(preset);
    const [fileName, setFileName] = useState("");
    const [rows, setRows] = useState<StatementRow[] | null>(null);
    const [bounds, setBounds] = useState<{ closing: number | null; firstAt: string | null; lastAt: string | null } | null>(null);
    const [error, setError] = useState("");
    const [loadedOrders, setLoadedOrders] = useState<{ companyId: string; orders: { id: string }[] } | null>(null);
    const orders = loadedOrders && loadedOrders.companyId === companyId ? loadedOrders.orders : null;
    const [closing, setClosing] = useState("");
    const [asOf, setAsOf] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!companyId) return;
        let gone = false;
        fetchAll<{ id: string }>((a, b) => supabase.from("orders").select("id").eq("business_id", businessId).eq("shipping_company_id", companyId).range(a, b))
            .then(d => { if (!gone) setLoadedOrders({ companyId, orders: d }); });
        return () => { gone = true; };
    }, [businessId, companyId]);

    const onFile = useCallback(async (file: File) => {
        setError(""); setRows(null); setBounds(null); setFileName(file.name);
        try {
            const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
            const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true }) as unknown[][];
            const { rows: parsed, error: e } = parseStatement(grid as never);
            if (e) { setError(e); return; }
            if (!parsed.length) { setError("الملف مفيهوش حركات."); return; }
            const b = statementBounds(grid as never);
            setRows(parsed);
            setBounds(b);
            setClosing(b.closing !== null ? String(Math.round(b.closing * 100) / 100) : "");
            setAsOf(b.lastAt ? b.lastAt.slice(0, 16).replace(" ", "T") : "");
        } catch (e) {
            setError((e as Error).message || "مش قادر أقرا الملف.");
        }
    }, []);

    const summary = useMemo(() => {
        if (!rows) return null;
        const byPrefix = new Map((orders || []).map(o => [o.id.slice(0, 8), o.id]));
        const refs = new Set(rows.filter(r => r.reference).map(r => r.reference!));
        const matched = [...refs].map(r => byPrefix.get(r)).filter(Boolean) as string[];
        const sum = (k: StatementRow["movement"]) => rows.filter(r => r.movement === k).reduce((s, r) => s + r.net, 0);
        const count = (k: StatementRow["movement"]) => rows.filter(r => r.movement === k).length;
        return {
            lines: rows.length,
            deliveries: sum("delivery"), deliveriesN: count("delivery"),
            fees: -sum("order_fee"), feesN: count("order_fee"),
            cash: -sum("cash"), cashN: count("cash"),
            other: sum("other"),
            refs: refs.size, matched,
            unknown: refs.size - matched.length,
            movement: rows.reduce((s, r) => s + r.net, 0),
        };
    }, [rows, orders]);

    const company = companies.find(c => c.id === companyId);
    const closingNum = Number(closing);
    const ready = !!company && !!summary && closing !== "" && Number.isFinite(closingNum) && !!asOf && orders !== null;

    const save = async () => {
        if (!ready || !summary || !bounds) return;
        setSaving(true);
        const asOfIso = cairoInstant(asOf.replace("T", " ") + ":00");
        const { error: e } = await supabase.rpc("settle_courier_account", {
            p_business_id: businessId,
            p_shipping_company_id: companyId,
            p_kind: "statement",
            p_as_of: asOfIso,
            p_closing_balance: closingNum,
            p_order_ids: summary.matched,
            p_covers_before: bounds.firstAt ? cairoInstant(bounds.firstAt) : asOfIso,
            p_source_file: fileName,
            p_totals: {
                lines: summary.lines, deliveries: summary.deliveries, fees: summary.fees, cash: summary.cash,
                matched: summary.matched.length, unknown_refs: summary.unknown, first_at: bounds.firstAt, last_at: bounds.lastAt,
            },
        });
        setSaving(false);
        if (e) { toast.error(/settle_courier_account|schema cache/i.test(e.message) ? `شغّل ${MIGRATION} الأول.` : e.message); return; }
        logBusinessAction({ businessId, userEmail, actionType: "edit", entityType: "shipping", entityId: companyId, entityName: `تسوية ${company!.name} بكشف حساب`, changes: [{ field: "Balance", old_value: null, new_value: `${closingNum} EGP حتى ${asOf}` }, { field: "File", old_value: null, new_value: fileName }] });
        toast.success(`اتسجلت تسوية ${company!.name}: ${egp(closingNum)}.`);
        setRows(null); setFileName("");
        onDone();
    };

    return (
        <div className="space-y-4">
            <div className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label>شركة الشحن</Label>
                    <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={companyId} onChange={e => setCompanyId(e.target.value)}>
                        <option value="">اختار شركة</option>
                        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                <div className="space-y-1.5">
                    <Label>كشف الحساب (Excel)</Label>
                    <label className={cn("flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted/50", !companyId && "pointer-events-none opacity-50")}>
                        <Upload className="h-4 w-4" /><span className="truncate">{fileName || "اختار ملف..."}</span>
                        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={!companyId} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
                    </label>
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                    كشف الحساب اللي الشركة بتبعته: كل حركة برقم الأوردر في الوصف، والمدين والدائن، والرصيد. السيستم بيقرا الرصيد الختامي وتاريخ آخر حركة لوحده.
                </p>
            </div>

            {error && <p className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"><AlertTriangle className="h-4 w-4" />{error}</p>}

            {summary && bounds && (
                <div className="space-y-4 rounded-xl border bg-card p-5">
                    <h3 className="font-semibold">الكشف من {bounds.firstAt?.slice(0, 16) || "—"} لحد {bounds.lastAt?.slice(0, 16) || "—"}</h3>
                    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
                        <Cell label={`تسليمات (${summary.deliveriesN})`} value={egp(summary.deliveries)} />
                        <Cell label={`رسوم مرتجع وغيره (${summary.feesN})`} value={egp(-summary.fees)} />
                        <Cell label={`تحويلات ليك (${summary.cashN})`} value={egp(-summary.cash)} />
                        <Cell label="أوردرات اتعرفت" value={`${summary.matched.length} من ${summary.refs}`} hint={summary.unknown ? `${summary.unknown} مش متسجلين على ${company?.name}` : undefined} />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="st-close">الرصيد الختامي (ليك عندهم)</Label>
                            <div className="relative">
                                <Input id="st-close" type="number" step="0.01" value={closing} onChange={e => setClosing(e.target.value)} className="pe-12 text-lg font-semibold" />
                                <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground">ج.م</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{bounds.closing !== null ? "اتقرا من الكشف. سالب يعني إنت اللي عليك." : "مالقيتش رصيد ختامي في الملف، اكتبه."}</p>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="st-asof">لحد إمتى</Label>
                            <Input id="st-asof" type="datetime-local" value={asOf} onChange={e => setAsOf(e.target.value)} />
                            <p className="text-xs text-muted-foreground">وقت آخر حركة في الكشف. التحصيل اللي هتسجله بعد اليوم ده بيتخصم من الرصيد.</p>
                        </div>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3 text-sm">
                        بعد التسوية، رصيد {company?.name} هيبقى <span className="font-semibold tabular-nums">{egp(closingNum || 0)}</span>
                        {" "}+ مستحق الأوردرات اللي خلصت ومش في الكشف − التحصيل اللي اتسجل بعد {asOf.slice(0, 10)}.
                        هيتسوّى {summary.matched.length} أوردر من الكشف، وكل أوردرات {company?.name} اللي خلصت قبل {bounds.firstAt?.slice(0, 10)}.
                    </div>
                    <div className="flex justify-end">
                        <Button onClick={save} disabled={!ready || saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}سجّل التسوية</Button>
                    </div>
                </div>
            )}
        </div>
    );
}

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 font-semibold tabular-nums">{value}</p>
            {hint && <p className="text-[11px] text-amber-700 dark:text-amber-400">{hint}</p>}
        </div>
    );
}
