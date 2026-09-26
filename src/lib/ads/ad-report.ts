/**
 * Reading an ad report exported from Meta Ads Manager or TikTok Ads Manager,
 * and working out which product each ad sells.
 *
 * The exports differ by platform, by language and by which columns the user
 * picked, so columns are found by name from a list of the names each platform
 * uses, not by position. Only the ad name, a date and the spend are required;
 * everything else is used when it is there.
 */

export type AdChannel = "messages" | "website" | "tiktok";

export interface AdChannelInfo {
    key: AdChannel;
    label: string;
    labelEn: string;
    /** What the report's result column counts, for this channel. */
    resultLabel: string;
    resultLabelEn: string;
    /** Order channels (lower-cased) whose orders these ads bring. */
    orderChannels: string[];
    /** PostgREST filter that fetches those orders; refined with `orderChannels` after. */
    orderFilter: string;
}

export const AD_CHANNELS: AdChannelInfo[] = [
    {
        key: "messages",
        label: "إعلانات رسائل",
        labelEn: "Message ads",
        resultLabel: "محادثات",
        resultLabelEn: "Conversations",
        orderChannels: ["facebook", "whatsapp", "instagram", "messenger"],
        orderFilter: "channel.ilike.*facebook*,channel.ilike.*whatsapp*,channel.ilike.*instagram*,channel.ilike.*messenger*",
    },
    {
        key: "website",
        label: "إعلانات موقع",
        labelEn: "Website ads",
        resultLabel: "مشتريات",
        resultLabelEn: "Purchases",
        orderChannels: ["website", "websit"],
        orderFilter: "channel.ilike.websit*",
    },
    {
        key: "tiktok",
        label: "إعلانات تيك توك",
        labelEn: "TikTok ads",
        resultLabel: "تحويلات",
        resultLabelEn: "Conversions",
        orderChannels: ["tiktok", "tiktok website"],
        orderFilter: "channel.ilike.tiktok*",
    },
];

export const adChannelInfo = (key: AdChannel) => AD_CHANNELS.find(c => c.key === key)!;

/** Whether an order's channel belongs to an ad channel. Order channels are typed by hand, so case and spaces vary. */
export function orderInAdChannel(orderChannel: string | null | undefined, ch: AdChannelInfo): boolean {
    const c = (orderChannel || "").toLowerCase().replace(/\s+/g, " ").trim();
    return ch.orderChannels.includes(c);
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const COLUMN_NAMES = {
    ad: ["ad name", "اسم الإعلان", "اسم الاعلان", "ad", "الإعلان"],
    day: ["day", "date", "by day", "stat time day", "اليوم", "التاريخ"],
    start: ["reporting starts", "بداية التقرير", "بدء التقرير", "start date"],
    end: ["reporting ends", "نهاية التقرير", "انتهاء التقرير", "end date"],
    spend: ["amount spent", "المبلغ الذي تم إنفاقه", "المبلغ المنفق", "cost", "spend", "total cost", "التكلفة"],
    impressions: ["impressions", "مرات الظهور"],
    reach: ["reach", "الوصول"],
    clicks: ["link clicks", "clicks (destination)", "clicks", "clicks (all)", "النقرات على الرابط", "النقرات"],
    currency: ["currency", "العملة"],
} as const;

const RESULT_NAMES: Record<AdChannel, string[]> = {
    messages: [
        "messaging conversations started", "messaging conversations", "new messaging contacts",
        "بدء محادثات المراسلة", "محادثات المراسلة التي بدأت", "محادثات المراسلة", "results", "النتائج",
    ],
    website: ["purchases", "website purchases", "المشتريات", "مشتريات الموقع", "results", "النتائج"],
    tiktok: ["conversions", "complete payment", "results", "التحويلات", "النتائج"],
};

/** "Amount spent (EGP)" → "amount spent": the currency in brackets varies by account. */
const headerKey = (h: unknown) =>
    String(h ?? "").replace(/^﻿/, "").replace(/\(.*?\)/g, "").replace(/[_:]/g, " ")
        .replace(/\s+/g, " ").trim().toLowerCase();

function findColumn(headers: string[], names: readonly string[]): number {
    for (const n of names) {
        const i = headers.indexOf(n);
        if (i >= 0) return i;
    }
    for (const n of names) {
        if (n.length < 4) continue; // "ad", "day": too short to match as a prefix
        const i = headers.findIndex(h => h.startsWith(n));
        if (i >= 0) return i;
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const ARABIC_DIGITS = /[٠-٩]/g;
const toLatinDigits = (s: string) => s.replace(ARABIC_DIGITS, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

export function toNumber(v: unknown): number {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const s = toLatinDigits(String(v ?? "")).replace(/[٬,\s]/g, "").replace("٫", ".").replace(/[^\d.\-]/g, "");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A report date as yyyy-MM-dd, or null. Meta writes 2026-09-26; spreadsheets turn it into dates or d/m/y. */
export function toIsoDate(v: unknown): string | null {
    if (v instanceof Date && !isNaN(v.getTime())) {
        return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    }
    const s = toLatinDigits(String(v ?? "")).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) {
        // Day first, as Egypt writes it, unless that cannot be a date.
        const [a, b] = [+m[1], +m[2]];
        const [d, mo] = b > 12 ? [b, a] : [a, b];
        return `${m[3]}-${pad(mo)}-${pad(d)}`;
    }
    return null;
}

export const adKey = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface AdReportRow {
    ad_name: string;
    date_from: string;
    date_to: string;
    spend_raw: number;
    impressions: number;
    reach: number;
    clicks: number;
    results: number;
}

export interface ParsedAdReport {
    rows: AdReportRow[];
    /** Problems that stop the upload. */
    errors: string[];
    /** Worth knowing, but the upload can go ahead. */
    warnings: string[];
    dateFrom: string | null;
    dateTo: string | null;
    daily: boolean;
    hasResults: boolean;
    currency: string | null;
}

/**
 * Rows of the sheet (header row included, anywhere in the first ten rows) into
 * one row per ad per period. Meta lists an ad once per ad set it runs in, so
 * rows with the same ad name and dates are added together.
 */
export function parseAdReport(sheet: unknown[][], channel: AdChannel, ar = true): ParsedAdReport {
    const t = (a: string, e: string) => (ar ? a : e);
    const empty: ParsedAdReport = { rows: [], errors: [], warnings: [], dateFrom: null, dateTo: null, daily: true, hasResults: false, currency: null };

    const headerAt = sheet.slice(0, 10).findIndex(r => findColumn((r || []).map(headerKey), COLUMN_NAMES.ad) >= 0);
    if (headerAt < 0) {
        return { ...empty, errors: [t("مش لاقي عمود \"Ad name\" (اسم الإعلان). اتأكد إنك نزّلت التقرير من تبويب الإعلانات (Ads) مش الحملات.", "No \"Ad name\" column. Export the report from the Ads tab, not Campaigns.")] };
    }
    const headers = sheet[headerAt].map(headerKey);
    const col = {
        ad: findColumn(headers, COLUMN_NAMES.ad),
        day: findColumn(headers, COLUMN_NAMES.day),
        start: findColumn(headers, COLUMN_NAMES.start),
        end: findColumn(headers, COLUMN_NAMES.end),
        spend: findColumn(headers, COLUMN_NAMES.spend),
        impressions: findColumn(headers, COLUMN_NAMES.impressions),
        reach: findColumn(headers, COLUMN_NAMES.reach),
        clicks: findColumn(headers, COLUMN_NAMES.clicks),
        currency: findColumn(headers, COLUMN_NAMES.currency),
        results: findColumn(headers, RESULT_NAMES[channel]),
    };

    const errors: string[] = [];
    if (col.spend < 0) errors.push(t("مش لاقي عمود المصروف (Amount spent / Cost).", "No spend column (Amount spent / Cost)."));
    if (col.day < 0 && col.start < 0) errors.push(t("مش لاقي عمود التاريخ (Day أو Reporting starts).", "No date column (Day or Reporting starts)."));
    if (errors.length) return { ...empty, errors };

    const warnings: string[] = [];
    const daily = col.day >= 0;
    if (!daily) warnings.push(t(
        "التقرير مش متقسم باليوم، فالمصروف هيتوزع بالتساوي على أيام الفترة. الأدق تنزّله بتقسيم يومي (Breakdown → Day).",
        "The report has no daily breakdown, so spend is spread evenly over its dates. A daily breakdown (Breakdown → Day) is more accurate."));
    if (col.results < 0) warnings.push(t(
        `مفيش عمود ${adChannelInfo(channel).resultLabel} في الملف، فتكلفة النتيجة ومعدل التحويل مش هيظهروا.`,
        `No ${adChannelInfo(channel).resultLabelEn.toLowerCase()} column, so cost per result and conversion rate will not show.`));

    const byKey = new Map<string, AdReportRow>();
    const currencies = new Set<string>();
    let skipped = 0;

    for (const r of sheet.slice(headerAt + 1)) {
        if (!r) continue;
        const name = String(r[col.ad] ?? "").replace(/\s+/g, " ").trim();
        // Blank names are the totals row Meta adds; TikTok writes "Total of N".
        if (!name || /^total\b/i.test(name) || name === "الإجمالي") continue;

        const from = toIsoDate(daily ? r[col.day] : r[col.start]);
        const to = daily ? from : (toIsoDate(r[col.end]) ?? from);
        if (!from || !to) { skipped++; continue; }
        if (col.currency >= 0 && r[col.currency]) currencies.add(String(r[col.currency]).trim().toUpperCase());

        const key = `${adKey(name)}|${from}|${to}`;
        const row = byKey.get(key) ?? { ad_name: name, date_from: from, date_to: to < from ? from : to, spend_raw: 0, impressions: 0, reach: 0, clicks: 0, results: 0 };
        row.spend_raw += toNumber(r[col.spend]);
        if (col.impressions >= 0) row.impressions += toNumber(r[col.impressions]);
        if (col.reach >= 0) row.reach += toNumber(r[col.reach]);
        if (col.clicks >= 0) row.clicks += toNumber(r[col.clicks]);
        if (col.results >= 0) row.results += toNumber(r[col.results]);
        byKey.set(key, row);
    }

    const rows = [...byKey.values()]
        .filter(r => r.spend_raw > 0 || r.results > 0 || r.impressions > 0)
        .map(r => ({ ...r, spend_raw: Math.round(r.spend_raw * 100) / 100 }));

    if (skipped) warnings.push(t(`${skipped} صف من غير تاريخ مفهوم واتشالوا.`, `${skipped} rows had an unreadable date and were left out.`));
    if (currencies.size && ![...currencies].every(c => c === "EGP")) warnings.push(t(
        `عملة الحساب ${[...currencies].join("، ")} مش جنيه — الأرقام هتتسجل زي ما هي.`,
        `The account currency is ${[...currencies].join(", ")}, not EGP — amounts are recorded as they are.`));
    if (!rows.length) errors.push(t("الملف مفيهوش أي إعلان عليه مصروف.", "The file has no ads with spend."));

    const dates = rows.flatMap(r => [r.date_from, r.date_to]).sort();
    return {
        rows, errors, warnings, daily,
        dateFrom: dates[0] ?? null,
        dateTo: dates[dates.length - 1] ?? null,
        hasResults: col.results >= 0,
        currency: currencies.size === 1 ? [...currencies][0] : null,
    };
}

// ---------------------------------------------------------------------------
// Which product an ad sells
// ---------------------------------------------------------------------------

export interface MatchableProduct {
    id: string;
    name: string;
    skus: string[];
}

const words = (s: string) => toLatinDigits(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
/** Product codes as the catalogue writes them: R41, PW2, E4G, MI33. At least one letter and one digit. */
const isCode = (w: string) => /^[a-z]{1,3}\d{1,4}[a-z]?$/.test(w) && w.length <= 6;
const STOP = new Set(["new", "copy", "ad", "ads", "video", "reel", "reels", "offer", "test", "the", "with", "and", "for", "pcs", "set", "جديد", "عرض", "اعلان", "إعلان", "فيديو", "نسخة"]);

/**
 * Finds the product an ad name refers to, or null when it cannot be sure.
 *
 * In order: the exact product name; then the product code in the ad name
 * ("Semo Acrylic organizer R41" → the product whose name or SKU is R41) — ad
 * names are usually shortened, the code rarely is; then, failing both, a name
 * whose words the ad name contains almost all of. A wrong link is worse than
 * none, since it moves spend onto the wrong product quietly, so a tie is left
 * for the user to pick.
 */
export function makeAdProductMatcher(products: MatchableProduct[]) {
    const byName = new Map<string, MatchableProduct[]>();
    const byCode = new Map<string, Set<MatchableProduct>>();
    const productWords = new Map<string, Set<string>>();

    for (const p of products) {
        const n = words(p.name).join(" ");
        if (!byName.has(n)) byName.set(n, []);
        byName.get(n)!.push(p);

        const codes = new Set(words(p.name).filter(isCode));
        for (const sku of p.skus) {
            const base = words(String(sku || "").split("-")[0])[0];
            if (base && isCode(base)) codes.add(base);
        }
        for (const c of codes) {
            if (!byCode.has(c)) byCode.set(c, new Set());
            byCode.get(c)!.add(p);
        }
        productWords.set(p.id, new Set(words(p.name).filter(w => w.length >= 3 && !STOP.has(w))));
    }

    const overlap = (adWords: Set<string>, p: MatchableProduct) => {
        const pw = productWords.get(p.id)!;
        if (!pw.size) return 0;
        let common = 0;
        for (const w of pw) if (adWords.has(w)) common++;
        return common / pw.size;
    };

    /** The single best candidate by shared words, or null on a tie. */
    const best = (adWords: Set<string>, candidates: MatchableProduct[], min: number) => {
        const scored = candidates.map(p => ({ p, s: overlap(adWords, p) })).sort((a, b) => b.s - a.s);
        if (!scored.length || scored[0].s < min) return null;
        if (scored.length > 1 && scored[1].s === scored[0].s) return null;
        return scored[0].p;
    };

    return (adName: string): MatchableProduct | null => {
        const aw = words(adName);
        const exact = byName.get(aw.join(" "));
        if (exact?.length === 1) return exact[0];

        const adWords = new Set(aw.filter(w => !STOP.has(w)));
        const codeHits = new Set<MatchableProduct>();
        for (const w of aw) if (isCode(w)) for (const p of byCode.get(w) ?? []) codeHits.add(p);
        if (codeHits.size === 1) return [...codeHits][0];
        if (codeHits.size > 1) return best(adWords, [...codeHits], 0.01);

        return best(adWords, products, 0.75);
    };
}
