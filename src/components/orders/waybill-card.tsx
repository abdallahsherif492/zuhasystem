"use client";

import Image from "next/image";
import { Cairo } from "next/font/google";
import { format } from "date-fns";
import Barcode from "react-barcode";
import { arabicProductLabel } from "@/lib/orders/product-label";

// The waybill is read by couriers, most of whom read Arabic first, and it is
// printed on whatever office printer is at hand. A font the page brings with
// it, in weights that survive a cheap laser, rather than whichever Arabic
// fallback the printing PC happens to have.
const waybillFont = Cairo({ subsets: ["arabic", "latin"], weight: ["500", "700", "800"], display: "swap" });

export type WaybillOrder = {
    id: string;
    created_at: string;
    status: string;
    total_amount: number;
    subtotal: number;
    discount: number;
    shipping_cost: number;
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

/** One 98mm waybill; three fill an A4 sheet. */
export function WaybillCard({ order, isFirstOnPage, business }: { order: WaybillOrder, isFirstOnPage: boolean, business: any }) {
    const phone1 = order.customer_info?.phone || "";
    const phone2 = order.customer_info?.phone2;
    const combinedPhone = phone2 ? `${phone1} / ${phone2}` : phone1;

    const baseNotes = order.notes || "";
    const requestNotes = "قابل للكسر";
    const combinedNotes = baseNotes ? `${baseNotes} | ${requestNotes}` : requestNotes;

    // COD Calculation
    let collectAmount = order.total_amount;
    if (order.payment_status === "Paid") {
        collectAmount = 0;
    } else if (order.payment_status === "Partially Paid") {
        collectAmount = Math.max(0, order.total_amount - (order.paid_amount || 0));
    }

    return (
        <div className={`
             box-border w-full flex flex-col justify-between overflow-hidden bg-white p-3 text-black
             ${waybillFont.className}
             ${isFirstOnPage ? 'border-b-2 border-dashed border-black' : 'border-t-2 border-dashed border-black'}
        `} style={{ height: '98mm' }}>
            {/* Header */}
            <div className="flex justify-between items-start mb-0">
                <div className="flex items-center gap-2">
                    <div className="relative h-10 w-10 grayscale">
                        <Image src={business?.logo_url || "/logo.png"} alt={business?.name || "Logo"} fill className="object-contain" />
                    </div>
                    <div>
                        <h1 className="text-base font-bold leading-none">{business?.name || "eCommerx Home"}</h1>
                        <p className="text-[9px]">Fast & Reliable Shipping</p>
                    </div>
                </div>
                <div className="text-right">
                    <h2 className="text-lg font-bold uppercase leading-none">Waybill</h2>
                    {order.order_type === 'replacement' && (
                        <div className="border-4 border-black inline-block px-2 py-1 my-1 -rotate-6">
                            <span className="font-black text-xl">استبدال</span>
                        </div>
                    )}
                    {order.order_type === 'return' && (
                        <div className="border-4 border-black inline-block px-2 py-1 my-1 -rotate-6">
                            <span className="font-black text-xl">استرجاع</span>
                        </div>
                    )}
                    <div className="flex justify-end">
                        <Barcode value={order.id.slice(0, 8)} width={1} height={20} fontSize={9} displayValue={false} />
                    </div>
                    <p className="font-mono text-[10px] leading-none mt-0.5">{order.id.slice(0, 8)}</p>
                    <p className="text-[9px] leading-none">{format(new Date(order.created_at), "dd/MM/yyyy")}</p>
                </div>
            </div>

            {/* Grey text printed as a faint smudge on most office printers, so
                everything on the label is black now. */}
            <div className="grid grid-cols-2 gap-2 mb-1">
                <div>
                    <span className="font-bold uppercase block text-[8px]">Deliver To:</span>
                    <p className="font-bold text-xs leading-tight line-clamp-1">{order.customer_info.name}</p>
                    <p className="text-[10px] font-medium leading-tight">{combinedPhone}</p>
                    <p className="text-[10px] font-medium leading-tight mt-0.5 line-clamp-2">{order.customer_info.address}, {order.customer_info.governorate}</p>
                </div>
                <div>
                    <span className="font-bold uppercase block text-[8px]">Notes:</span>
                    <p className="font-bold text-[10px] bg-muted p-1 rounded min-h-[35px] leading-tight line-clamp-2">{combinedNotes}</p>
                </div>
            </div>

            {/* Items. What the courier hands over, so it is the largest and
                darkest text on the label after the amount: the name as it is
                in the catalogue, and in brackets what the thing actually is,
                in Arabic. Two lines per item instead of one cut off at 150px;
                three items still fit the same 98mm. */}
            <div className="flex-1 overflow-hidden relative border-t border-b border-black my-1">
                <table className="w-full text-left">
                    <thead className="border-b border-black">
                        <tr className="text-[9px] font-bold">
                            <th className="py-0.5">Item</th>
                            <th className="py-0.5 text-center w-8">Qty</th>
                            <th className="py-0.5 text-right w-14">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {order.items.slice(0, 3).map((item, idx) => {
                            const name = item.variant?.product?.name || 'Unknown Product';
                            const variant = item.variant?.title && item.variant.title !== 'Default' ? item.variant.title : null;
                            const arabic = arabicProductLabel(item.variant?.product?.description);
                            // Most orders are one or two items, which leaves the
                            // box half empty at the size three need; use the room.
                            const roomy = order.items.length <= 2;
                            return (
                                <tr key={idx} className="border-b border-black/25 align-top">
                                    <td className="py-1 pe-1">
                                        <p className={`line-clamp-2 font-bold leading-snug ${roomy ? 'text-[13px]' : 'text-[11px]'}`}>
                                            <span>{name}</span>
                                            {variant && <span className="font-medium"> - {variant}</span>}
                                            {/* bdi keeps the brackets on the right
                                                side of the Arabic inside an English line. */}
                                            {arabic && <> <bdi className={`font-extrabold ${roomy ? 'text-[15px]' : 'text-[12px]'}`}>({arabic})</bdi></>}
                                        </p>
                                    </td>
                                    <td className={`py-1 text-center font-extrabold leading-snug ${roomy ? 'text-base' : 'text-sm'}`}>{item.quantity}</td>
                                    <td className={`py-1 text-right font-bold leading-snug ${roomy ? 'text-[13px]' : 'text-[11px]'}`}>{(item.quantity * item.price_at_sale).toFixed(0)}</td>
                                </tr>
                            );
                        })}
                        {order.items.length > 3 && (
                            <tr>
                                <td colSpan={3} className="text-center text-[9px] font-bold py-0.5">
                                    ...and {order.items.length - 3} more
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            <div className="mt-0.5 flex justify-between items-end">
                <div className="text-[9px] font-medium leading-tight">
                    <div>Sub: {order.subtotal?.toFixed(0)} | Ship: {order.shipping_cost?.toFixed(0)}</div>
                    <div>
                        {order.discount > 0 && `Disc: -${order.discount.toFixed(0)} `}
                        {order.payment_status === 'Partially Paid' && `Paid: ${order.paid_amount?.toFixed(0)}`}
                    </div>
                </div>
                <div className="text-right">
                    {order.payment_status === "Paid" ? (
                        <span className="font-bold text-lg uppercase border-2 border-black px-1 inline-block">PAID</span>
                    ) : (
                        <div className="flex flex-col items-end leading-none">
                            <span className="font-bold text-[8px] uppercase">Amount Due</span>
                            <span className="font-bold text-xl">{collectAmount.toFixed(0)} <span className="text-xs">EGP</span></span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
