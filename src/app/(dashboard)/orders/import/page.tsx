"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { logBusinessAction } from "@/lib/logs/actions-logger";
import { orderLogName } from "@/lib/logs/order-log-name";
import { arabicProductLabel } from "@/lib/orders/product-label";
import {
    CHANNELS, SHEET_COLUMNS, orderFingerprint, parseOrderSheet,
    type CatalogVariant, type ParsedOrder,
} from "@/lib/orders/sheet-import";

/** Tag on every order created here, so imported orders can be found and a re-upload recognised. */
const IMPORT_TAG = "sheet-import";

/**
 * Upload orders from Excel.
 *
 * For merchants who sell from a Facebook or Instagram page and keep their
 * orders in a sheet. Every order goes in exactly as the new-order form would
 * create it — Pending, same totals, same courier-cost estimate, customer
 * linked by phone — so nothing downstream can tell the difference, except the
 * "sheet-import" tag. Rows with a problem are listed with their row number and
 * skipped; the rest can be imported, and uploading the same sheet again skips
 * orders that are already in.
 */
export default function ImportOrdersPage() {
    const { activeBusiness, currentUser } = useBusiness();
    const { language } = useLanguage();
    const ar = language === "ar";
    const copy = (a: string, e: string) => (ar ? a : e);

    const fileRef = useRef<HTMLInputElement>(null);
    const [catalog, setCatalog] = useState<CatalogVariant[] | null>(null);
    const [channel, setChannel] = useState("Facebook");
    const [fileName, setFileName] = useState("");
    const [rows, setRows] = useState<unknown[][] | null>(null);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [result, setResult] = useState<{ created: number; skipped: number; failed: string[] } | null>(null);

    useEffect(() => {
        if (!activeBusiness) return;
        let cancelled = false;
        supabase
            .from("variants")
            .select("id, title, sku, sale_price, cost_price, products!inner(name, description, business_id)")
            .eq("products.business_id", activeBusiness.id)
            .then(({ data }) => {
                if (cancelled) return;
                type Row = { id: string; title: string | null; sku: string | null; sale_price: number | null; cost_price: number | null; products: { name?: string; description?: string | null } | null };
                setCatalog(((data || []) as unknown as Row[]).map(v => ({
                    id: v.id, title: v.title, sku: v.sku, sale_price: v.sale_price, cost_price: v.cost_price,
                    product_name: v.products?.name || "",
                    arabic_name: arabicProductLabel(v.products?.description),
                })));
            });
        return () => { cancelled = true; };
    }, [activeBusiness]);

    const parsed = useMemo(
        () => (rows && catalog ? parseOrderSheet(rows, catalog, channel) : null),
        [rows, catalog, channel],
    );
    const ready = parsed?.orders.filter(o => !o.errors.length) || [];
    const broken = parsed?.orders.filter(o => o.errors.length) || [];

    function downloadTemplate() {
        const header = SHEET_COLUMNS.map(c => c.header);
        const example = SHEET_COLUMNS.map(c => c.example);
        const second = SHEET_COLUMNS.map(c => (c.key === "order" ? "1" : c.key === "product" ? (catalog?.[1]?.product_name || "") : c.key === "quantity" ? "2" : ""));
        const ws = XLSX.utils.aoa_to_sheet([header, [...example.slice(0, 6), catalog?.[0]?.product_name || example[6], ...example.slice(7)], second]);
        ws["!cols"] = SHEET_COLUMNS.map(c => ({ wch: Math.max(14, c.header.length + 4) }));
        const help = XLSX.utils.aoa_to_sheet([
            ["إزاي تملى الشيت"],
            ["• كل صف = منتج واحد. لو الأوردر فيه أكتر من منتج، اكتب نفس رقم الأوردر في الصفوف بتاعته، وبيانات العميل في أول صف بس."],
            ["• المنتج: اكتب كود المنتج، أو اسمه زي ما هو في صفحة المنتجات، أو اسمه العربي (أول سطر في وصف المنتج)."],
            ["• اللون / المقاس: بس لو المنتج ليه أكتر من نوع."],
            ["• سعر القطعة: سيبه فاضي وهيتحسب سعر المنتج اللي في السيستم."],
            ["• المحافظة: بالعربي أو الإنجليزي (القاهرة، الجيزة، الإسكندرية...)."],
            ["• الأوردرات هتدخل بحالة Pending زي الأوردر اليدوي بالظبط."],
        ]);
        help["!cols"] = [{ wch: 110 }];
        const wb = XLSX.utils.book_new();
        wb.Workbook = { Views: [{ RTL: true }] };
        XLSX.utils.book_append_sheet(wb, ws, "الأوردرات");
        XLSX.utils.book_append_sheet(wb, help, "طريقة الملى");
        XLSX.writeFile(wb, "eCommerx - شيت رفع الأوردرات.xlsx");
    }

    function onFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setResult(null);
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = evt => {
            try {
                const wb = XLSX.read(evt.target?.result, { type: "array" });
                const ws = wb.Sheets[wb.SheetNames[0]];
                setRows(XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false }) as unknown[][]);
            } catch {
                toast.error(copy("مش قادرين نقرا الملف. اتأكد إنه Excel أو CSV.", "Could not read the file. Use Excel or CSV."));
                setRows(null);
            }
        };
        reader.readAsArrayBuffer(file);
        e.target.value = "";
    }

    async function createOne(o: ParsedOrder, rates: Record<string, unknown> | null) {
        const businessId = activeBusiness!.id;

        // Same customer as the form would use: an existing one with this phone, or a new one.
        const { data: existing } = await supabase
            .from("customers").select("id").eq("business_id", businessId).eq("phone", o.phone).limit(1);
        let customerId = existing?.[0]?.id as string | undefined;
        if (!customerId) {
            const { data: cust, error } = await supabase.from("customers").insert({
                business_id: businessId, name: o.name, phone: o.phone, phone2: o.phone2,
                address: o.address, governorate: o.governorate,
            }).select("id").single();
            if (error) throw error;
            customerId = cust.id;
        }

        // Courier cost estimate, exactly as the new-order form does it.
        const rate = rates?.[o.governorate];
        const actualShipping = rate !== undefined && rate !== null && rate !== ""
            ? Number(rate) || 0
            : (["Cairo", "Giza", "New Cairo"].includes(o.governorate) ? 65 : 75);

        const paymentStatus = o.paid <= 0 ? "Not Paid" : o.paid >= o.total ? "Paid" : "Partially Paid";
        const { data: order, error: orderError } = await supabase.from("orders").insert({
            business_id: businessId,
            customer_id: customerId,
            customer_info: { name: o.name, phone: o.phone, phone2: o.phone2, address: o.address, governorate: o.governorate },
            total_amount: o.total,
            total_cost: o.totalCost,
            subtotal: o.subtotal,
            discount: 0,
            order_type: "new",
            shipping_cost: o.shipping,
            actual_shipping_cost: actualShipping,
            status: "Pending",
            channel: o.channel,
            tags: [IMPORT_TAG],
            notes: o.notes || null,
            payment_status: paymentStatus,
            paid_amount: paymentStatus === "Paid" ? o.total : o.paid,
        }).select("id").single();
        if (orderError) throw orderError;

        const { error: itemsError } = await supabase.from("order_items").insert(o.lines.map(l => ({
            business_id: businessId,
            order_id: order.id,
            variant_id: l.variantId,
            quantity: l.quantity,
            price_at_sale: l.price,
            cost_at_sale: l.cost,
        })));
        if (itemsError) {
            // An order with no lines would sit in the list looking real.
            await supabase.from("orders").delete().eq("id", order.id).eq("business_id", businessId);
            throw itemsError;
        }

        logBusinessAction({
            businessId,
            userEmail: currentUser?.email || "Staff",
            actionType: "create",
            entityType: "order",
            entityId: order.id,
            entityName: orderLogName(order.id, { name: o.name, phone: o.phone }),
            changes: [
                { field: "Total Amount", old_value: null, new_value: `${o.total} EGP` },
                { field: "Status", old_value: null, new_value: "Pending" },
                { field: "Source", old_value: null, new_value: "Excel sheet" },
            ],
        });
    }

    async function runImport() {
        if (!activeBusiness || !ready.length) return;
        setImporting(true);
        setProgress(0);
        const failed: string[] = [];
        let created = 0, skipped = 0;
        try {
            // Orders this store already imported recently, so a re-upload adds nothing twice.
            const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
            const { data: prior } = await supabase.from("orders")
                .select("customer_info, total_amount")
                .eq("business_id", activeBusiness.id)
                .contains("tags", [IMPORT_TAG])
                .gte("created_at", since)
                .limit(5000);
            const seen = new Set((prior || []).map((p: { customer_info: { phone?: string } | null; total_amount: number | null }) =>
                orderFingerprint(p.customer_info?.phone || "", Number(p.total_amount) || 0)));

            const { data: courier } = await supabase.from("shipping_companies")
                .select("rates").eq("business_id", activeBusiness.id).eq("is_default", true).maybeSingle();
            const rates = (courier?.rates as Record<string, unknown>) || null;

            for (let i = 0; i < ready.length; i++) {
                const o = ready[i];
                const fp = orderFingerprint(o.phone, o.total);
                if (seen.has(fp)) {
                    skipped++;
                } else {
                    try {
                        await createOne(o, rates);
                        seen.add(fp);
                        created++;
                    } catch (e) {
                        failed.push(`${copy("صف", "Row")} ${o.rows.join("، ")}: ${(e as { message?: string })?.message || String(e)}`);
                    }
                }
                setProgress(Math.round(((i + 1) / ready.length) * 100));
            }
            setResult({ created, skipped, failed });
            if (created) toast.success(copy(`اتضاف ${created} أوردر`, `${created} orders added`));
        } finally {
            setImporting(false);
        }
    }

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6 pb-16" dir={ar ? "rtl" : "ltr"}>
            <header className="space-y-1">
                <h1 className="text-2xl font-bold sm:text-3xl">{copy("رفع أوردرات من شيت Excel", "Import orders from Excel")}</h1>
                <p className="text-muted-foreground">
                    {copy("لو بتبيع من صفحة فيسبوك أو إنستجرام وبتسجل أوردراتك في شيت، ارفعه هنا بدل ما تدخّل كل أوردر لوحده.",
                        "Selling from a Facebook or Instagram page and keeping orders in a sheet? Upload it here instead of typing each order.")}
                </p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">{copy("١. نزّل الشيت الجاهز", "1. Download the template")}</CardTitle>
                    <CardDescription>
                        {copy("عمود لكل حاجة: العميل، الموبايل، المحافظة، العنوان، المنتج، الكمية. تقدر كمان ترفع شيتك انت لو أسماء الأعمدة قريبة من دي.",
                            "One column each for customer, phone, governorate, address, product and quantity. Your own sheet works too if its headers are close.")}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button variant="outline" onClick={downloadTemplate} className="min-h-11" disabled={!catalog}>
                        <Download className="me-2 h-4 w-4" />{copy("نزّل الشيت", "Download template")}
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">{copy("٢. ارفع الشيت", "2. Upload your sheet")}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
                    <Button onClick={() => fileRef.current?.click()} className="min-h-11" disabled={!catalog || importing}>
                        <Upload className="me-2 h-4 w-4" />{copy("اختار الملف", "Choose file")}
                    </Button>
                    <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">{copy("القناة لو مش مكتوبة في الشيت:", "Channel when the sheet has none:")}</span>
                        <Select value={channel} onValueChange={setChannel}>
                            <SelectTrigger className="h-10 w-40"><SelectValue /></SelectTrigger>
                            <SelectContent>{CHANNELS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    {fileName && <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><FileSpreadsheet className="h-4 w-4" />{fileName}</span>}
                </CardContent>
            </Card>

            {catalog && catalog.length === 0 && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    {copy("لازم تضيف منتجاتك الأول عشان نعرف نربط الأوردرات بيها.", "Add your products first so orders can be matched to them.")}{" "}
                    <Link href="/products/new" className="font-semibold underline">{copy("ضيف منتج", "Add a product")}</Link>
                </p>
            )}

            {parsed && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">{copy("٣. راجع وارفع", "3. Review and import")}</CardTitle>
                        <CardDescription>
                            {parsed.sheetErrors.length
                                ? parsed.sheetErrors.join(" ")
                                : copy(`${ready.length} أوردر جاهز · ${broken.length} محتاج تصليح`, `${ready.length} ready · ${broken.length} need fixing`)}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {broken.length > 0 && (
                            <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                                <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />
                                    {copy("الأوردرات دي مش هتترفع لحد ما تصلحها في الشيت وترفعه تاني:", "These will be skipped until fixed in the sheet:")}
                                </p>
                                <ul className="max-h-64 space-y-1 overflow-y-auto">
                                    {broken.map(o => (
                                        <li key={o.key}>
                                            <span className="font-semibold">{copy("صف", "Row")} {o.rows.join("، ")}{o.name ? ` (${o.name})` : ""}:</span> {o.errors.join(" · ")}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {ready.length > 0 && (
                            <div className="overflow-x-auto rounded-md border">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/50 text-muted-foreground">
                                        <tr>
                                            <th className="p-2 text-start">{copy("العميل", "Customer")}</th>
                                            <th className="p-2 text-start">{copy("المحافظة", "Governorate")}</th>
                                            <th className="p-2 text-start">{copy("المنتجات", "Products")}</th>
                                            <th className="p-2 text-end">{copy("الإجمالي", "Total")}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ready.slice(0, 200).map(o => (
                                            <tr key={o.key} className="border-t align-top">
                                                <td className="p-2"><div className="font-medium">{o.name}</div><div className="font-mono text-xs text-muted-foreground" dir="ltr">{o.phone}</div></td>
                                                <td className="p-2">{o.governorate}</td>
                                                <td className="p-2">{o.lines.map((l, i) => <div key={i}>{l.label} × {l.quantity}</div>)}</td>
                                                <td className="p-2 text-end tabular-nums">{formatCurrency(o.total)}{o.paid > 0 && <div className="text-xs text-muted-foreground">{copy("مدفوع", "paid")} {formatCurrency(o.paid)}</div>}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {ready.length > 200 && <p className="p-2 text-xs text-muted-foreground">{copy(`و${ready.length - 200} أوردر كمان`, `and ${ready.length - 200} more`)}</p>}
                            </div>
                        )}

                        {importing && <Progress value={progress} />}

                        {result ? (
                            <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                                <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />
                                    {copy(`اتضاف ${result.created} أوردر بحالة Pending.`, `${result.created} orders added as Pending.`)}
                                    {result.skipped > 0 && copy(` اتخطينا ${result.skipped} كانوا مترفعين قبل كده.`, ` Skipped ${result.skipped} already imported.`)}
                                </p>
                                {result.failed.length > 0 && <ul className="text-red-700">{result.failed.map((f, i) => <li key={i}>{f}</li>)}</ul>}
                                <p className="text-xs opacity-80">
                                    {copy("لو فيه أوردرات مدفوع ليها عربون، سجّل الفلوس في الخزينة من صفحة الحسابات.", "For orders with a deposit, record the money in Accounting.")}
                                </p>
                                <Button asChild className="min-h-11"><Link href="/orders">{copy("افتح الأوردرات", "Open orders")}</Link></Button>
                            </div>
                        ) : (
                            <Button onClick={runImport} disabled={!ready.length || importing} className="min-h-11 w-full sm:w-auto">
                                {importing ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Upload className="me-2 h-4 w-4" />}
                                {importing ? copy(`بنرفع... ${progress}%`, `Importing... ${progress}%`) : copy(`ارفع ${ready.length} أوردر`, `Import ${ready.length} orders`)}
                            </Button>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
