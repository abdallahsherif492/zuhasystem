"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase, fetchAll } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, FileSpreadsheet, AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import {
    parseStatement, reconcile, ourPayout,
    type OrderLike, type Reconciliation,
} from "@/lib/shipping/statement";

/**
 * Reconcile a courier's own account statement against ours.
 *
 * Done by hand once, on Telegraf's ledger, this explained a 210,642 EGP
 * disagreement down to the last pound — and the explanation was four separate
 * things, none of which the settlement screen could show. Doing it by hand
 * every month is not the answer, so it lives here.
 */
export default function CourierStatementPage() {
    const { activeBusiness, currentUser } = useBusiness();

    const [couriers, setCouriers] = useState<any[]>([]);
    const [courierId, setCourierId] = useState("");
    const [orders, setOrders] = useState<OrderLike[]>([]);
    const [collected, setCollected] = useState<number>(0);
    const [loadingOrders, setLoadingOrders] = useState(false);

    const [fileName, setFileName] = useState("");
    const [rows, setRows] = useState<any[] | null>(null);
    const [parseError, setParseError] = useState("");
    const [busy, setBusy] = useState(false);
    const [fixing, setFixing] = useState(false);
    const [restock, setRestock] = useState(false);

    useEffect(() => {
        if (!activeBusiness) return;
        supabase.from("shipping_companies").select("id, name")
            .eq("business_id", activeBusiness.id).order("name")
            .then(({ data }) => setCouriers(data || []));
    }, [activeBusiness]);

    // The courier's orders, and how much of their money we have already booked.
    useEffect(() => {
        if (!activeBusiness || !courierId) { setOrders([]); setCollected(0); return; }
        let cancelled = false;
        (async () => {
            setLoadingOrders(true);
            const data = await fetchAll<OrderLike>((from, to) =>
                supabase.from("orders")
                    .select("id, status, total_amount, paid_amount, actual_shipping_cost, shipping_company_id, created_at, customer_info")
                    .eq("business_id", activeBusiness.id)
                    .eq("shipping_company_id", courierId)
                    .range(from, to));
            const { data: match } = await supabase.rpc("get_courier_collection_match", {
                p_business_id: activeBusiness.id,
                p_from: new Date("2000-01-01").toISOString(),
                p_to: new Date("2100-01-01").toISOString(),
            });
            if (cancelled) return;
            setOrders(data);
            const mine = (match as any[] || []).find(m => m.shipping_company_id === courierId);
            setCollected(Number(mine?.received_total || 0));
            setLoadingOrders(false);
        })();
        return () => { cancelled = true; };
    }, [activeBusiness, courierId]);

    async function onFile(file: File) {
        setBusy(true); setParseError(""); setRows(null); setFileName(file.name);
        try {
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: "array" });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
            const { rows: parsed, error } = parseStatement(grid);
            if (error) { setParseError(error); return; }
            if (parsed.length === 0) { setParseError("الملف مفيهوش حركات."); return; }
            setRows(parsed);
        } catch (e: any) {
            setParseError(e?.message || "مش قادر أقرا الملف.");
        } finally {
            setBusy(false);
        }
    }

    const rec: Reconciliation | null = useMemo(() => {
        if (!rows || orders.length === 0) return null;
        return reconcile(rows as any, orders, collected);
    }, [rows, orders, collected]);

    /**
     * Mark the orders the courier charged us for as returned.
     *
     * Restocking is off by default and offered as a choice. These parcels came
     * back to the warehouse weeks or months ago, so their units were almost
     * certainly put away already; letting the status trigger restock them now
     * would count the same goods twice.
     */
    async function applyReturns() {
        if (!activeBusiness || !rec || rec.chargedNotCredited.length === 0) return;
        const ids = rec.chargedNotCredited.map(c => c.order.id);
        setFixing(true);
        try {
            const { data, error } = await supabase.from("orders")
                .update({ status: "Returned", restock_on_return: restock })
                .in("id", ids)
                .eq("business_id", activeBusiness.id)
                .select("id");
            if (error) throw error;
            const n = data?.length || 0;
            logBusinessAction({
                businessId: activeBusiness.id,
                userEmail: currentUser?.email || "Staff",
                actionType: "update_status",
                entityType: "order",
                entityId: `statement-${courierId}`,
                entityName: `${n} أوردر اتعلّموا Returned من كشف حساب ${couriers.find(c => c.id === courierId)?.name || ""}`,
                changes: [
                    { field: "Status", old_value: "Collected", new_value: "Returned" },
                    { field: "Restocked", old_value: null, new_value: restock ? "Yes" : "No" },
                    { field: "Source", old_value: null, new_value: fileName },
                ],
            });
            toast.success(`اتعدّل ${n} أوردر`);
            setCourierId(id => id); // keep selection
            const refreshed = await fetchAll<OrderLike>((from, to) =>
                supabase.from("orders")
                    .select("id, status, total_amount, paid_amount, actual_shipping_cost, shipping_company_id, created_at, customer_info")
                    .eq("business_id", activeBusiness.id)
                    .eq("shipping_company_id", courierId)
                    .range(from, to));
            setOrders(refreshed);
        } catch (e: any) {
            console.error(e);
            toast.error(e?.message || "مش قادر أعدّل الأوردرات");
        } finally {
            setFixing(false);
        }
    }

    const t = rec?.totals;
    const line = (label: string, value: number, hint?: string) => (
        <div className="flex items-baseline justify-between gap-4 py-2 border-b last:border-0">
            <div>
                <span className="text-sm">{label}</span>
                {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
            </div>
            <span className={`tabular-nums font-semibold whitespace-nowrap ${value < 0 ? "text-destructive" : "text-emerald-600"}`}>
                {value < 0 ? "−" : "+"} {formatCurrency(Math.abs(value))}
            </span>
        </div>
    );

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">مطابقة كشف حساب شركة الشحن</h1>
                <p className="text-muted-foreground mt-1">
                    ارفع كشف الحساب اللي الشركة بتبعته، والصفحة هتقارنه بالأوردرات وتفسّر
                    الفرق بين اللي إحنا حاسبينه واللي هما حاسبينه، بند بند.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>الملف</CardTitle>
                    <CardDescription>
                        Excel أو CSV. الصفحة بتدوّر لوحدها على أعمدة الوصف والمدين والدائن،
                        وبتقرا رقم الأوردر من وصف الحركة — نفس الرقم اللي على صفحة الأوردرات.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">شركة الشحن</label>
                            <select
                                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                value={courierId}
                                onChange={e => { setCourierId(e.target.value); setRows(null); }}
                            >
                                <option value="">اختار شركة</option>
                                {couriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">كشف الحساب</label>
                            <label className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                <span className="truncate">{fileName || "اختار ملف..."}</span>
                                <input
                                    type="file" className="hidden"
                                    accept=".xlsx,.xls,.csv"
                                    disabled={!courierId || busy}
                                    onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}
                                />
                            </label>
                        </div>
                    </div>

                    {!courierId && (
                        <p className="text-sm text-muted-foreground">اختار الشركة الأول.</p>
                    )}
                    {loadingOrders && (
                        <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" /> بيحمّل أوردرات الشركة...
                        </p>
                    )}
                    {parseError && (
                        <p className="text-sm text-destructive flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" /> {parseError}
                        </p>
                    )}
                    {rows && !parseError && (
                        <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <FileSpreadsheet className="h-4 w-4" />
                            اتقرا {rows.length.toLocaleString()} حركة من الكشف.
                        </p>
                    )}
                </CardContent>
            </Card>

            {rec && t && (
                <>
                    <Card>
                        <CardHeader>
                            <CardTitle>الفرق، مفسّر</CardTitle>
                            <CardDescription>
                                من الرقم اللي السيستم بيقوله لحد الرقم اللي الشركة بتقوله. كل بند
                                فرق حقيقي بين الدفترين على نفس الأوردرات، فالمفروض الباقي يطلع صفر.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-baseline justify-between gap-4 pb-3 mb-2 border-b-2">
                                <span className="font-semibold">السيستم بيقول عليهم</span>
                                <span className="text-2xl font-black tabular-nums">
                                    {formatCurrency(t.ourOutstanding)}
                                </span>
                            </div>

                            {line("شحن بياخدوه زيادة عن اللي إحنا مسجلينه", -t.shippingGap,
                                `على ${rec.matched.length.toLocaleString()} أوردر متطابق`)}
                            {rec.chargedNotCredited.length > 0 &&
                                line("أوردرات إحنا حاسبينها متسلّمة والكشف بيحاسبنا عليها", -t.chargedValue,
                                    `${rec.chargedNotCredited.length} أوردر — الشركة رجّعتها`)}
                            {rec.unlisted.length > 0 &&
                                line("أوردرات إحنا حاسبينها متسلّمة والكشف مش ذاكرها", -t.unlistedValue,
                                    `${rec.unlisted.length} أوردر`)}
                            {t.settledFeesValue !== 0 &&
                                line("رسوم على مرتجعات السيستم عارفها", -t.settledFeesValue,
                                    `${rec.settledFees.length} حركة — تكلفة حقيقية`)}
                            {t.unknownValue !== 0 &&
                                line("رسوم على أرقام مش موجودة عندنا", -t.unknownValue,
                                    `${rec.unknownRefs.length} حركة`)}
                            {line("تحصيل سجّلناه أكتر من الكاش اللي الكشف بيقوله", t.cashGap,
                                `الكشف: ${formatCurrency(t.theirCash)} · عندنا: ${formatCurrency(t.ourCollections)}`)}

                            <div className="flex items-baseline justify-between gap-4 pt-3 mt-2 border-t-2">
                                <span className="font-semibold">الشركة بتقول عليها</span>
                                <span className="text-2xl font-black tabular-nums text-emerald-600">
                                    {formatCurrency(t.theirBalance)}
                                </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-4 pt-2">
                                <span className="text-xs text-muted-foreground">الباقي غير مفسّر</span>
                                <span className={`text-sm tabular-nums font-semibold ${
                                    Math.abs(t.residual) < 1 ? "text-emerald-600" : "text-amber-600"}`}>
                                    {Math.abs(t.residual) < 1 ? "صفر — الفرق مفسّر بالكامل" : formatCurrency(t.residual)}
                                </span>
                            </div>
                        </CardContent>
                    </Card>

                    {rec.chargedNotCredited.length > 0 && (
                        <Card className="border-destructive/40">
                            <CardHeader>
                                <CardTitle>الشركة رجّعتها وإحنا كاتبينها متسلّمة</CardTitle>
                                <CardDescription>
                                    الكشف بيحاسبنا رسوم إرجاع على الأوردرات دي، يعني الطرد رجع.
                                    السيستم لسه شايفها متسلّمة، فبتظهر كإيراد وكفلوس عند الشركة
                                    وهي لا دي ولا دي.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex flex-wrap items-center gap-3">
                                    <Button onClick={applyReturns} disabled={fixing} variant="destructive">
                                        {fixing
                                            ? <Loader2 className="h-4 w-4 animate-spin me-2" />
                                            : <Check className="h-4 w-4 me-2" />}
                                        علّم الـ{rec.chargedNotCredited.length} أوردر دول Returned
                                    </Button>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={restock}
                                            onChange={e => setRestock(e.target.checked)} />
                                        رجّع الكمية للمخزون
                                    </label>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    رجوع الكمية مقفول افتراضياً: الطرود دي رجعت المخزن من أسابيع أو
                                    شهور والكميات غالباً اترجّعت وقتها، فلو رجّعناها دلوقتي هتتحسب مرتين.
                                </p>

                                <div className="rounded-lg border overflow-x-auto max-h-96 overflow-y-auto">
                                    <table className="w-full text-sm min-w-[560px]">
                                        <thead className="bg-muted/50 sticky top-0">
                                            <tr>
                                                <th className="text-start p-2.5 font-medium text-xs">الأوردر</th>
                                                <th className="text-start p-2.5 font-medium text-xs">العميل</th>
                                                <th className="text-start p-2.5 font-medium text-xs">التاريخ</th>
                                                <th className="text-end p-2.5 font-medium text-xs">بنطالب بـ</th>
                                                <th className="text-end p-2.5 font-medium text-xs">الشركة بتحاسبنا</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rec.chargedNotCredited.map(c => (
                                                <tr key={c.order.id} className="border-t">
                                                    <td className="p-2.5 font-mono text-xs font-semibold">
                                                        #{c.order.id.slice(0, 8)}
                                                    </td>
                                                    <td className="p-2.5">{c.order.customer_info?.name || "—"}</td>
                                                    <td className="p-2.5 text-xs text-muted-foreground tabular-nums">
                                                        {c.order.created_at.slice(0, 10)}
                                                    </td>
                                                    <td className="p-2.5 text-end tabular-nums">{formatCurrency(c.ours)}</td>
                                                    <td className="p-2.5 text-end tabular-nums text-destructive">
                                                        {formatCurrency(Math.abs(c.theirs))}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {rec.unlisted.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle>مش موجودة في الكشف خالص</CardTitle>
                                <CardDescription>
                                    إحنا حاسبينها متسلّمة والشركة مش ذاكراها لا تسليم ولا إرجاع.
                                    الحديثة منها غالباً لسه ماترحّلتش على الكشف؛ القديمة محتاجة سؤال.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="rounded-lg border overflow-x-auto max-h-96 overflow-y-auto">
                                    <table className="w-full text-sm min-w-[520px]">
                                        <thead className="bg-muted/50 sticky top-0">
                                            <tr>
                                                <th className="text-start p-2.5 font-medium text-xs">الأوردر</th>
                                                <th className="text-start p-2.5 font-medium text-xs">العميل</th>
                                                <th className="text-start p-2.5 font-medium text-xs">التاريخ</th>
                                                <th className="text-end p-2.5 font-medium text-xs">بنطالب بـ</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {[...rec.unlisted]
                                                .sort((a, b) => a.created_at.localeCompare(b.created_at))
                                                .map(o => (
                                                    <tr key={o.id} className="border-t">
                                                        <td className="p-2.5 font-mono text-xs font-semibold">#{o.id.slice(0, 8)}</td>
                                                        <td className="p-2.5">{o.customer_info?.name || "—"}</td>
                                                        <td className="p-2.5 text-xs text-muted-foreground tabular-nums">
                                                            {o.created_at.slice(0, 10)}
                                                        </td>
                                                        <td className="p-2.5 text-end tabular-nums">{formatCurrency(ourPayout(o))}</td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader>
                            <CardTitle>الرسوم اللي الشركة بتخصمها</CardTitle>
                            <CardDescription>
                                بأسمائها زي ما هي في الكشف. لو دي أول مرة تشوف الأرقام دي، يبقى
                                إعدادات الشركة عندك مش بتعبّر عن اللي بتدفعه.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-lg border overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/50">
                                        <tr>
                                            <th className="text-start p-2.5 font-medium text-xs">نوع الحركة</th>
                                            <th className="text-end p-2.5 font-medium text-xs">العدد</th>
                                            <th className="text-end p-2.5 font-medium text-xs">الإجمالي</th>
                                            <th className="text-end p-2.5 font-medium text-xs">المتوسط</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rec.fees.map(x => (
                                            <tr key={x.label} className="border-t">
                                                <td className="p-2.5">{x.label}</td>
                                                <td className="p-2.5 text-end tabular-nums">{x.count.toLocaleString()}</td>
                                                <td className="p-2.5 text-end tabular-nums font-semibold">{formatCurrency(x.amount)}</td>
                                                <td className="p-2.5 text-end tabular-nums text-muted-foreground">
                                                    {formatCurrency(x.amount / Math.max(x.count, 1))}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}
