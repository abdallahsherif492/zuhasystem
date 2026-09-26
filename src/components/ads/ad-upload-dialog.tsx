"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronDown, FileSpreadsheet, HelpCircle, Loader2, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    AD_CHANNELS, adChannelInfo, adKey, makeAdProductMatcher, parseAdReport,
    type AdChannel, type ParsedAdReport,
} from "@/lib/ads/ad-report";
import { ExportGuide } from "./export-guide";
import { AdProductPicker, type PickerProduct } from "./product-picker";

const VAT = 0.14;

/** 2026-09-26 → 26/09 */
const shortDate = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—");

/** A missing table or function: the migration has not been run on this database yet. */
export const isMissingMigration = (e: { code?: string; message?: string } | null) =>
    !!e && (e.code === "42P01" || e.code === "PGRST202" || e.code === "PGRST205" || /does not exist|could not find/i.test(e.message || ""));

export const MIGRATION_HINT = "supabase/migrations/20260926_ad_product_tracking.sql";

async function readSheet(file: File): Promise<unknown[][]> {
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
        const text = await file.text();
        return Papa.parse<unknown[]>(text, { skipEmptyLines: true }).data;
    }
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
}

export function AdUploadDialog({ open, onOpenChange, businessId, initialChannel, products, links, firstTime, ar, onDone }: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    businessId: string;
    initialChannel: AdChannel;
    products: PickerProduct[];
    /** Links already saved: ad key → product id, or null for general. */
    links: Map<string, string | null>;
    /** No report uploaded yet: open the export steps by default. */
    firstTime: boolean;
    ar: boolean;
    onDone: (channel: AdChannel, from: string, to: string) => void;
}) {
    const t = (a: string, e: string) => (ar ? a : e);
    const fileRef = useRef<HTMLInputElement>(null);
    const [channel, setChannel] = useState<AdChannel>(initialChannel);
    const [addVat, setAddVat] = useState(true);
    const [showGuide, setShowGuide] = useState(firstTime);
    const [file, setFile] = useState<File | null>(null);
    const [sheet, setSheet] = useState<unknown[][] | null>(null);
    const [picks, setPicks] = useState<Map<string, string | null>>(new Map());
    const [saving, setSaving] = useState(false);

    const report: ParsedAdReport | null = useMemo(() => (sheet ? parseAdReport(sheet, channel, ar) : null), [sheet, channel, ar]);

    const matcher = useMemo(() => makeAdProductMatcher(products), [products]);

    /** One entry per ad in the file: its spend, and the product it will be linked to and why. */
    const adsInFile = useMemo(() => {
        if (!report) return [];
        const byAd = new Map<string, { key: string; name: string; spend: number }>();
        for (const r of report.rows) {
            const k = adKey(r.ad_name);
            const a = byAd.get(k) ?? { key: k, name: r.ad_name, spend: 0 };
            a.spend += r.spend_raw;
            byAd.set(k, a);
        }
        return [...byAd.values()].sort((a, b) => b.spend - a.spend).map(a => {
            if (picks.has(a.key)) return { ...a, productId: picks.get(a.key), source: "manual" as const };
            if (links.has(a.key)) return { ...a, productId: links.get(a.key), source: "saved" as const };
            const m = matcher(a.name);
            return { ...a, productId: m ? m.id : undefined, source: m ? "auto" as const : "none" as const };
        });
    }, [report, picks, links, matcher]);

    const totalRaw = report?.rows.reduce((s, r) => s + r.spend_raw, 0) ?? 0;
    const totalResults = report?.rows.reduce((s, r) => s + r.results, 0) ?? 0;
    const unlinked = adsInFile.filter(a => a.productId === undefined).length;

    const reset = () => {
        setFile(null); setSheet(null); setPicks(new Map());
        if (fileRef.current) fileRef.current.value = "";
    };

    const onFile = async (f: File | undefined) => {
        if (!f) return;
        try {
            setFile(f);
            setPicks(new Map());
            setSheet(await readSheet(f));
        } catch (e) {
            console.error(e);
            toast.error(t("مش قادر أقرا الملف. نزّله تاني CSV أو Excel.", "Could not read the file. Export it again as CSV or Excel."));
            reset();
        }
    };

    const save = async () => {
        if (!report || report.errors.length || !file) return;
        setSaving(true);
        try {
            const { error } = await supabase.rpc("import_ad_spend", {
                p_business_id: businessId,
                p_channel: channel,
                p_file_name: file.name,
                p_vat_rate: addVat ? VAT : 0,
                p_rows: report.rows,
            });
            if (error) throw error;

            // New links only: an ad linked before, by hand or automatically,
            // keeps its product unless it was changed here.
            const auto = adsInFile.filter(a => a.source === "auto").map(a => ({
                business_id: businessId, ad_key: a.key, ad_name: a.name, product_id: a.productId!, source: "auto",
            }));
            const manual = adsInFile.filter(a => a.source === "manual").map(a => ({
                business_id: businessId, ad_key: a.key, ad_name: a.name, product_id: a.productId ?? null, source: "manual", updated_at: new Date().toISOString(),
            }));
            if (auto.length) {
                const { error: e } = await supabase.from("ad_product_links").upsert(auto, { onConflict: "business_id,ad_key", ignoreDuplicates: true });
                if (e) throw e;
            }
            if (manual.length) {
                const { error: e } = await supabase.from("ad_product_links").upsert(manual, { onConflict: "business_id,ad_key" });
                if (e) throw e;
            }

            toast.success(t(
                `اترفع ${adsInFile.length} إعلان من ${report.dateFrom} لـ ${report.dateTo}`,
                `Uploaded ${adsInFile.length} ads, ${report.dateFrom} to ${report.dateTo}`));
            onDone(channel, report.dateFrom!, report.dateTo!);
            reset();
            onOpenChange(false);
        } catch (e) {
            const err = e as { code?: string; message?: string };
            console.error("Ad report import failed:", err);
            toast.error(isMissingMigration(err)
                ? t(`جداول الإعلانات لسه مش متعملة. شغّل ${MIGRATION_HINT} في Supabase.`, `The ads tables are missing. Run ${MIGRATION_HINT} in Supabase.`)
                : t("الرفع فشل، ومفيش حاجة اتغيرت. جرّب تاني.", "The upload failed and nothing changed. Try again."));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={o => { if (!saving) { onOpenChange(o); if (!o) reset(); } }}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl" dir={ar ? "rtl" : "ltr"}>
                <DialogHeader>
                    <DialogTitle>{t("رفع تقرير الإعلانات", "Upload an ad report")}</DialogTitle>
                    <DialogDescription>
                        {t("من Meta Ads Manager أو TikTok Ads Manager، CSV أو Excel.", "From Meta Ads Manager or TikTok Ads Manager, CSV or Excel.")}
                    </DialogDescription>
                </DialogHeader>

                {/* 1. Which ads */}
                <div className="space-y-2">
                    <div className="text-sm font-medium">{t("١. الإعلانات دي نوعها إيه؟", "1. What are these ads?")}</div>
                    <div className="grid gap-2 sm:grid-cols-3">
                        {AD_CHANNELS.map(c => (
                            <button
                                key={c.key}
                                type="button"
                                onClick={() => setChannel(c.key)}
                                className={cn(
                                    "rounded-lg border p-3 text-start text-sm transition-colors",
                                    channel === c.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/60",
                                )}
                            >
                                <div className="font-medium">{ar ? c.label : c.labelEn}</div>
                                <div className="mt-0.5 text-xs text-muted-foreground">
                                    {c.key === "messages" && t("أوردرات Facebook و WhatsApp و Instagram", "Facebook, WhatsApp and Instagram orders")}
                                    {c.key === "website" && t("أوردرات الموقع (Website)", "Website orders")}
                                    {c.key === "tiktok" && t("أوردرات Tiktok و Tiktok Website", "Tiktok and Tiktok Website orders")}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* How to export */}
                <div>
                    <button type="button" onClick={() => setShowGuide(s => !s)} className="flex items-center gap-1.5 text-sm font-medium text-primary">
                        <HelpCircle className="h-4 w-4" />
                        {t(`إزاي أنزّل الملف من ${channel === "tiktok" ? "تيك توك" : "ميتا"}؟`, `How do I export it from ${channel === "tiktok" ? "TikTok" : "Meta"}?`)}
                        <ChevronDown className={cn("h-4 w-4 transition-transform", showGuide && "rotate-180")} />
                    </button>
                    {showGuide && <div className="mt-2"><ExportGuide channel={channel} ar={ar} /></div>}
                </div>

                {/* 2. The file */}
                <div className="space-y-2">
                    <div className="text-sm font-medium">{t("٢. الملف", "2. The file")}</div>
                    <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
                    <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-sm text-muted-foreground hover:bg-muted/40"
                    >
                        <FileSpreadsheet className="h-5 w-5" />
                        {file ? <span className="font-medium text-foreground" dir="ltr">{file.name}</span> : t("اختار ملف CSV أو Excel", "Choose a CSV or Excel file")}
                    </button>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox checked={addVat} onCheckedChange={v => setAddVat(v === true)} />
                        {t("ضيف ضريبة القيمة المضافة 14% على المصروف (اللي بتتخصم من الفيزا فعلاً)", "Add 14% VAT to the spend (what the card is actually charged)")}
                    </label>
                </div>

                {/* 3. Preview */}
                {report && (
                    <div className="space-y-3">
                        {report.errors.map((e, i) => (
                            <div key={i} className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {e}
                            </div>
                        ))}
                        {report.warnings.map((w, i) => (
                            <div key={i} className="flex gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
                            </div>
                        ))}

                        {!report.errors.length && (
                            <>
                                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                                    <Stat label={t("الفترة", "Dates")} value={<span dir="ltr">{shortDate(report.dateFrom)} → {shortDate(report.dateTo)}</span>} hint={report.dateFrom?.slice(0, 4)} />
                                    <Stat label={t("الإعلانات", "Ads")} value={adsInFile.length} />
                                    <Stat label={t("المصروف", "Spend")} value={formatCurrency(totalRaw * (addVat ? 1 + VAT : 1))} hint={addVat ? t(`${formatCurrency(totalRaw)} + ضريبة`, `${formatCurrency(totalRaw)} + VAT`) : undefined} />
                                    <Stat label={ar ? adChannelInfo(channel).resultLabel : adChannelInfo(channel).resultLabelEn} value={report.hasResults ? Math.round(totalResults).toLocaleString() : "—"} />
                                </div>

                                <div className="rounded-lg border">
                                    <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
                                        <span>{t("ربط الإعلانات بالمنتجات", "Ads and their products")}</span>
                                        {unlinked > 0
                                            ? <span className="text-xs text-amber-700 dark:text-amber-300">{t(`${unlinked} إعلان محتاج تختارله المنتج`, `${unlinked} need a product`)}</span>
                                            : <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />{t("كله متربط", "All linked")}</span>}
                                    </div>
                                    <div className="max-h-64 divide-y overflow-y-auto">
                                        {adsInFile.map(a => (
                                            <div key={a.key} className="flex flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-medium" dir="auto">{a.name}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {formatCurrency(a.spend * (addVat ? 1 + VAT : 1))}
                                                        {a.source === "auto" && <> · {t("اتربط تلقائي", "matched automatically")}</>}
                                                        {a.source === "saved" && <> · {t("متربط من قبل", "linked before")}</>}
                                                    </div>
                                                </div>
                                                <AdProductPicker
                                                    products={products}
                                                    value={a.productId}
                                                    ar={ar}
                                                    onChange={pid => setPicks(m => new Map(m).set(a.key, pid))}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                {unlinked > 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        {t("تقدر ترفع دلوقتي وتربطهم بعدين من جدول الإعلانات. مصروفهم هيتحسب في الإجمالي لحد ما تربطهم.",
                                            "You can upload now and link them later from the ads table. Their spend counts in the totals until then.")}
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                )}

                <DialogFooter>
                    <Button onClick={save} disabled={!report || !!report.errors.length || saving}>
                        {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Upload className="me-2 h-4 w-4" />}
                        {t("ارفع", "Upload")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
    return (
        <div className="rounded-md border p-2">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-semibold">{value}</div>
            {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
        </div>
    );
}
