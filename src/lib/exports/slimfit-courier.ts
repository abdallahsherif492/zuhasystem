import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

/**
 * SlimFit's courier sheet ("التسجيل"): the courier's own .xls template,
 * filled from orders. Only SlimFit ships with this courier, so the orders page
 * shows the button for that business alone.
 *
 * The columns are the template's, in its order and with its widths; the two
 * unlabelled columns after the area repeat the governorate and the area as the
 * template's formulas do, and the column after the address carries the
 * delivery note.
 */
export const SLIMFIT_BUSINESS_ID = "931ffe25-c2c5-4984-9d79-b82a3998ea65";

const HEADER = [
    "رقم", "اسم العميل", "المحمول", "التليفون", "المحافظة", "المنطقة", "", "", "العنوان", "", "اليوم", "التاريخ", "", "",
    "معاد التسليم",
    "منتج 1", "كمية 1", "سعر1", "الشحن",
    "منتج 2", "كمية 2", "سعر 2", "منتج 3", "كمية 3", "سعر 3 ", "منتج 4", "كمية 4", "سعر 4",
    "منتج 5", "كمية 5", "سعر 5", "منتج 6", "كمية 6", "سعر 6",
    "سنتر", "المندوب", "", "المدة", "من", "الى", "ترويج 1", "ترويج 2", "ترويج 3",
];
const WIDTHS = [7, 19, 13, 11.43, 9, 9, 9, 4, 30, 22, 7, 4, 4, 6, 10, 30, 5, 7, 6, 30, 5, 7, 30, 5, 7, 30, 5, 7, 30, 5, 7, 30, 5, 7, 6, 8, 4, 6, 6, 6, 8, 8, 8];
const MAX_PRODUCTS = 6;
const NO_PHONE = "ــــــــــــــــــــــــ";
const CALL_NOTE = "الاتصال قبل الوصول بساعة";
const DELIVERY_TIME = "ثلاثة ايام";
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** The app stores governorates in English; the courier's sheet takes Arabic. */
const GOVERNORATE_AR: Record<string, string> = {
    Cairo: "القاهرة", Giza: "الجيزة", Alexandria: "الاسكندرية", Qaliubiya: "القليوبية",
    Dakahlia: "الدقهلية", Sharkia: "الشرقية", Monufia: "المنوفية", Gharbiya: "الغربية",
    Beheira: "البحيرة", "Kafr Al Sheikh": "كفر الشيخ", Damietta: "دمياط", "Port Said": "بورسعيد",
    Ismailia: "الاسماعيلية", Suez: "السويس", Matrouh: "مطروح", "Red Sea": "البحر الاحمر",
    "North Sinai": "شمال سيناء", "South Sinai": "جنوب سيناء", "Beni Suef": "بني سويف",
    Minya: "المنيا", Fayoum: "الفيوم", Assiut: "اسيوط", Sohag: "سوهاج", Qena: "قنا",
    Luxor: "الاقصر", Aswan: "اسوان", "New Valley": "الوادي الجديد",
};

interface ExportOrder {
    id: string;
    customer_info: { name?: string; phone?: string; phone2?: string; address?: string; governorate?: string; raw_easyorders_gov?: string } | null;
    shipping_cost: number | null;
    total_amount: number | null;
    paid_amount: number | null;
    payment_status: string | null;
    notes: string | null;
    status: string | null;
    created_at: string;
    items: { quantity: number; price_at_sale: number | null; unmapped_name: string | null;
             variant: { title: string | null; product: { name: string | null } | null } | null }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One row per order. Prices are per piece, as the template's quantity and
 * price columns ask; the courier collects the lines plus shipping. When the
 * customer has already paid part of the order (a deposit) or all of it, that
 * comes off the shipping first and then off the products, so the sheet never
 * asks the courier to collect money already received.
 */
function rowFor(o: ExportOrder, serial: number, today: Date): { row: (string | number)[]; adjusted: boolean; overflow: boolean } {
    const ci = o.customer_info || {};
    const lines = (o.items || []).map(i => {
        const name = i.variant?.product?.name || i.unmapped_name || "منتج";
        const v = i.variant?.title && i.variant.title !== "Default" ? ` - ${i.variant.title}` : "";
        return { name: `${name}${v}`, qty: Number(i.quantity) || 1, price: Number(i.price_at_sale) || 0 };
    });

    let shipping = Number(o.shipping_cost) || 0;
    const gross = lines.reduce((s, l) => s + l.qty * l.price, 0) + shipping;
    const total = Number(o.total_amount) || gross;
    const due = o.payment_status === "Paid" ? 0 : Math.max(0, total - (Number(o.paid_amount) || 0));
    let reduce = round2(gross - due);
    const adjusted = reduce > 0.009;
    if (adjusted) {
        const off = Math.min(shipping, reduce); shipping = round2(shipping - off); reduce = round2(reduce - off);
        for (const l of lines) {
            if (reduce <= 0.009) break;
            const lineOff = Math.min(l.qty * l.price, reduce);
            l.price = round2(l.price - lineOff / l.qty); reduce = round2(reduce - lineOff);
        }
    }

    const products: (string | number)[] = [];
    for (let k = 0; k < MAX_PRODUCTS; k++) {
        const l = lines[k];
        const cells: (string | number)[] = l ? [l.name, l.qty, l.price] : ["", "", ""];
        if (k === 0) cells.push(shipping);
        products.push(...cells);
    }

    const gov = GOVERNORATE_AR[ci.governorate || ""] || ci.raw_easyorders_gov || ci.governorate || "";
    const note = [o.notes?.trim(), CALL_NOTE].filter(Boolean).join(" - ");

    return {
        row: [
            serial, ci.name?.trim() || "", ci.phone?.trim() || "", ci.phone2?.trim() || NO_PHONE,
            gov, "", gov, "", ci.address?.trim() || "", note,
            WEEKDAYS[today.getDay()], today.getDate(), today.getMonth() + 1, today.getFullYear(),
            DELIVERY_TIME,
            ...products,
            "", "", 0, "", "", "", "", "", "",
        ],
        adjusted,
        overflow: lines.length > MAX_PRODUCTS,
    };
}

async function fetchOrders(businessId: string, ids: string[]): Promise<ExportOrder[]> {
    const out: ExportOrder[] = [];
    // A few hundred ids in one filter overflows the request URL.
    for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await supabase
            .from("orders")
            .select("id, customer_info, shipping_cost, total_amount, paid_amount, payment_status, notes, status, created_at, items:order_items(quantity, price_at_sale, unmapped_name, variant:variants(title, product:products(name)))")
            .eq("business_id", businessId)
            .in("id", ids.slice(i, i + 100));
        if (error) throw error;
        out.push(...((data as unknown as ExportOrder[]) || []));
    }
    // Keep the order the page listed them in.
    const pos = new Map(ids.map((id, i) => [id, i]));
    return out.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
}

export interface SlimfitExportResult { count: number; adjusted: number; overflow: number; cancelled: number }

export async function exportSlimfitCourierSheet(businessId: string, ids: string[]): Promise<SlimfitExportResult> {
    const orders = await fetchOrders(businessId, ids);
    const today = new Date();
    const built = orders.map((o, i) => rowFor(o, i + 1, today));

    const ws = XLSX.utils.aoa_to_sheet([HEADER, ...built.map(b => b.row)]);
    // The template's two helper columns are formulas over the governorate and area.
    built.forEach((b, i) => {
        const r = i + 2;
        ws[`G${r}`] = { t: "s", v: String(b.row[6]), f: `E${r}` };
        ws[`H${r}`] = { t: "n", v: 0, f: `F${r}` };
    });
    ws["!cols"] = WIDTHS.map(w => ({ wch: w }));
    ws["!autofilter"] = { ref: `A1:AK${built.length + 1}` };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "التسجيل");
    wb.Workbook = { Views: [{ RTL: true }] } as XLSX.WorkBook["Workbook"];
    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(wb, `SlimFit_courier_${stamp}.xls`, { bookType: "biff8" });

    return {
        count: built.length,
        adjusted: built.filter(b => b.adjusted).length,
        overflow: built.filter(b => b.overflow).length,
        cancelled: orders.filter(o => ["Cancelled", "Unavailable"].includes(o.status || "")).length,
    };
}
