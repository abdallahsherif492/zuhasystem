"use server";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { logIntegrationActivity } from "@/lib/logs/integration-logger";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";

const SHOPIFY_STATUS_MAPPING: Record<string, string> = {
    "Pending": "open",
    "Processing": "open",
    "Prepared": "open",
    "Shipped": "open",
    "Delivered": "fulfilled",
    "Collected": "fulfilled",
    "Cancelled": "cancelled",
    "Returned": "refunded"
};

/**
 * Sync Order Status Back to Shopify Admin API
 */
export async function syncStatusToShopify(orderId: string, newStatus: string, businessId: string) {
    try {
        const cookieStore = await cookies();
        const supabase = createServerClient(
            supabaseUrl,
            supabaseKey,
            {
                cookies: {
                    get(name: string) { return cookieStore.get(name)?.value; },
                },
            }
        );

        // 1. Get the business config for Shopify Access Token & Store Domain
        const { data: business } = await supabase
            .from('businesses')
            .select('theme_config')
            .eq('id', businessId)
            .single();

        if (!business || !business.theme_config) {
            return { success: false, error: "Business config missing." };
        }

        const shopifyConfig = business.theme_config.integrations?.platforms?.shopify;
        const shopDomain = shopifyConfig?.storeDomain || business.theme_config.shopify_store_domain;
        const accessToken = shopifyConfig?.accessToken || business.theme_config.shopify_access_token;

        if (!shopDomain || !accessToken) {
            return { success: false, error: "Shopify API credentials not configured." };
        }

        // 2. Get the shopify_id for this order
        const { data: order } = await supabase
            .from('orders')
            .select('shopify_id, easyorders_id')
            .eq('business_id', businessId)
            .eq('id', orderId)
            .single();

        if (!order || !order.shopify_id) {
            return { success: false, error: "Order does not belong to Shopify." };
        }

        const shopifyOrderId = order.shopify_id;
        const mappedStatus = SHOPIFY_STATUS_MAPPING[newStatus];

        if (!mappedStatus) {
            return { success: false, error: "Status does not have a Shopify equivalent." };
        }

        // 3. Send Fulfillment / Status update to Shopify Rest API
        const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const url = `https://${cleanDomain}/admin/api/2024-01/orders/${shopifyOrderId}.json`;

        let updateBody: any = {};
        if (newStatus === "Cancelled") {
            updateBody = { order: { id: shopifyOrderId, status: "cancelled" } };
        } else {
            updateBody = { order: { id: shopifyOrderId, note: `Status updated to ${newStatus} in eCommerx` } };
        }

        const res = await fetch(url, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": accessToken
            },
            body: JSON.stringify(updateBody)
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`Shopify Sync Error for ${orderId}:`, errorText);
            logIntegrationActivity(businessId, "Shopify", "error", `Order ${orderId} failed to sync to Shopify.`, { orderId, error: errorText });
            return { success: false, error: `Shopify API responded with ${res.status}: ${errorText}` };
        }

        logIntegrationActivity(businessId, "Shopify", "success", `Order ${orderId} status synced to Shopify successfully.`, { orderId, status: mappedStatus });
        return { success: true };
    } catch (error: any) {
        console.error("Failed to sync with Shopify:", error);
        logIntegrationActivity(businessId, "Shopify", "error", `Order ${orderId} failed to sync to Shopify.`, { orderId, error: error.message });
        return { success: false, error: error.message };
    }
}
