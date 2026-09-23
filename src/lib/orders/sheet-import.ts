/**
 * Orders from a spreadsheet.
 *
 * Merchants who sell from a Facebook or Instagram page have no store to
 * connect: their orders live in a sheet the moderators fill in all day. Typing
 * each one again into the new-order form was the reason they gave for not
 * starting. This reads that sheet — one row per product line, rows sharing an
 * order number become one order — checks every row the way the form would,
 * and says exactly which rows need fixing before anything is saved.
 *
 * Parsing is pure: nothing here talks to the database.
 */
import { normalizeEgyptianMobile } from "@/lib/support";
import { normalizeGovernorate } from "@/lib/governorates";
import { normalizeSearchText } from "@/lib/utils";

export const CHANNELS = ["Facebook", "Instagram", "Tiktok", "Tiktok Website", "Website", "Whatsapp"];

/** Template columns, in order. `required` columns must be filled on each order's first row. */
export const SHEET_COLUMNS = [
    { key: "order", header: "رقم الأوردر (اختياري)", example: "1", note: "صفوف بنفس الرقم = أوردر واحد فيه أكتر من منتج" },
    { key: "name", header: "اسم العميل", example: "منى أحمد", required: true },
    { key: "phone", header: "الموبايل", example: "01012345678", required: true },
    { key: "phone2", header: "موبايل 2", example: "" },
    { key: "governorate", header: "المحافظة", example: "القاهرة", required: true },
    { key: "address", header: "العنوان", example: "مدينة نصر، شارع عباس العقاد، عمارة 5", required: true },
    { key: "product", header: "المنتج (الكود أو الاسم)", example: "منظم مكياج", required: true },
    { key: "variant", header: "اللون / المقاس", example: "" },
    { key: "quantity", header: "الكمية", example: "1" },
    { key: "price", header: "سعر القطعة (اختياري)", example: "" },
    { key: "shipping", header: "الشحن على العميل", example: "60" },
    { key: "paid", header: "المدفوع مقدماً", example: "0" },
    { key: "channel", header: "القناة", example: "Facebook" },
    { key: "notes", header: "ملاحظات", example: "" },
] as const;

type ColumnKey = typeof SHEET_COLUMNS[number]["key"];

/** What people actually title these columns, besides the template's own header. */
const HEADER_ALIASES: Record<ColumnKey, string[]> = {
    order: ["رقم الأوردر", "رقم الطلب", "الأوردر", "order", "order id", "order no", "#"],
    name: ["اسم العميل", "الاسم", "العميل", "اسم", "name", "customer", "customer name"],
    phone: ["الموبايل", "موبايل", "رقم الموبايل", "التليفون", "رقم التليفون", "الهاتف", "رقم الهاتف", "موبايل 1", "phone", "mobile", "phone 1"],
    phone2: ["موبايل 2", "موبايل تاني", "رقم تاني", "تليفون 2", "phone 2", "phone2", "mobile 2"],
    governorate: ["المحافظة", "محافظة", "المحافظه", "المدينة", "governorate", "gov", "city"],
    address: ["العنوان", "عنوان", "address"],
    product: ["المنتج", "اسم المنتج", "الكود", "كود المنتج", "product", "sku", "item"],
    variant: ["اللون / المقاس", "اللون", "المقاس", "النوع", "variant", "color", "size"],
    quantity: ["الكمية", "العدد", "كمية", "quantity", "qty"],
    price: ["سعر القطعة", "السعر", "سعر", "price"],
    shipping: ["الشحن على العميل", "الشحن", "مصاريف الشحن", "shipping"],
    paid: ["المدفوع مقدماً", "المدفوع", "العربون", "مقدم", "paid", "deposit"],
    channel: ["القناة", "المصدر", "channel", "source"],
    notes: ["ملاحظات", "ملاحظة", "notes", "note"],
};

const foldHeader = (s: unknown) => normalizeSearchText(String(s ?? ""))
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9؀-ۿ#]+/g, "");

const HEADER_INDEX = new Map<string, ColumnKey>();
for (const col of SHEET_COLUMNS) {
    HEADER_INDEX.set(foldHeader(col.header), col.key);
    for (const alias of HEADER_ALIASES[col.key]) HEADER_INDEX.set(foldHeader(alias), col.key);
}

export interface CatalogVariant {
    id: string;
    title: string | null;
    sku: string | null;
    sale_price: number | null;
    cost_price: number | null;
    product_name: string;
    /** The product's short Arabic name (first line of its description), matched as well as the name. */
    arabic_name?: string | null;
}

export interface ParsedLine {
    variantId: string;
    label: string;
    quantity: number;
    price: number;
    cost: number;
}

export interface ParsedOrder {
    key: string;
    /** 1-based sheet row numbers, header being row 1, for messages people can find. */
    rows: number[];
    name: string;
    phone: string;
    phone2: string;
    governorate: string;
    address: string;
    channel: string;
    notes: string;
    shipping: number;
    paid: number;
    lines: ParsedLine[];
    errors: string[];
    subtotal: number;
    total: number;
    totalCost: number;
}

export interface ParseResult {
    orders: ParsedOrder[];
    /** Problems with the sheet as a whole, e.g. a missing column. */
    sheetErrors: string[];
    missingColumns: string[];
}

const num = (v: unknown): number | null => {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const s = String(v)
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
        .replace(/[,٬\s]/g, "").replace(/٫/g, ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
};
const text = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const skuKey = (s: unknown) => String(s ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
const nameKey = (s: unknown) => normalizeSearchText(text(s));

function matchChannel(raw: string, fallback: string): string {
    const k = raw.toLowerCase().replace(/\s+/g, "");
    if (!k) return fallback;
    const map: Record<string, string> = {
        facebook: "Facebook", fb: "Facebook", "فيسبوك": "Facebook", "فيس": "Facebook", "فيسبوك ماسنجر": "Facebook", messenger: "Facebook",
        instagram: "Instagram", insta: "Instagram", "انستجرام": "Instagram", "انستا": "Instagram",
        tiktok: "Tiktok", "تيك توك": "Tiktok", "تيكتوك": "Tiktok",
        website: "Website", "الموقع": "Website", "موقع": "Website",
        whatsapp: "Whatsapp", "واتساب": "Whatsapp", "واتس": "Whatsapp",
    };
    return map[k] || CHANNELS.find(c => c.toLowerCase().replace(/\s+/g, "") === k) || fallback;
}

/** Find the product a row names: by code first, then by name, then by "name - option". */
export function makeProductMatcher(catalog: CatalogVariant[]) {
    const bySku = new Map<string, CatalogVariant>();
    const byName = new Map<string, CatalogVariant[]>();
    for (const v of catalog) {
        const s = skuKey(v.sku);
        if (s && !bySku.has(s)) bySku.set(s, v);
        for (const n of new Set([nameKey(v.product_name), nameKey(v.arabic_name)].filter(Boolean))) {
            if (!byName.has(n)) byName.set(n, []);
            byName.get(n)!.push(v);
        }
    }
    const pickOption = (options: CatalogVariant[], option: string) =>
        options.find(v => nameKey(v.title) === nameKey(option));

    return (product: string, option: string): { variant?: CatalogVariant; error?: string } => {
        const sku = bySku.get(skuKey(product));
        if (sku && skuKey(product)) return { variant: sku };

        let options = byName.get(nameKey(product));
        let wanted = option;
        if (!options) {
            // "Product - Red" written in one cell.
            const cut = product.lastIndexOf(" - ");
            if (cut > 0) {
                options = byName.get(nameKey(product.slice(0, cut)));
                wanted = wanted || product.slice(cut + 3);
            }
        }
        if (!options?.length) return { error: `المنتج "${product}" مش موجود في منتجاتك (بندوّر بالكود أو بالاسم زي ما هو مكتوب في المنتجات)` };
        if (options.length === 1) return { variant: options[0] };
        // Two different products share this name (usually a short Arabic one,
        // e.g. two ceramic mugs): only the code can tell them apart.
        const distinct = [...new Set(options.map(o => o.product_name))];
        if (distinct.length > 1) {
            const chosen = wanted ? pickOption(options, wanted) : undefined;
            if (chosen) return { variant: chosen };
            return { error: `فيه أكتر من منتج بالاسم "${product}" — اكتب الكود بدل الاسم (${options.map(o => o.sku || o.product_name).join("، ")})` };
        }
        if (!wanted) return { error: `المنتج "${product}" ليه أكتر من نوع — اكتب اللون أو المقاس (${options.map(v => v.title).join("، ")})` };
        const v = pickOption(options, wanted);
        return v ? { variant: v } : { error: `النوع "${wanted}" مش موجود في "${product}" (الموجود: ${options.map(o => o.title).join("، ")})` };
    };
}

/**
 * Turn sheet rows (as arrays, header first) into orders ready to save.
 * `defaultChannel` fills rows that leave the channel blank.
 */
export function parseOrderSheet(rows: unknown[][], catalog: CatalogVariant[], defaultChannel: string): ParseResult {
    const sheetErrors: string[] = [];
    const headerRowIndex = rows.findIndex(r => (r || []).some(c => HEADER_INDEX.has(foldHeader(c))));
    if (headerRowIndex < 0) {
        return { orders: [], sheetErrors: ["مالقيناش صف العناوين. استخدم الشيت الجاهز أو خلّي أول صف فيه أسماء الأعمدة."], missingColumns: [] };
    }
    const header = rows[headerRowIndex] || [];
    const colOf = new Map<ColumnKey, number>();
    header.forEach((cell, i) => {
        const key = HEADER_INDEX.get(foldHeader(cell));
        if (key && !colOf.has(key)) colOf.set(key, i);
    });
    const missingColumns = SHEET_COLUMNS
        .filter(c => "required" in c && c.required && !colOf.has(c.key))
        .map(c => c.header);
    if (missingColumns.length) {
        return { orders: [], sheetErrors: [`الأعمدة دي ناقصة: ${missingColumns.join("، ")}`], missingColumns };
    }

    const get = (row: unknown[], key: ColumnKey) => {
        const i = colOf.get(key);
        return i === undefined ? "" : row[i];
    };
    const match = makeProductMatcher(catalog);
    const groups = new Map<string, ParsedOrder>();

    rows.slice(headerRowIndex + 1).forEach((row, offset) => {
        if (!row || row.every(c => text(c) === "")) return;
        const sheetRow = headerRowIndex + offset + 2;
        const orderRef = text(get(row, "order"));
        const key = orderRef ? `o:${orderRef}` : `r:${sheetRow}`;

        let order = groups.get(key);
        if (!order) {
            const rawPhone = text(get(row, "phone"));
            const rawPhone2 = text(get(row, "phone2"));
            const rawGov = text(get(row, "governorate"));
            const shipping = num(get(row, "shipping"));
            const paid = num(get(row, "paid"));
            order = {
                key, rows: [], lines: [], errors: [],
                name: text(get(row, "name")),
                phone: normalizeEgyptianMobile(rawPhone) || rawPhone,
                phone2: rawPhone2 ? (normalizeEgyptianMobile(rawPhone2) || rawPhone2) : "",
                governorate: normalizeGovernorate(rawGov) || rawGov,
                address: text(get(row, "address")),
                channel: matchChannel(text(get(row, "channel")), defaultChannel),
                notes: text(get(row, "notes")),
                shipping: shipping === null || Number.isNaN(shipping) ? 0 : shipping,
                paid: paid === null || Number.isNaN(paid) ? 0 : paid,
                subtotal: 0, total: 0, totalCost: 0,
            };
            if (!order.name) order.errors.push("اسم العميل فاضي");
            if (!normalizeEgyptianMobile(rawPhone)) order.errors.push(`الموبايل "${rawPhone || "فاضي"}" مش رقم موبايل مصري صحيح`);
            if (rawPhone2 && !normalizeEgyptianMobile(rawPhone2)) order.errors.push(`موبايل 2 "${rawPhone2}" مش رقم صحيح`);
            if (!normalizeGovernorate(rawGov)) order.errors.push(`المحافظة "${rawGov || "فاضية"}" مش معروفة`);
            if (!order.address) order.errors.push("العنوان فاضي");
            if (Number.isNaN(shipping ?? 0) || (shipping ?? 0) < 0) order.errors.push("الشحن لازم يكون رقم");
            if (Number.isNaN(paid ?? 0) || (paid ?? 0) < 0) order.errors.push("المدفوع مقدماً لازم يكون رقم");
            groups.set(key, order);
        }
        order.rows.push(sheetRow);

        const product = text(get(row, "product"));
        const option = text(get(row, "variant"));
        const qty = num(get(row, "quantity"));
        const price = num(get(row, "price"));
        if (!product) { order.errors.push(`صف ${sheetRow}: المنتج فاضي`); return; }
        const found = match(product, option);
        if (!found.variant) { order.errors.push(`صف ${sheetRow}: ${found.error}`); return; }
        const quantity = qty === null ? 1 : qty;
        if (Number.isNaN(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
            order.errors.push(`صف ${sheetRow}: الكمية لازم تكون رقم صحيح أكبر من صفر`);
            return;
        }
        if (price !== null && (Number.isNaN(price) || price < 0)) {
            order.errors.push(`صف ${sheetRow}: السعر لازم يكون رقم`);
            return;
        }
        const v = found.variant;
        order.lines.push({
            variantId: v.id,
            label: v.title && v.title !== "Default" ? `${v.product_name} - ${v.title}` : v.product_name,
            quantity,
            price: price === null ? Number(v.sale_price) || 0 : price,
            cost: Number(v.cost_price) || 0,
        });
    });

    const orders = [...groups.values()].map(o => {
        o.subtotal = o.lines.reduce((a, l) => a + l.price * l.quantity, 0);
        o.total = o.subtotal + o.shipping;
        o.totalCost = o.lines.reduce((a, l) => a + l.cost * l.quantity, 0);
        // Row-level product errors already say why there are no lines.
        if (!o.lines.length && !o.errors.some(e => e.startsWith("صف "))) o.errors.push("مفيش منتجات في الأوردر");
        if (o.paid > o.total) o.errors.push(`المدفوع مقدماً (${o.paid}) أكبر من إجمالي الأوردر (${o.total})`);
        return o;
    });
    if (!orders.length) sheetErrors.push("الشيت مفيهوش أوردرات.");
    return { orders, sheetErrors, missingColumns: [] };
}

/** A stable fingerprint, so the same sheet uploaded twice does not create orders twice. */
export function orderFingerprint(phone: string, total: number): string {
    return `${normalizeEgyptianMobile(phone) || phone}|${Math.round(total)}`;
}
