"use client";

import { Lightbulb } from "lucide-react";
import type { AdChannel } from "@/lib/ads/ad-report";

/**
 * How to get the report out of Meta or TikTok, step by step, for the channel
 * being uploaded. Menu names are given in English as the platforms show them,
 * with the Arabic interface's wording beside them, since people run either.
 */
const GUIDES: Record<AdChannel, { ar: string[]; en: string[]; columns: string }> = {
    messages: {
        ar: [
            "افتح Meta Ads Manager (adsmanager.facebook.com) واختار الحساب الإعلاني.",
            "ادخل على تبويب Ads (الإعلانات) — مش Campaigns ولا Ad sets.",
            "اختار الفترة اللي عايزها من التاريخ فوق على اليمين.",
            "من Breakdown (التقسيم) اختار By time → Day (حسب الوقت ← اليوم).",
            "من Columns (الأعمدة) → Customize columns اتأكد إن الأعمدة اللي تحت موجودة.",
            "من Reports (التقارير) → Export table data (تصدير بيانات الجدول) → اختار CSV أو Excel ونزّل الملف.",
        ],
        en: [
            "Open Meta Ads Manager (adsmanager.facebook.com) and pick the ad account.",
            "Go to the Ads tab — not Campaigns or Ad sets.",
            "Pick the date range at the top right.",
            "Breakdown → By time → Day.",
            "Columns → Customize columns: make sure the columns below are there.",
            "Reports → Export table data → CSV or Excel, and download it.",
        ],
        columns: "Ad name · Day · Amount spent · Impressions · Reach · Messaging conversations started",
    },
    website: {
        ar: [
            "افتح Meta Ads Manager واختار الحساب الإعلاني.",
            "ادخل على تبويب Ads (الإعلانات).",
            "اختار الفترة من التاريخ فوق على اليمين.",
            "من Breakdown (التقسيم) اختار By time → Day (اليوم).",
            "من Columns (الأعمدة) → Customize columns ضيف الأعمدة اللي تحت.",
            "من Reports → Export table data → CSV أو Excel.",
        ],
        en: [
            "Open Meta Ads Manager and pick the ad account.",
            "Go to the Ads tab.",
            "Pick the date range at the top right.",
            "Breakdown → By time → Day.",
            "Columns → Customize columns: add the columns below.",
            "Reports → Export table data → CSV or Excel.",
        ],
        columns: "Ad name · Day · Amount spent · Impressions · Reach · Link clicks · Purchases",
    },
    tiktok: {
        ar: [
            "افتح TikTok Ads Manager (ads.tiktok.com).",
            "من Analytics (التحليلات) → Custom reports اعمل تقرير جديد.",
            "في Dimensions (الأبعاد) اختار Ad name (اسم الإعلان) و Day (اليوم).",
            "في Metrics (المقاييس) اختار الأعمدة اللي تحت.",
            "اختار الفترة، وبعدين Export → CSV أو Excel.",
            "أو من تبويب Ads في Campaign: اختار الفترة ودوس على أيقونة التنزيل، بس كده التقرير مش هيبقى متقسم باليوم.",
        ],
        en: [
            "Open TikTok Ads Manager (ads.tiktok.com).",
            "Analytics → Custom reports → create a report.",
            "Dimensions: Ad name and Day.",
            "Metrics: the columns below.",
            "Pick the dates, then Export → CSV or Excel.",
            "Or from the Ads tab under Campaign: pick the dates and use the download icon — that report is not split by day.",
        ],
        columns: "Ad name · Day · Cost · Impressions · Reach · Clicks · Conversions",
    },
};

export function ExportGuide({ channel, ar }: { channel: AdChannel; ar: boolean }) {
    const g = GUIDES[channel];
    return (
        <div className="space-y-3 rounded-lg border bg-muted/40 p-4 text-sm">
            <ol className="list-decimal space-y-1.5 ps-5">
                {(ar ? g.ar : g.en).map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            <div>
                <div className="mb-1 font-medium">{ar ? "الأعمدة المطلوبة:" : "Columns needed:"}</div>
                <div className="rounded bg-background px-2 py-1.5 font-mono text-xs" dir="ltr">{g.columns}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                    {ar
                        ? "الأساسي: اسم الإعلان والتاريخ والمصروف. الباقي بيدّي تحليل أدق، ولو ناقص الملف هيترفع عادي."
                        : "Required: ad name, date and spend. The rest makes the analysis richer; the file uploads without them."}
                </p>
            </div>
            <div className="flex gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                    <p>{ar
                        ? "سمّي كل إعلان باسم المنتج أو كوده (زي \"Portable washer PW2\")، والسيستم هيربطه بالمنتج لوحده. أي إعلان مايتربطش تقدر تختارله المنتج بإيدك، ومرة واحدة بس."
                        : "Name each ad after its product or product code (e.g. \"Portable washer PW2\") and it links itself. Any ad that does not can be linked by hand, once."}</p>
                    <p>{ar
                        ? "رفع ملف لأيام اترفعت قبل كده بيستبدل القديم ومابيكررش المصروف."
                        : "Uploading a file for days already uploaded replaces them; spend is never counted twice."}</p>
                </div>
            </div>
        </div>
    );
}
