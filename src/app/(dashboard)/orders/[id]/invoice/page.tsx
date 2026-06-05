"use client";

import { useEffect, useState, use } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import Barcode from 'react-barcode';

// Types for the invoice data
type InvoiceData = {
    id: string;
    created_at: string;
    status: string;
    total_amount: number;
    subtotal: number;
    discount: number;
    shipping_cost: number;
    customer_info: {
        name: string;
        phone: string;
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

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
    // Unwrap params using React.use()
    const { id } = use(params);

    const [order, setOrder] = useState<InvoiceData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchOrder = async () => {
            if (!id) return;

            // Fetch order with related data
            // Note: We're assuming the foreign keys are set up correctly in Supabase
            // orders -> order_items -> variants -> products
            // orders -> customers (optional if we store snapshot in customer_info)

            const { data, error } = await supabase
                .from("orders")
                .select(`
                    *,
                    items:order_items (
                        quantity,
                        price_at_sale,
                        variant:variants (
                            title,
                            product:products (
                                name
                            )
                        )
                    ),
                    customer:customers (
                        name,
                        phone,
                        address,
                        governorate
                    )
                `)
                .eq("id", id)
                .single();

            if (error) {
                console.error("Error fetching invoice:", error);
            } else {
                // Formatting data to match our InvoiceData type
                // If customer_info is in the order (snapshot), use it. 
                // Otherwise fall back to the linked customer record.
                const customerData = data.customer_info || {
                    name: data.customer?.name || "Guest",
                    phone: data.customer?.phone || "N/A",
                    address: data.customer?.address || "",
                    governorate: data.customer?.governorate || ""
                };

                setOrder({
                    ...data,
                    customer_info: customerData,
                    items: data.items || []
                });
            }
            setLoading(false);
        };

        fetchOrder();
    }, [id]);

    useEffect(() => {
        if (!loading && order) {
            // Auto-print when ready
            window.print();
        }
    }, [loading, order]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!order) {
        return (
            <div className="flex items-center justify-center min-h-screen text-red-500">
                Order not found.
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white text-black p-8 print:p-0">
            {/* Print specific styles are usually handled by browser, but we can enforce some defaults */}
            <div className="max-w-3xl mx-auto border p-8 print:border-none print:mx-0 print:max-w-none">

                {/* Header */}
                <div className="flex justify-between items-start mb-8">
                    <div>
                        <div className="relative h-24 w-24 mb-2">
                            <Image
                                src="/logo.png"
                                alt="Zuha Logo"
                                fill
                                className="object-contain" // Simplified for print
                                priority
                            />
                        </div>
                        <h1 className="text-2xl font-bold">Zuha System</h1>
                        <p className="text-sm text-gray-500">Cairo, Egypt</p>
                        <p className="text-sm text-gray-500">+20 100 000 0000</p>
                    </div>
                    <div className="text-right">
                        <h2 className="text-3xl font-bold text-gray-800 uppercase tracking-wide">Invoice</h2>
                        <div className="flex justify-end my-2">
                            <Barcode value={order.id.slice(0, 8)} width={1.5} height={40} fontSize={12} />
                        </div>
                        <p className="text-gray-500 mt-2">Order #: {order.id.slice(0, 8)}</p>
                        <p className="text-gray-500">Date: {format(new Date(order.created_at), "dd MMM yyyy")}</p>
                    </div>
                </div>

                {/* Customer & Shipping Info */}
                <div className="mb-8 border-t border-b py-4">
                    <h3 className="font-semibold text-gray-700 mb-2 uppercase text-sm">Bill To:</h3>
                    <p className="text-lg font-bold">{order.customer_info.name}</p>
                    <p>{order.customer_info.phone}</p>
                    <p className="whitespace-pre-wrap">{order.customer_info.address}</p>
                    <p>{order.customer_info.governorate}</p>
                </div>

                {/* Order Items Table */}
                <table className="w-full mb-8">
                    <thead>
                        <tr className="border-b-2 border-gray-800">
                            <th className="text-left py-2 font-bold text-gray-700">Item</th>
                            <th className="text-center py-2 font-bold text-gray-700">Qty</th>
                            <th className="text-right py-2 font-bold text-gray-700">Price</th>
                            <th className="text-right py-2 font-bold text-gray-700">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {order.items.map((item, index) => (
                            <tr key={index} className="border-b border-gray-200">
                                <td className="py-3">
                                    <p className="font-semibold">{item.variant.product.name}</p>
                                    <p className="text-sm text-gray-500">{item.variant.title}</p>
                                </td>
                                <td className="text-center py-3">{item.quantity}</td>
                                <td className="text-right py-3">{item.price_at_sale.toFixed(2)} EGP</td>
                                <td className="text-right py-3">{(item.quantity * item.price_at_sale).toFixed(2)} EGP</td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {/* Totals */}
                <div className="flex justify-end">
                    <div className="w-1/2">
                        <div className="flex justify-between py-2 border-b">
                            <span className="font-semibold text-gray-600">Subtotal:</span>
                            <span>{order.subtotal.toFixed(2)} EGP</span>
                        </div>
                        <div className="flex justify-between py-2 border-b">
                            <span className="font-semibold text-gray-600">Shipping:</span>
                            <span>{order.shipping_cost.toFixed(2)} EGP</span>
                        </div>
                        {order.discount > 0 && (
                            <div className="flex justify-between py-2 border-b text-red-600">
                                <span className="font-semibold">Discount:</span>
                                <span>-{order.discount.toFixed(2)} EGP</span>
                            </div>
                        )}
                        <div className="flex justify-between py-4 border-b-2 border-gray-800">
                            <span className="font-bold text-xl">Total:</span>
                            <span className="font-bold text-xl">{order.total_amount.toFixed(2)} EGP</span>
                        </div>
                        {order.payment_status !== "Not Paid" && (
                            <>
                                <div className="flex justify-between py-2 border-b text-green-700">
                                    <span className="font-semibold">Paid ({order.payment_status}):</span>
                                    <span>{order.payment_status === "Paid" ? order.total_amount.toFixed(2) : order.paid_amount?.toFixed(2)} EGP</span>
                                </div>
                                <div className="flex justify-between py-4 border-b-2 border-gray-800 bg-gray-50 px-2">
                                    <span className="font-bold text-xl">Balance Due:</span>
                                    <span className="font-bold text-xl">
                                        {(order.payment_status === "Paid" ? 0 : Math.max(0, order.total_amount - (order.paid_amount || 0))).toFixed(2)} EGP
                                    </span>
                                </div>
                            </>
                        )}
                        {order.payment_status === "Not Paid" && (
                            <div className="flex justify-between py-4 border-b-2 border-gray-800 bg-gray-50 px-2">
                                <span className="font-bold text-xl">Balance Due:</span>
                                <span className="font-bold text-xl">{order.total_amount.toFixed(2)} EGP</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-12 text-center text-sm text-gray-500">
                    <p>Thank you for your business!</p>
                </div>
            </div>
        </div>
    );
}
