"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { formatCurrency, cn } from "@/lib/utils";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, Wallet, Truck, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface Outstanding {
    shipping_company_id: string;
    company_name: string;
    order_count: number;
    collected_total: number;
    expected_total: number;
    oldest_order_at: string;
}

interface PayoutOrder {
    order_id: string;
    status: string;
    created_at: string;
    customer_info: any;
    total_amount: number;
    paid_amount: number;
    actual_shipping_cost: number;
    collected_amount: number;
    expected_payout: number;
}

interface Settlement {
    id: string;
    settlement_date: string;
    reference: string | null;
    expected_amount: number;
    received_amount: number;
    difference: number;
    order_count: number;
    account_name: string | null;
    notes: string | null;
    shipping_company_id: string | null;
}

const AGE_BUCKETS = ["0-7", "8-15", "16-30", "30+"];

export default function CourierSettlementsPage() {
    const { activeBusiness, currentUser } = useBusiness();

    const [loading, setLoading] = useState(true);
    const [outstanding, setOutstanding] = useState<Outstanding[]>([]);
    const [aging, setAging] = useState<any[]>([]);
    const [settlements, setSettlements] = useState<Settlement[]>([]);
    const [companies, setCompanies] = useState<any[]>([]);
    const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
    const [setupError, setSetupError] = useState<string | null>(null);

    // New-settlement form
    const [selectedCompany, setSelectedCompany] = useState<string>("");
    const [orders, setOrders] = useState<PayoutOrder[]>([]);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [receivedAmount, setReceivedAmount] = useState<string>("");
    const [reference, setReference] = useState("");
    const [account, setAccount] = useState("");
    const [settlementDate, setSettlementDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const [saving, setSaving] = useState(false);

    const loadSummary = useCallback(async () => {
        if (!activeBusiness) return;
        setLoading(true);

        const [out, age, hist, comps, accs] = await Promise.all([
            supabase.rpc("get_courier_outstanding", { p_business_id: activeBusiness.id }),
            supabase.rpc("get_courier_aging", { p_business_id: activeBusiness.id }),
            supabase.from("shipping_settlements").select("*")
                .eq("business_id", activeBusiness.id)
                .order("settlement_date", { ascending: false }).limit(100),
            supabase.from("shipping_companies").select("id, name")
                .eq("business_id", activeBusiness.id).order("name"),
            supabase.from("financial_accounts").select("id, name")
                .eq("business_id", activeBusiness.id).order("name"),
        ]);

        if (out.error && /get_courier_outstanding|PGRST202/i.test(out.error.message)) {
            setSetupError("جدول التسويات لسه متعملش. شغّل supabase/migrations/20260730_cod_settlements.sql");
        } else {
            setSetupError(null);
            setOutstanding((out.data || []) as Outstanding[]);
        }
        if (!age.error) setAging(age.data || []);
        if (!hist.error) setSettlements((hist.data || []) as Settlement[]);
        if (!comps.error) setCompanies(comps.data || []);
        if (!accs.error) setAccounts(accs.data || []);
        setLoading(false);
    }, [activeBusiness]);

    useEffect(() => { loadSummary(); }, [loadSummary]);

    // Unsettled orders for the chosen courier.
    useEffect(() => {
        const run = async () => {
            if (!activeBusiness || !selectedCompany) { setOrders([]); return; }
            setOrdersLoading(true);
            const { data, error } = await supabase
                .from("v_courier_payouts")
                .select("order_id, status, created_at, customer_info, total_amount, paid_amount, actual_shipping_cost, collected_amount, expected_payout")
                .eq("business_id", activeBusiness.id)
                .eq("shipping_company_id", selectedCompany)
                .is("settlement_id", null)
                .order("created_at", { ascending: true });
            if (!error) setOrders((data || []) as PayoutOrder[]);
            setPicked(new Set());
            setOrdersLoading(false);
        };
        run();
    }, [activeBusiness, selectedCompany]);

    const expectedPicked = useMemo(
        () => orders.filter(o => picked.has(o.order_id)).reduce((s, o) => s + Number(o.expected_payout || 0), 0),
        [orders, picked]
    );

    const gap = useMemo(() => {
        if (receivedAmount === "") return null;
        return Number(receivedAmount) - expectedPicked;
    }, [receivedAmount, expectedPicked]);

    const companyName = (id: string | null) =>
        companies.find(c => c.id === id)?.name || "—";

    const toggle = (id: string) =>
        setPicked(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });

    const submit = async () => {
        if (!activeBusiness || picked.size === 0) return;
        setSaving(true);
        try {
            const { data, error } = await supabase.rpc("record_courier_settlement", {
                p_business_id: activeBusiness.id,
                p_shipping_company_id: selectedCompany,
                p_order_ids: Array.from(picked),
                p_received_amount: Number(receivedAmount || 0),
                p_settlement_date: settlementDate,
                p_reference: reference || null,
                p_account_name: account || null,
                p_notes: null,
            });
            if (error) throw error;

            logBusinessAction({
                businessId: activeBusiness.id,
                userEmail: currentUser?.email || "Staff",
                actionType: "create",
                entityType: "order",
                entityId: String(data),
                entityName: `تسوية ${companyName(selectedCompany)} — ${picked.size} أوردر`,
                changes: [
                    { field: "المتوقع", old_value: null, new_value: `${expectedPicked.toFixed(2)} EGP` },
                    { field: "المستلم", old_value: null, new_value: `${Number(receivedAmount || 0).toFixed(2)} EGP` },
                ],
            });

            toast.success("تم تسجيل التسوية");
            setReceivedAmount(""); setReference(""); setPicked(new Set());

            // Refresh both the cards and the remaining unsettled list for this
            // courier — the orders just covered must drop out of the picker.
            await loadSummary();
            const { data: fresh } = await supabase
                .from("v_courier_payouts")
                .select("order_id, status, created_at, customer_info, total_amount, paid_amount, actual_shipping_cost, collected_amount, expected_payout")
                .eq("business_id", activeBusiness.id)
                .eq("shipping_company_id", selectedCompany)
                .is("settlement_id", null)
                .order("created_at", { ascending: true });
            setOrders((fresh || []) as PayoutOrder[]);
        } catch (e: any) {
            toast.error(e?.message || "فشل تسجيل التسوية");
        } finally {
            setSaving(false);
        }
    };

    const grandOutstanding = outstanding.reduce((s, o) => s + Number(o.expected_total || 0), 0);

    if (loading) {
        return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">تسوية حسابات الشحن</h1>
                    <p className="text-muted-foreground">
                        فلوسك المعلقة عند شركات الشحن، ومطابقة التحويلات اللي بتوصلك بالمتوقع.
                    </p>
                </div>
                <Link href="/shipping">
                    <Button variant="outline"><ArrowLeft className="h-4 w-4 me-2" /> الشحن</Button>
                </Link>
            </div>

            {setupError && (
                <Card className="border-amber-400 bg-amber-50 dark:bg-amber-950/30">
                    <CardContent className="pt-6 flex items-start gap-3 text-sm text-amber-900 dark:text-amber-200">
                        <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                        <span>{setupError}</span>
                    </CardContent>
                </Card>
            )}

            <Tabs defaultValue="outstanding">
                <TabsList>
                    <TabsTrigger value="outstanding">المعلّق</TabsTrigger>
                    <TabsTrigger value="new">تسجيل تحويل</TabsTrigger>
                    <TabsTrigger value="history">السجل</TabsTrigger>
                    <TabsTrigger value="aging">التقادم</TabsTrigger>
                </TabsList>

                {/* ---------------- Outstanding ---------------- */}
                <TabsContent value="outstanding" className="space-y-4 pt-4">
                    <Card className="border-primary/30">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
                                إجمالي المعلّق عند كل الشركات
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-4xl font-bold text-primary">{formatCurrency(grandOutstanding)}</div>
                        </CardContent>
                    </Card>

                    {outstanding.length === 0 ? (
                        <Card><CardContent className="py-12 text-center text-muted-foreground">
                            مفيش فلوس معلقة عند أي شركة شحن.
                        </CardContent></Card>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {outstanding.map(o => (
                                <Card key={o.shipping_company_id}>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="flex items-center gap-2 text-lg">
                                            <Truck className="h-4 w-4 text-primary" /> {o.company_name}
                                        </CardTitle>
                                        <CardDescription>{o.order_count} أوردر لسه متسويش</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-1">
                                        <div className="text-2xl font-bold">{formatCurrency(Number(o.expected_total))}</div>
                                        <p className="text-xs text-muted-foreground">
                                            محصّل {formatCurrency(Number(o.collected_total))} — الباقي بعد خصم الشحن والرسوم
                                        </p>
                                        {o.oldest_order_at && (
                                            <p className="text-xs text-amber-600 flex items-center gap-1 pt-1">
                                                <Clock className="h-3 w-3" />
                                                أقدم أوردر: {format(new Date(o.oldest_order_at), "yyyy-MM-dd")}
                                            </p>
                                        )}
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* ---------------- New settlement ---------------- */}
                <TabsContent value="new" className="space-y-4 pt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>تسجيل تحويل من شركة شحن</CardTitle>
                            <CardDescription>
                                اختار الشركة، علّم على الأوردرات اللي التحويل بيغطيها، واكتب المبلغ اللي وصلك فعلاً.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-4">
                                <div className="space-y-2">
                                    <Label>شركة الشحن</Label>
                                    <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                                        <SelectTrigger><SelectValue placeholder="اختار" /></SelectTrigger>
                                        <SelectContent>
                                            {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>تاريخ التحويل</Label>
                                    <Input type="date" value={settlementDate} onChange={e => setSettlementDate(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>رقم مرجعي</Label>
                                    <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="اختياري" />
                                </div>
                                <div className="space-y-2">
                                    <Label>الخزنة</Label>
                                    <Select value={account} onValueChange={setAccount}>
                                        <SelectTrigger><SelectValue placeholder="اختار" /></SelectTrigger>
                                        <SelectContent>
                                            {accounts.map(a => <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {!selectedCompany ? (
                                <p className="text-sm text-muted-foreground py-8 text-center">اختار شركة شحن الأول.</p>
                            ) : ordersLoading ? (
                                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                            ) : orders.length === 0 ? (
                                <p className="text-sm text-muted-foreground py-8 text-center">مفيش أوردرات معلقة عند الشركة دي.</p>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between">
                                        <Button variant="outline" size="sm" onClick={() =>
                                            setPicked(picked.size === orders.length ? new Set() : new Set(orders.map(o => o.order_id)))
                                        }>
                                            {picked.size === orders.length ? "إلغاء تحديد الكل" : "تحديد الكل"}
                                        </Button>
                                        <span className="text-sm text-muted-foreground">{picked.size} من {orders.length} محدد</span>
                                    </div>

                                    <div className="rounded-md border max-h-[420px] overflow-y-auto">
                                        <Table>
                                            <TableHeader className="sticky top-0 bg-background z-10">
                                                <TableRow>
                                                    <TableHead className="w-[40px]"></TableHead>
                                                    <TableHead>العميل</TableHead>
                                                    <TableHead>الحالة</TableHead>
                                                    <TableHead className="text-end">محصّل</TableHead>
                                                    <TableHead className="text-end">الشحن</TableHead>
                                                    <TableHead className="text-end">المتوقع</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {orders.map(o => (
                                                    <TableRow key={o.order_id} className="cursor-pointer" onClick={() => toggle(o.order_id)}>
                                                        <TableCell onClick={e => e.stopPropagation()}>
                                                            <Checkbox checked={picked.has(o.order_id)} onCheckedChange={() => toggle(o.order_id)} />
                                                        </TableCell>
                                                        <TableCell className="text-sm">
                                                            {o.customer_info?.name || "—"}
                                                            <div className="text-[10px] text-muted-foreground">
                                                                {format(new Date(o.created_at), "yyyy-MM-dd")}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell><Badge variant="outline" className="text-[10px]">{o.status}</Badge></TableCell>
                                                        <TableCell className="text-end tabular-nums text-sm">{formatCurrency(Number(o.collected_amount))}</TableCell>
                                                        <TableCell className="text-end tabular-nums text-sm text-muted-foreground">
                                                            {formatCurrency(Number(o.actual_shipping_cost || 0))}
                                                        </TableCell>
                                                        <TableCell className={cn("text-end tabular-nums font-bold",
                                                            Number(o.expected_payout) < 0 ? "text-red-600" : "")}>
                                                            {formatCurrency(Number(o.expected_payout))}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>

                                    <div className="grid gap-4 sm:grid-cols-3 border-t pt-4">
                                        <div className="rounded-lg border p-4">
                                            <p className="text-xs text-muted-foreground">المفروض يوصلك</p>
                                            <p className="text-2xl font-bold tabular-nums">{formatCurrency(expectedPicked)}</p>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>اللي وصل فعلاً</Label>
                                            <Input type="number" step="0.01" value={receivedAmount}
                                                onChange={e => setReceivedAmount(e.target.value)} placeholder="0.00" />
                                        </div>
                                        <div className={cn("rounded-lg border p-4",
                                            gap === null ? "" : Math.abs(gap) < 0.01 ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                                                : "border-red-500 bg-red-50 dark:bg-red-950/30")}>
                                            <p className="text-xs text-muted-foreground">الفرق</p>
                                            {gap === null ? (
                                                <p className="text-2xl font-bold text-muted-foreground">—</p>
                                            ) : (
                                                <p className={cn("text-2xl font-bold tabular-nums",
                                                    Math.abs(gap) < 0.01 ? "text-green-600" : "text-red-600")}>
                                                    {gap > 0 ? "+" : ""}{formatCurrency(gap)}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {gap !== null && Math.abs(gap) >= 0.01 && (
                                        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-800 dark:text-red-300 flex gap-2">
                                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                                            <span>
                                                {gap < 0
                                                    ? `التحويل ناقص ${formatCurrency(Math.abs(gap))} عن المتوقع. راجع خصومات الشركة قبل ما تسجّل.`
                                                    : `التحويل زيادة ${formatCurrency(gap)} عن المتوقع.`}
                                                {" "}هيتسجل بالمبلغ اللي وصل، والفرق هيفضل ظاهر في السجل.
                                            </span>
                                        </div>
                                    )}

                                    <Button className="w-full" disabled={picked.size === 0 || receivedAmount === "" || saving} onClick={submit}>
                                        {saving ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 me-2" />}
                                        تسجيل التسوية ({picked.size} أوردر)
                                    </Button>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ---------------- History ---------------- */}
                <TabsContent value="history" className="pt-4">
                    <Card>
                        <CardHeader><CardTitle>التحويلات السابقة</CardTitle></CardHeader>
                        <CardContent>
                            <div className="rounded-md border overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>التاريخ</TableHead>
                                            <TableHead>الشركة</TableHead>
                                            <TableHead>مرجع</TableHead>
                                            <TableHead className="text-end">أوردرات</TableHead>
                                            <TableHead className="text-end">المتوقع</TableHead>
                                            <TableHead className="text-end">المستلم</TableHead>
                                            <TableHead className="text-end">الفرق</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {settlements.length === 0 ? (
                                            <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                                                مفيش تسويات مسجلة.
                                            </TableCell></TableRow>
                                        ) : settlements.map(s => (
                                            <TableRow key={s.id}>
                                                <TableCell className="text-sm">{s.settlement_date}</TableCell>
                                                <TableCell className="text-sm font-medium">{companyName(s.shipping_company_id)}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground">{s.reference || "—"}</TableCell>
                                                <TableCell className="text-end tabular-nums">{s.order_count}</TableCell>
                                                <TableCell className="text-end tabular-nums">{formatCurrency(Number(s.expected_amount))}</TableCell>
                                                <TableCell className="text-end tabular-nums font-medium">{formatCurrency(Number(s.received_amount))}</TableCell>
                                                <TableCell className={cn("text-end tabular-nums font-bold",
                                                    Math.abs(Number(s.difference)) < 0.01 ? "text-green-600" : "text-red-600")}>
                                                    {Number(s.difference) > 0 ? "+" : ""}{formatCurrency(Number(s.difference))}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ---------------- Aging ---------------- */}
                <TabsContent value="aging" className="pt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>تقادم المستحقات</CardTitle>
                            <CardDescription>فلوس قاعدة عند الشركة من كام يوم — أي حاجة في خانة +30 محتاجة متابعة.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>الشركة</TableHead>
                                            {AGE_BUCKETS.map(b => <TableHead key={b} className="text-end">{b} يوم</TableHead>)}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {outstanding.length === 0 ? (
                                            <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                                                مفيش مستحقات.
                                            </TableCell></TableRow>
                                        ) : outstanding.map(o => (
                                            <TableRow key={o.shipping_company_id}>
                                                <TableCell className="font-medium">{o.company_name}</TableCell>
                                                {AGE_BUCKETS.map(b => {
                                                    const row = aging.find((a: any) =>
                                                        a.shipping_company_id === o.shipping_company_id && a.bucket === b);
                                                    const amt = Number(row?.expected_total || 0);
                                                    return (
                                                        <TableCell key={b} className={cn("text-end tabular-nums",
                                                            b === "30+" && amt > 0 ? "text-red-600 font-bold" : "")}>
                                                            {amt ? formatCurrency(amt) : "—"}
                                                            {row?.order_count ? <div className="text-[10px] text-muted-foreground">{row.order_count} أوردر</div> : null}
                                                        </TableCell>
                                                    );
                                                })}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
