/**
 * How likely a missed-order lead is to be a bot, 0–100, with the reasons in
 * words. 50 and up is treated as a bot. The page shows every reason, so a
 * moderator can see why and say "not a bot".
 *
 * Built from what the store script (public/leads.js) reports about how the
 * form was filled, and the request itself. Each signal on its own can happen
 * to a person — autofill types nothing, a fast typist is fast — so no single
 * soft signal reaches 50; it takes two, or one hard one (a headless browser,
 * an impossible phone, a request that did not come from the script).
 * The database adds one more: the same device typing many numbers in an hour.
 */

export interface LeadSignals {
    v?: number;            // script version: missing means the request did not come from the script
    inputs?: number;       // input events while filling the form
    pastes?: number;
    pointer?: number;      // mouse moves + touches
    dwellMs?: number;      // page open → phone complete
    fillMs?: number;       // first character of the phone → phone complete
    webdriver?: boolean;
    screen?: [number, number];
    tz?: string;
    lang?: string;
}

const BOT_UA = /bot|crawler|spider|crawl|headless|phantom|selenium|puppeteer|playwright|python|curl|wget|httpclient|okhttp|java\/|go-http|axios|node-fetch|scrapy/i;

export function isEgyptianMobile(phone: string) {
    return /^01[0125]\d{8}$/.test(phone);
}

/** 11 digits starting 01, from however it was typed (+20, 0020, spaces, Arabic digits). */
export function normalizeEgyptianPhone(raw: string): string {
    const western = (raw || "").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
    let d = western.replace(/\D/g, "");
    if (d.startsWith("0020")) d = d.slice(4);
    else if (d.startsWith("20") && d.length === 12) d = d.slice(2);
    if (d.length === 10 && d.startsWith("1")) d = `0${d}`;
    return d;
}

export function scoreLead(input: { phone: string; name?: string | null; userAgent?: string | null; signals?: LeadSignals | null }): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;
    const add = (points: number, reason: string) => { score += points; reasons.push(reason); };
    const s = input.signals || {};
    const phone = input.phone;
    const name = (input.name || "").trim();
    const ua = input.userAgent || "";

    // The phone
    if (!isEgyptianMobile(phone)) add(60, "رقم مش موبايل مصري صحيح");
    else {
        const body = phone.slice(3);
        if (/(\d)\1{6,}/.test(phone) || "0123456789012".includes(body) || "9876543210987".includes(body)) add(50, "رقم شكله وهمي (أرقام متكررة أو متسلسلة)");
    }

    // The name
    if (!name) add(10, "من غير اسم");
    else {
        if (/https?:|www\.|\.com\b/i.test(name)) add(50, "الاسم فيه لينك");
        if (/\d/.test(name)) add(25, "الاسم فيه أرقام");
        if (!/[\p{L}]/u.test(name)) add(30, "الاسم مافيهوش حروف");
        else if (name.replace(/\s/g, "").length < 2) add(20, "الاسم حرف واحد");
        if (/(.)\1{3,}/u.test(name)) add(25, "الاسم فيه حرف متكرر كتير");
        if (/^[a-z]+$/i.test(name.replace(/\s/g, "")) && /[bcdfghjklmnpqrstvwxz]{5,}/i.test(name)) add(25, "الاسم حروف عشوائية");
    }

    // The browser
    if (!ua) add(40, "مفيش بيانات متصفح");
    else if (BOT_UA.test(ua)) add(60, "المتصفح برنامج آلي");
    if (s.webdriver) add(60, "المتصفح متحكَّم فيه آليًا");

    // How the form was filled
    if (!s.v) add(50, "الطلب مش جاي من صفحة المتجر");
    else {
        const typed = (s.inputs || 0) > 0 || (s.pastes || 0) > 0;
        if (!typed) add(30, "الخانات اتملت من غير كتابة");
        if ((s.pointer || 0) === 0) add(20, "مفيش أي حركة ماوس أو لمس");
        if (typeof s.fillMs === "number" && s.fillMs >= 0 && s.fillMs < 700 && !(s.pastes || 0)) add(30, "الرقم اتكتب في أقل من ثانية");
        if (typeof s.dwellMs === "number" && s.dwellMs < 2500) add(20, "الصفحة اتقفلت في ثواني");
        if (s.screen && (s.screen[0] < 200 || s.screen[1] < 200)) add(15, "مقاس شاشة غريب");
    }

    return { score: Math.min(100, score), reasons };
}

export const BOT_THRESHOLD = 50;
