"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { WaybillCard, type WaybillOrder } from "@/components/orders/waybill-card";

// Helper to chunk array
const chunk = <T,>(arr: T[], size: number): T[][] =>
    Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
        arr.slice(i * size, i * size + size)
    );

function PrintContent() {
    const searchParams = useSearchParams();
    const idsParam = searchParams.get("ids");
    const [orders, setOrders] = useState<WaybillOrder[]>([]);
    const [loading, setLoading] = useState(true);

    const { activeBusiness } = require("@/contexts/BusinessContext").useBusiness();

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
                            product:products (name, description)
                        )
                    ),
                    customer_info,
                    order_type
                `)
                .eq("business_id", activeBusiness!.id)
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
            // Printing before the Arabic font has arrived prints the fallback.
            let cancelled = false;
            const ready = document.fonts?.ready ?? Promise.resolve();
            ready.then(() => { if (!cancelled) setTimeout(() => window.print(), 300); });
            return () => { cancelled = true; };
        }
    }, [loading, orders]);

    if (loading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin" /> Preparing Waybills...</div>;
    if (orders.length === 0) return <div>No orders selected</div>;

    const pages = chunk(orders, 3);

    return (
        <div className="min-h-screen bg-muted p-8 print-reset-container">
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
                            <WaybillCard key={order.id} order={order} isFirstOnPage={idx === 0} business={activeBusiness} />
                        ))}
                    </div>
                ))}
            </div>

            {/* Actual Print Layout */}
            <div className="hidden print:block">
                {pages.map((pageOrders, pageIdx) => (
                    <div key={pageIdx} className="print-page">
                        {pageOrders.map((order, idx) => (
                            <WaybillCard key={order.id} order={order} isFirstOnPage={idx === 0} business={activeBusiness} />
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
