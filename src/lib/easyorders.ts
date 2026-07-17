"use server";

import { supabase } from "@/lib/supabase";

const STATUS_MAPPING: Record<string, string> = {
    "Pending": "pending",
    "Processing": "processing",
    "Prepared": "waiting_for_pickup",
    "Hold To redeliver": "returning_from_delivery",
    "Shipped": "in_delivery",
    "Delivered": "delivered",
    "Collected": "delivered",
    "Returning": "returning_from_delivery",
    "Returned": "refunded",
    "Cancelled": "canceled",
    "Unavailable": "canceled"
};

export async function syncStatusToEasyOrders(orderId: string, newStatus: string, businessId: string) {
    try {
        // 1. Get the business config to check for API key
        const { data: business } = await supabase
            .from('businesses')
            .select('theme_config')
            .eq('id', businessId)
            .single();

        if (!business || !business.theme_config || !business.theme_config.easyorders_api_key) {
            return { success: false, error: "EasyOrders API key not configured." };
        }

        const apiKey = business.theme_config.easyorders_api_key;

        // 2. Get the easyorders_id for this order
        const { data: order } = await supabase
            .from('orders')
            .select('easyorders_id')
            .eq('id', orderId)
            .single();

        if (!order || !order.easyorders_id) {
            return { success: false, error: "Order does not belong to EasyOrders." };
        }

        const easyOrdersId = order.easyorders_id;
        const mappedStatus = STATUS_MAPPING[newStatus];

        if (!mappedStatus) {
            return { success: false, error: "Status does not have an EasyOrders equivalent." };
        }

        // 3. Send the PATCH request to EasyOrders
        const url = `https://api.easy-orders.net/api/v1/external-apps/orders/${easyOrdersId}/status`;
        const res = await fetch(url, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Api-Key": apiKey
            },
            body: JSON.stringify({ status: mappedStatus })
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`EasyOrders Sync Error for ${orderId}:`, errorText);
            return { success: false, error: `API responded with ${res.status}: ${errorText}` };
        }

        return { success: true };
    } catch (error: any) {
        console.error("Failed to sync with EasyOrders:", error);
        return { success: false, error: error.message };
    }
}
