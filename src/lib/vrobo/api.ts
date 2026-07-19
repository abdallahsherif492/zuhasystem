"use server";

import { createClient } from "@supabase/supabase-js";

export async function sendOrderToVrobo(order: any) {
    const vroboApiKey = process.env.VROBO_API_KEY || "173dcc86-720f-4065-8cd4-5383b6f8281d";
    
    // Map the order details to VROBO payload
    const payload = {
        waybill_id: order.tracking_number || order.id.substring(0, 10), // Fallback if no tracking number
        customer_name: order.customer_info?.name || "Unknown Customer",
        customer_phone1: order.customer_info?.phone || "Unknown",
        customer_phone2: order.customer_info?.phone2 || "",
        customer_address: `${order.customer_info?.city || ''}, ${order.customer_info?.address || ''}`.trim(),
        merchant_name: "Zuha System", // Default merchant name
        merchant_id: order.business_id || "1",
        order_content: `Order #${order.id.substring(0, 6)}`,
        order_COD: String(order.total_amount || 0),
        type: "verification",
        items: (order.items || []).map((item: any) => ({
            items_title: `${item.productName || item.product?.name || item.variant?.product?.name || 'Item'} - ${item.variantTitle || item.variant?.title || 'Variant'}`,
            items_qty: item.quantity || 1,
            item_image_url: "https://via.placeholder.com/150" // Fallback since we might not have product images easily accessible here
        })),
        reason_id: "2" // Default: Customer Refused
    };

    console.log("Sending to VROBO payload:", JSON.stringify(payload, null, 2));

    try {
        const response = await fetch("https://integration.vrobo.co/create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": vroboApiKey
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log("VROBO API Response:", data);

        if (!response.ok || data.order_creation !== "Success") {
             console.error("VROBO Order Creation Failed:", data);
             return { success: false, error: data };
        }

        return { success: true, data };
    } catch (error: any) {
        console.error("VROBO API Error:", error.message);
        return { success: false, error: error.message };
    }
}

export async function processOrderForVrobo(orderId: string) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch the order
    const { data: order, error } = await supabase
        .from("orders")
        .select(`
            *,
            items:order_items(
                *,
                variant:variants(
                    title,
                    product:products(name)
                )
            )
        `)
        .eq("id", orderId)
        .single();

    if (error || !order) {
        console.error("VROBO Sync Error: Could not fetch order", orderId, error);
        return { success: false, message: "Could not fetch order" };
    }

    // 2. Check if already synced
    if (order.vrobo_synced) {
        console.log(`Order ${orderId} already synced to VROBO. Skipping.`);
        return { success: false, message: "Already synced to VROBO. Skipping." };
    }

    // 3. Check status
    if (order.status !== "Returning" && order.status !== "Hold To redeliver") {
        console.log(`Order ${orderId} has status ${order.status}, not eligible for VROBO.`);
        return { success: false, message: "Status not eligible for VROBO." };
    }

    // 4. Send to VROBO
    const result = await sendOrderToVrobo(order);

    if (result.success) {
        // 5. Mark as synced
        await supabase
            .from("orders")
            .update({ vrobo_synced: true })
            .eq("id", orderId);
        console.log(`Order ${orderId} successfully synced to VROBO.`);
        return { success: true, message: "Successfully synced to VROBO.", vrobo_response: result.data };
    } else {
        return { success: false, message: "Failed to sync to VROBO API.", error: result.error };
    }
}
