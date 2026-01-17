"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useSearchParams } from "next/navigation";
import Barcode from 'react-barcode';
import { Suspense } from "react";

type InvoiceData = {
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
            };
        };
    }>;
    payment_status?: string;
    paid_amount?: number;
};

// Helper to chunk array
const chunk = <T,>(arr: T[], size: number): T[][] =>
    Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
        arr.slice(i * size, i * size + size)
    );

function InvoiceCard({ order, isFirstOnPage }: { order: InvoiceData, isFirstOnPage: boolean }) {
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
             box-border w-full flex flex-col justify-between overflow-hidden bg-white p-3
             ${isFirstOnPage ? 'border-b-2 border-dashed border-black' : 'border-t-2 border-dashed border-black'}
        `} style={{ height: '98mm' }}>
            {/* Header */}
            <div className="flex justify-between items-start mb-0">
                <div className="flex items-center gap-2">
                    <div className="relative h-10 w-10 grayscale">
                        <Image src="/logo.png" alt="Zuha" fill className="object-contain" />
                    </div>
                    <div>
                        <h1 className="text-base font-bold leading-none">Zuha Home</h1>
                        <p className="text-[9px] text-gray-500">Fast & Reliable Shipping</p>
                    </div>
                </div>
                <div className="text-right">
                    <h2 className="text-lg font-bold uppercase leading-none">Waybill</h2>
                    <div className="flex justify-end">
                        <Barcode value={order.id.slice(0, 8)} width={1} height={20} fontSize={9} displayValue={false} />
                    </div>
                    <p className="font-mono text-[10px] leading-none mt-0.5">{order.id.slice(0, 8)}</p>
                    <p className="text-[9px] leading-none">{format(new Date(order.created_at), "dd/MM/yyyy")}</p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-1">
                <div>
                    <span className="font-bold uppercase text-gray-500 block text-[8px]">Deliver To:</span>
                    <p className="font-bold text-xs leading-tight line-clamp-1">{order.customer_info.name}</p>
                    <p className="text-[10px] leading-tight">{combinedPhone}</p>
                    <p className="text-[10px] leading-tight mt-0.5 line-clamp-2">{order.customer_info.address}, {order.customer_info.governorate}</p>
                </div>
                <div>
                    <span className="font-bold uppercase text-gray-500 block text-[8px]">Notes:</span>
                    <p className="font-bold text-[10px] bg-gray-100 p-1 rounded min-h-[35px] leading-tight line-clamp-2">{combinedNotes}</p>
                </div>
            </div>

            {/* Items Table - Flex Grow to Fill Space */}
            <div className="flex-1 overflow-hidden relative border-t border-b border-gray-200 my-1">
                <table className="w-full text-left">
                    <thead className="border-b border-gray-400">
                        <tr className="text-[9px]">
                            <th className="py-0.5">Item</th>
                            <th className="py-0.5 text-center w-8">Qty</th>
                            <th className="py-0.5 text-right w-14">Total</th>
                        </tr>
                    </thead>
                    <tbody className="text-[9px]">
                        {order.items.slice(0, 3).map((item, idx) => (
                            <tr key={idx} className="border-b border-gray-50">
                                <td className="py-0.5 truncate max-w-[150px] font-medium">
                                    {item.variant.product.name} <span className="text-[8px] text-gray-500">({item.variant.title})</span>
                                </td>
                                <td className="py-0.5 text-center font-bold">{item.quantity}</td>
                                <td className="py-0.5 text-right">{(item.quantity * item.price_at_sale).toFixed(0)}</td>
                            </tr>
                        ))}
                        {order.items.length > 3 && (
                            <tr>
                                <td colSpan={3} className="text-center italic text-[8px] text-gray-400 py-0.5">
                                    ...and {order.items.length - 3} more
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            <div className="mt-0.5 flex justify-between items-end">
                <div className="text-[9px] text-gray-500 leading-tight">
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
                            <span className="font-bold text-[8px] uppercase text-gray-500">Amount Due</span>
                            <span className="font-bold text-xl">{collectAmount.toFixed(0)} <span className="text-xs">EGP</span></span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

function PrintContent() {
    const searchParams = useSearchParams();
    const idsParam = searchParams.get("ids");
    const [orders, setOrders] = useState<InvoiceData[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchOrders = async () => {
            if (!idsParam) return;
            const ids = idsParam.split(",");
            if (ids.length === 0) return;

            const { data, error } = await supabase
                .from("orders")
                .select(`
                    *,
                    items:order_items (
                        quantity,
                        price_at_sale,
                        variant:variants (
                            title,
                            product:products (name)
                        )
                    ),
                    customer_info
                `)
                .in("id", ids);

            if (data) {
                const formatted = data.map((o: any) => ({
                    ...o,
                    customer_info: o.customer_info || {}
                }));
                // Sort to maintain order if needed, or keep input order
                // For now, let's just use the fetched order.
                setOrders(formatted);
            }
            setLoading(false);
        };
        fetchOrders();
    }, [idsParam]);

    useEffect(() => {
        if (!loading && orders.length > 0) {
            setTimeout(() => window.print(), 800);
        }
    }, [loading, orders]);

    if (loading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin" /> Preparing Waybills...</div>;
    if (orders.length === 0) return <div>No orders selected</div>;

    const pages = chunk(orders, 3);

    return (
        <div className="min-h-screen bg-gray-100 p-8 print-reset-container">
            <style jsx global>{`
                /* Hide global UI */
                nav, aside, header, footer, .sidebar { display: none !important; }
                
                @media print {
                    @page { 
                        size: A4 portrait; 
                        margin: 0; 
                    }
                    body { 
                        margin: 0 !important; 
                        background: white !important; 
                        padding: 0 !important;
                    }
                    .print-reset-container { 
                        padding: 0 !important; 
                        background: white !important; 
                        min-height: 0 !important;
                    }
                    .print-page {
                        width: 210mm;
                        height: 296mm; /* Slightly less than 297mm to prevent overflow */
                        page-break-after: always;
                        overflow: hidden;
                        display: flex;
                        flex-direction: column;
                        border: none !important;
                        box-shadow: none !important;
                        margin: 0;
                    }
                    /* Remove page break after the last page to avoid empty sheet */
                    .print-page:last-child {
                        page-break-after: auto;
                    }
                }
            `}</style>

            {/* Screen Preview Implementation */}
            <div className="flex flex-col gap-8 print:hidden items-center">
                {pages.map((pageOrders, pageIdx) => (
                    <div key={pageIdx} className="w-[210mm] h-[296mm] bg-white shadow-lg flex flex-col overflow-hidden relative">
                        {/* Preview Header */}
                        <div className="absolute top-0 right-0 bg-black text-white px-2 py-1 text-xs z-10">Page {pageIdx + 1}</div>

                        {pageOrders.map((order, idx) => (
                            <InvoiceCard key={order.id} order={order} isFirstOnPage={idx === 0} />
                        ))}
                    </div>
                ))}
            </div>

            {/* Actual Print Layout */}
            <div className="hidden print:block">
                {pages.map((pageOrders, pageIdx) => (
                    <div key={pageIdx} className="print-page">
                        {pageOrders.map((order, idx) => (
                            <InvoiceCard key={order.id} order={order} isFirstOnPage={idx === 0} />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function BulkPrintPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <PrintContent />
        </Suspense>
    )
}
