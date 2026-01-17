"use client";

import { useEffect, useState, use } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useSearchParams } from "next/navigation";
import Barcode from 'react-barcode';

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

function InvoiceCard({ order }: { order: InvoiceData }) {
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
        <div className="waybill-container border-b-2 border-dashed border-gray-400 p-6 h-[49.5vh] flex flex-col justify-between text-sm box-border overflow-hidden">
            {/* Header */}
            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                    <div className="relative h-12 w-12 grayscale">
                        <Image src="/logo.png" alt="Zuha" fill className="object-contain" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold">Zuha Home</h1>
                        <p className="text-[10px] text-gray-500">Fast & Reliable Shipping</p>
                    </div>
                </div>
                <div className="text-right">
                    <h2 className="text-xl font-bold uppercase">Waybill</h2>
                    <div className="flex justify-end">
                        <Barcode value={order.id.slice(0, 8)} width={1} height={30} fontSize={10} displayValue={false} />
                    </div>
                    <p className="font-mono text-xs">{order.id.slice(0, 8)}</p>
                    <p>{format(new Date(order.created_at), "dd/MM/yyyy")}</p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-2">
                <div>
                    <span className="font-bold uppercase text-gray-500 block text-[10px]">Deliver To:</span>
                    <p className="font-bold text-sm">{order.customer_info.name}</p>
                    <p className="items-center">{combinedPhone}</p>
                    <p className="leading-tight mt-1">{order.customer_info.address}, {order.customer_info.governorate}</p>
                </div>
                <div>
                    <span className="font-bold uppercase text-gray-500 block text-[10px]">Notes:</span>
                    <p className="font-bold text-sm bg-gray-100 p-1 rounded">{combinedNotes}</p>
                </div>
            </div>

            {/* Items (Simplified table) */}
            <div className="flex-1 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="border-b border-black">
                        <tr>
                            <th className="py-1">Item</th>
                            <th className="py-1 text-center w-8">Qty</th>
                            <th className="py-1 text-right w-16">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {order.items.slice(0, 4).map((item, idx) => (
                            <tr key={idx} className="border-b border-gray-100">
                                <td className="py-1 truncate max-w-[150px]">
                                    {item.variant.product.name} <span className="text-[10px] text-gray-500">({item.variant.title})</span>
                                </td>
                                <td className="py-1 text-center">{item.quantity}</td>
                                <td className="py-1 text-right">{(item.quantity * item.price_at_sale).toFixed(0)}</td>
                            </tr>
                        ))}
                        {order.items.length > 4 && (
                            <tr><td colSpan={3} className="text-center italic text-gray-500 py-1">...and {order.items.length - 4} more items</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Total Footer */}
            <div className="mt-2 text-right border-t border-black pt-2 flex justify-between items-center">
                <div className="text-[10px] text-gray-500 text-left">
                    Sub: {order.subtotal?.toFixed(0)} | Ship: {order.shipping_cost?.toFixed(0)}
                    {order.discount > 0 ? ` | Disc: -${order.discount.toFixed(0)}` : ''}
                    {order.payment_status === 'Partially Paid' && ` | Paid: ${order.paid_amount?.toFixed(0)}`}
                </div>
                <div>
                    <div className="flex flex-col items-end">
                        {order.payment_status === "Paid" ? (
                            <span className="font-bold text-xl uppercase border-2 border-black px-2">PAID</span>
                        ) : (
                            <>
                                <span className="font-bold text-xs mr-2">REQUIRED:</span>
                                <span className="font-bold text-xl">{collectAmount.toFixed(0)} EGP</span>
                            </>
                        )}
                    </div>
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
                // Ensure correct shape
                // We rely on 'customer_info' being present as JSONB
                const formatted = data.map((o: any) => ({
                    ...o,
                    customer_info: o.customer_info || {}
                }));
                setOrders(formatted);
            }
            setLoading(false);
        };
        fetchOrders();
    }, [idsParam]);

    useEffect(() => {
        if (!loading && orders.length > 0) {
            setTimeout(() => window.print(), 500);
        }
    }, [loading, orders]);

    if (loading) {
        return <div className="flex justify-center p-10"><Loader2 className="animate-spin" /> Preparing Waybills...</div>;
    }

    if (orders.length === 0) return <div>No orders selected</div>;

    return (
        <div className="p-0 m-0 print-reset">
            <style jsx global>{`
                @media print {
                    @page { size: A4; margin: 0; }
                    body { margin: 0; background: white; -webkit-print-color-adjust: exact; }
                    nav, header, footer, .no-print { display: none !important; }
                    .waybill-container {
                        height: 49.5vh; /* 2 per page */
                        page-break-inside: avoid;
                    }
                }
            `}</style>
            {orders.map(order => (
                <InvoiceCard key={order.id} order={order} />
            ))}
        </div>
    );
}

import { Suspense } from "react";

export default function BulkPrintPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <PrintContent />
        </Suspense>
    )
}
