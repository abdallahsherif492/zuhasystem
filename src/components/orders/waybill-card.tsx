"use client";

import Image from "next/image";
import { Cairo } from "next/font/google";
import { format } from "date-fns";
import Barcode from "react-barcode";
import { arabicProductLabel } from "@/lib/orders/product-label";
import { governorateArabic } from "@/lib/governorates";
import { refusalNoteFor, waybillSettingsOf, type WaybillTemplate } from "@/lib/orders/waybill-settings";

// The waybill is read by couriers, most of whom read Arabic first, and it is
// printed on whatever office printer is at hand. A font the page brings with
// it, in weights that survive a cheap laser, rather than whichever Arabic
// fallback the printing PC happens to have.
const waybillFont = Cairo({ subsets: ["arabic", "latin"], weight: ["600", "700", "800", "900"], display: "swap" });

export type WaybillOrder = {
    id: string;
    created_at: string;
    status: string;
    total_amount: number;
    subtotal: number;
    discount: number;
    shipping_cost: number;
    /** What the courier charges us; the refusal note's amount on free shipping. */
    actual_shipping_cost?: number | null;
    notes?: string;
    customer_info: {
        name: string;
        phone: string;
        phone2?: string;
        address: string;
        governorate: string;
    };
    items: Array<{
        quantity: number;
        price_at_sale: number;
        variant: {
            title: string;
            product: {
                name: string;
                description?: string | null;
            };
        };
    }>;
    payment_status?: string;
    paid_amount?: number;
    order_type?: string;
};

type Business = { name?: string | null; logo_url?: string | null; theme_config?: { waybill?: object } | null } | null | undefined;

/** More lines than this and the rest are summed up in one, to keep to 98mm. */
const MAX_ITEMS = 14;

const money = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * "Portable Washing Machine PW2 - Purple" → "PW2 · Purple". Beside the Arabic
 * name, the catalogue code and the variant are what tell two lines apart, and
 * they fit where the full English name would be cut.
 */
function shortName(name: string, variant: string | null): string {
    const code = (name.match(/\b[A-Z]{1,4}\d{1,3}[A-Z]?\b/g) || []).pop();
    return [code, variant].filter(Boolean).join(" · ") || [name, variant].filter(Boolean).join(" - ");
}

/**
 * One 98mm waybill; three fill an A4 sheet. Settings → Waybill picks one of
 * three layouts (lib/orders/waybill-settings.ts), all of them black on white:
 *   courier    — cash and barcode on a rail, the brand boxed under them
 *   ticket     — a stub for the customer with the logo large, the rest for the courier
 *   letterhead — logo and thanks across the top, three columns under them
 * In each, the customer's number is the largest type after the amount to
 * collect: it is how the parcel gets delivered at all.
 */
export function WaybillCard({ order, business }: { order: WaybillOrder, isFirstOnPage?: boolean, business: Business }) {
    const waybill = waybillSettingsOf(business?.theme_config);
    const ci = order.customer_info || ({} as WaybillOrder["customer_info"]);
    const phones = [ci.phone, ci.phone2].filter(Boolean);
    const governorate = governorateArabic(ci.governorate) || ci.governorate || "";
    const stamp = order.order_type === "replacement" ? "استبدال" : order.order_type === "return" ? "استرجاع" : null;

    let collect = order.total_amount;
    if (order.payment_status === "Paid") collect = 0;
    else if (order.payment_status === "Partially Paid") collect = Math.max(0, order.total_amount - (order.paid_amount || 0));
    const paid = order.payment_status === "Paid" ? order.total_amount : order.payment_status === "Partially Paid" ? order.paid_amount || 0 : 0;
    const math = [
        `${money(order.subtotal || 0)} منتجات`,
        order.shipping_cost > 0 ? `+ ${money(order.shipping_cost)} شحن` : "شحن مجاني",
        order.discount > 0 ? `− ${money(order.discount)} خصم` : "",
        order.payment_status === "Partially Paid" && paid > 0 ? `− ${money(paid)} عربون` : "",
    ].filter(Boolean).join(" ");

    const notes = [order.notes, waybill.fixedNote].map(n => (n || "").trim()).filter(Boolean).join(" | ");
    const refusal = refusalNoteFor(waybill, order.shipping_cost, order.actual_shipping_cost);

    const shown = order.items.slice(0, MAX_ITEMS);
    const extra = order.items.length - shown.length;
    const lines = shown.length + (extra > 0 ? 1 : 0);
    // Fewer lines, larger type: the box is the same size either way.
    const density = lines <= 2 ? "big" : lines <= 4 ? "normal" : "dense";
    const ref = order.id.slice(0, 8);

    const to = (
        <>
            <div className="wb-name">
                <span>{ci.name}</span>
                {stamp && <span className="wb-stamp">{stamp}</span>}
            </div>
            <div className="wb-phones">{phones.map(p => <span key={p}>{p}</span>)}</div>
            <div className="wb-addr">{governorate && <b>{governorate}، </b>}{ci.address}</div>
        </>
    );
    const items = (
        <ul className="wb-items" data-d={density} data-n={lines} style={{ ["--rows" as string]: Math.ceil(lines / 2) }}>
            {shown.map((item, idx) => {
                const name = (item.variant?.product?.name || "منتج").replace(/\s+/g, " ").trim();
                const variant = item.variant?.title && item.variant.title !== "Default" ? item.variant.title : null;
                const arabic = arabicProductLabel(item.variant?.product?.description);
                const english = density !== "big" && arabic ? shortName(name, variant) : [name, variant].filter(Boolean).join(" - ");
                return (
                    <li key={idx}>
                        <span className="wb-q">{item.quantity}</span>
                        <span className="wb-nm">
                            {arabic && <b>{arabic} </b>}
                            <bdi className="wb-en" dir="ltr">{english}</bdi>
                        </span>
                    </li>
                );
            })}
            {extra > 0 && (
                <li><span className="wb-q">+</span><span className="wb-nm">{extra} منتجات كمان، تفاصيلهم في الفاتورة</span></li>
            )}
        </ul>
    );
    const notesLine = notes ? <div className="wb-notes"><span>ملاحظات: </span>{notes}</div> : null;
    const cash = collect > 0 ? (
        <div className="wb-cash">
            <div className="wb-cash-l">المطلوب تحصيله</div>
            <div className="wb-cash-amt">{money(collect)} <small>ج</small></div>
            <div className="wb-cash-math">{math}</div>
        </div>
    ) : (
        <div className="wb-cash wb-cash-paid">
            <div className="wb-cash-l">مدفوع بالكامل</div>
            <div className="wb-cash-amt">لا تحصّل</div>
        </div>
    );
    const code = (
        <div className="wb-code">
            <div className="wb-bars"><Barcode value={ref} renderer="img" width={2} height={80} margin={0} displayValue={false} /></div>
            <div className="wb-ref"><span>#{ref}</span><span>{format(new Date(order.created_at), "dd/MM/yyyy")}</span></div>
        </div>
    );
    const refusalLine = refusal ? <div className="wb-refuse">{refusal}</div> : null;
    const logo = business?.logo_url ? (
        <div className="wb-logo"><Image src={business.logo_url} alt={business?.name || ""} fill sizes="180px" className="object-contain" /></div>
    ) : (
        <div className="wb-logo wb-logo-text">{business?.name}</div>
    );
    const offer = waybill.offer.trim() || waybill.promoCode.trim() ? (
        <div className="wb-offer">
            {waybill.offer.trim() && <span>{waybill.offer}</span>}
            {waybill.promoCode.trim() && <bdi className="wb-promo" dir="ltr">{waybill.promoCode}</bdi>}
        </div>
    ) : null;
    // What the store says to the customer: thanks, then the offer, then how to reach it.
    const words = (
        <>
            {waybill.thanks.trim() && <div className="wb-thanks">{waybill.thanks}</div>}
            {offer}
            {waybill.storePhone.trim() && <div className="wb-store-phone">{waybill.storePhone}</div>}
        </>
    );
    const brand = <>{logo}{words}</>;

    const template: WaybillTemplate = waybill.template;
    return (
        <section dir="rtl" className={`wb wb-${template} ${waybillFont.className}`}>
            <style>{WAYBILL_CSS}</style>
            {template === "courier" && (
                <>
                    <div className="wb-main"><div className="wb-to">{to}</div>{items}{notesLine}</div>
                    <div className="wb-rail">{cash}{code}<div className="wb-brand">{brand}</div></div>
                    {refusalLine}
                </>
            )}
            {template === "ticket" && (
                <>
                    <div className="wb-body">
                        <div className="wb-top"><div className="wb-to">{to}</div>{cash}</div>
                        <div className="wb-mid">{items}{code}</div>
                        {notesLine}
                        {refusalLine}
                    </div>
                    <div className="wb-stub">{brand}</div>
                </>
            )}
            {template === "letterhead" && (
                <>
                    <div className="wb-head">{logo}<div className="wb-words">{words}</div>{code}</div>
                    <div className="wb-cols"><div className="wb-to">{to}</div><div className="wb-what">{items}{notesLine}</div>{cash}</div>
                    {refusalLine}
                </>
            )}
        </section>
    );
}

// Plain CSS rather than utility classes: three layouts in millimetres and
// points, for paper. Grey prints as a faint smudge on most office printers,
// so everything is black.
const WAYBILL_CSS = `
.wb { position: relative; box-sizing: border-box; height: 98mm; width: 100%; overflow: hidden; padding: 4mm 5mm 3.5mm; background: #fff; color: #000; }
.wb * { box-sizing: border-box; margin: 0; padding: 0; }
.wb + .wb { border-top: 0.4mm dashed #000; }
.wb b { font-weight: 900; }

.wb-name { display: flex; align-items: center; gap: 2mm; font-size: 15pt; font-weight: 800; line-height: 1.25; }
.wb-name > span:first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; }
.wb-stamp { flex: none; font-size: 11pt; font-weight: 900; background: #000; color: #fff; padding: 0 2.5mm; border-radius: 1mm; }
.wb-phones { display: flex; flex-wrap: wrap; gap: 0 5mm; font-size: 22pt; font-weight: 900; line-height: 1.15; letter-spacing: 0.4pt; }
.wb-phones span { direction: ltr; unicode-bidi: isolate; }
.wb-phones span + span { font-size: 0.82em; font-weight: 800; }
.wb-addr { font-size: 11.5pt; font-weight: 700; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.wb-items { list-style: none; display: flex; flex-direction: column; justify-content: center; gap: 1.2mm; min-height: 0; overflow: hidden; }
.wb-items li { display: grid; grid-template-columns: 9mm 1fr; align-items: baseline; gap: 2mm; font-size: 12pt; font-weight: 700; line-height: 1.3; min-width: 0; }
.wb-q { font-size: 15pt; font-weight: 900; text-align: center; border: 0.5mm solid #000; border-radius: 1mm; line-height: 1.15; }
.wb-nm { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-width: 0; }
.wb-en { font-weight: 600; font-size: 0.82em; }
.wb-items[data-d="big"] li { font-size: 14pt; }
.wb-items[data-d="big"] .wb-q { font-size: 19pt; }
.wb-items[data-n="1"] li { grid-template-columns: 13mm 1fr; font-size: 16pt; }
.wb-items[data-n="1"] .wb-q { font-size: 22pt; }
/* Five lines or more: two columns, one line each, filled top to bottom. */
.wb-items[data-d="dense"] { display: grid; grid-auto-flow: column; grid-template-rows: repeat(var(--rows), auto); grid-template-columns: 1fr 1fr; column-gap: 4mm; row-gap: 0.5mm; align-content: center; }
.wb-items[data-d="dense"] li { grid-template-columns: 7mm 1fr; font-size: 9.5pt; line-height: 1.2; }
.wb-items[data-d="dense"] .wb-q { font-size: 10pt; line-height: 1.05; }
.wb-items[data-d="dense"] .wb-nm { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.wb-notes { font-size: 10.5pt; font-weight: 800; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; border-top: 0.25mm solid #000; padding-top: 1mm; }
.wb-notes span { font-weight: 700; }

.wb-cash { background: #000; color: #fff; border-radius: 1.5mm; padding: 1.8mm 3mm 2.2mm; text-align: center; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.wb-cash-l { font-size: 10pt; font-weight: 800; }
.wb-cash-amt { font-size: 28pt; font-weight: 900; line-height: 1; }
.wb-cash-amt small { font-size: 12pt; font-weight: 800; }
.wb-cash-math { font-size: 8.5pt; font-weight: 700; margin-top: 1mm !important; border-top: 0.3mm solid #fff; padding-top: 1mm !important; }
.wb-cash-paid .wb-cash-amt { font-size: 21pt; }
.wb-stamp { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

.wb-code { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-height: 0; overflow: hidden; }
.wb-bars { min-height: 0; overflow: hidden; }
/* An image stretches to the box; bars keep their proportions across, which is what a scanner reads. */
.wb-bars img { display: block; width: 100%; height: 100%; object-fit: fill; }
.wb-ref { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 2mm; font-size: 9.5pt; font-weight: 800; direction: ltr; }
.wb-refuse { border: 0.6mm solid #000; border-radius: 1mm; text-align: center; font-size: 11.5pt; font-weight: 900; padding: 0.8mm 3mm !important; }

.wb-logo { position: relative; filter: grayscale(1) contrast(1.6); }
.wb-logo-text { display: flex; align-items: center; justify-content: center; font-size: 16pt; font-weight: 900; filter: none; text-align: center; }
.wb-thanks { font-weight: 800; line-height: 1.3; }
.wb-store-phone { font-weight: 800; direction: ltr; unicode-bidi: isolate; }
.wb-offer { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.5mm 2mm; font-weight: 800; line-height: 1.3; }
/* Cut-out look: a code the customer is meant to keep and type. */
.wb-promo { border: 0.5mm dashed #000; border-radius: 1mm; padding: 0 2mm !important; font-weight: 900; letter-spacing: 0.6pt; }

/* courier */
.wb-courier { display: grid; grid-template-columns: 1fr 56mm; grid-template-rows: minmax(0, 1fr) auto; gap: 2.5mm 4mm; }
.wb-courier .wb-main { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-width: 0; min-height: 0; }
.wb-courier .wb-to { padding-bottom: 2mm !important; border-bottom: 0.6mm solid #000; }
.wb-courier .wb-items { padding: 1.5mm 0 !important; }
.wb-courier .wb-rail { display: grid; grid-template-rows: auto minmax(12mm, 1fr) auto; gap: 1.2mm; min-width: 0; min-height: 0; }
.wb-courier .wb-cash { padding: 1.2mm 2mm 1.5mm; }
.wb-courier .wb-cash-amt { font-size: 26pt; }
.wb-courier .wb-cash-math { font-size: 7.5pt; }
.wb-courier .wb-brand { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.5mm; border: 0.4mm solid #000; border-radius: 1.5mm; padding: 1.5mm 2mm 1mm !important; }
.wb-courier .wb-logo { width: 46mm; height: 9mm; }
.wb-courier .wb-thanks, .wb-courier .wb-store-phone, .wb-courier .wb-offer { font-size: 8pt; line-height: 1.2; }
.wb-courier .wb-refuse { grid-column: 1 / -1; }

/* ticket */
.wb-ticket { display: grid; grid-template-columns: 1fr 52mm; padding: 0; }
.wb-ticket .wb-body { padding: 4mm 5mm 3.5mm 4mm !important; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: 2mm; min-width: 0; min-height: 0; }
.wb-ticket .wb-top { display: grid; grid-template-columns: 1fr 50mm; gap: 3mm; align-items: start; padding-bottom: 2mm !important; border-bottom: 0.6mm solid #000; }
.wb-ticket .wb-to { min-width: 0; }
.wb-ticket .wb-mid { display: grid; grid-template-columns: 1fr 36mm; gap: 3mm; min-height: 0; }
.wb-ticket .wb-cash-math { font-size: 7.5pt; }
.wb-ticket .wb-bars { min-height: 10mm; }
.wb-ticket .wb-stub { border-inline-start: 0.5mm dashed #000; padding: 4mm !important; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 2mm; }
.wb-ticket .wb-logo { width: 44mm; height: 34mm; }
.wb-ticket .wb-thanks { font-size: 11pt; }
.wb-ticket .wb-store-phone { font-size: 10pt; }
.wb-ticket .wb-offer { font-size: 10pt; }

/* letterhead */
.wb-letterhead { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 2mm; }
.wb-letterhead .wb-head { display: grid; grid-template-columns: 42mm 1fr 52mm; align-items: center; gap: 3mm; padding-bottom: 2mm !important; border-bottom: 0.6mm solid #000; }
.wb-letterhead .wb-logo { width: 42mm; height: 24mm; }
.wb-letterhead .wb-thanks { font-size: 12.5pt; }
.wb-letterhead .wb-store-phone { font-size: 10pt; }
.wb-letterhead .wb-offer { justify-content: flex-start; font-size: 10.5pt; }
.wb-letterhead .wb-bars { height: 13mm; }
.wb-letterhead .wb-cols { display: grid; grid-template-columns: 0.85fr 1.5fr 42mm; gap: 4mm; min-height: 0; }
.wb-letterhead .wb-name > span:first-child { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.wb-letterhead .wb-to { border-inline-end: 0.25mm solid #000; padding-inline-end: 3mm !important; min-width: 0; }
.wb-letterhead .wb-phones { font-size: 18pt; flex-direction: column; }
.wb-letterhead .wb-addr { -webkit-line-clamp: 3; font-size: 11pt; }
.wb-letterhead .wb-what { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-height: 0; min-width: 0; }
.wb-letterhead .wb-items[data-d="dense"] li { font-size: 9pt; }
.wb-letterhead .wb-cash { display: flex; flex-direction: column; justify-content: center; }
`;
