"use server";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { loginAccurate, fetchAccurateShipments, mapAccurateStatusToZuha } from "@/lib/shipping/accurate";

export interface SyncPreviewItem {
    orderId: string;
    customerName: string;
    oldStatus: string;
    newStatus: string;
    accurateStatusName: string;
}

export async function previewShippingSyncAction(businessId: string): Promise<{ updates: SyncPreviewItem[], error?: string }> {
    try {
        const cookieStore = await cookies();
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";
        
        const supabase = createServerClient(
            supabaseUrl,
            supabaseKey,
            {
                cookies: {
                    get(name: string) { return cookieStore.get(name)?.value; },
                },
            }
        );

        // Fetch active orders (Shipped, Waiting for Shipping, Prepared, etc) that might need syncing
        // Basically we want anything that is NOT Delivered, Cancelled, Returned, or Pending (if pending means hasn't reached shipping yet).
        // Let's just fetch all orders that are currently active and let's check against Accurate.
        // Or to be safe, fetch orders that are in statuses: ["Waiting for Shipping", "Shipped", "Returning", "Prepared"]
        const { data: orders, error: ordersError } = await supabase
            .from("orders")
            .select("id, customer_name, status, tags")
            .eq("business_id", businessId)
            .in("status", ["Prepared", "Waiting for Shipping", "Shipped", "Returning"]);

        if (ordersError) throw new Error(ordersError.message);
        if (!orders || orders.length === 0) return { updates: [] };

        // We use the first 8 characters of order id as refNumber
        const refNumbers = orders.map(o => o.id.substring(0, 8));
        const token = await loginAccurate();
        const accurateShipments = await fetchAccurateShipments(token, refNumbers);

        const updates: SyncPreviewItem[] = [];

        for (const order of orders) {
            const shortId = order.id.substring(0, 8);
            // In case there are multiple for some reason, grab the latest one (assume array is ordered or grab last)
            const accurateMatch = accurateShipments.find(s => s.refNumber === shortId);

            if (accurateMatch) {
                const newStatus = mapAccurateStatusToZuha(accurateMatch.status.name);
                if (newStatus && newStatus !== order.status) {
                    updates.push({
                        orderId: order.id,
                        customerName: order.customer_name,
                        oldStatus: order.status,
                        newStatus: newStatus,
                        accurateStatusName: accurateMatch.status.name
                    });
                }
            }
        }

        return { updates };
    } catch (error: any) {
        console.error("Preview sync error:", error);
        return { updates: [], error: error.message };
    }
}

export async function applyShippingUpdatesAction(updates: SyncPreviewItem[]): Promise<{ success: boolean; error?: string }> {
    try {
        const cookieStore = await cookies();
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";
        
        const supabase = createServerClient(
            supabaseUrl,
            supabaseKey,
            {
                cookies: {
                    get(name: string) { return cookieStore.get(name)?.value; },
                },
            }
        );

        for (const update of updates) {
            const { error } = await supabase
                .from("orders")
                .update({ status: update.newStatus })
                .eq("id", update.orderId);
            if (error) {
                console.error(`Failed to update order ${update.orderId}:`, error);
            }
        }

        return { success: true };
    } catch (error: any) {
        console.error("Apply sync error:", error);
        return { success: false, error: error.message };
    }
}
