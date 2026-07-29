"use server";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { loginAccurate, fetchAccurateShipments, mapAccurateStatusToZuha } from "@/lib/shipping/accurate";
import { fetchBostaShipments, mapBostaStatusToZuha } from "@/lib/shipping/bosta";
import { fetchJTShipments, mapJTStatusToZuha } from "@/lib/shipping/jt";
import { fetchAramexShipments, mapAramexStatusToZuha } from "@/lib/shipping/aramex";
import { fetchFiltareeqShipments, mapFiltareeqStatusToZuha } from "@/lib/shipping/filtareeq";
import { syncStatusToEasyOrders } from "@/lib/easyorders";
import { processOrderForVrobo } from "@/lib/vrobo/api";
import { logIntegrationActivity } from "@/lib/logs/integration-logger";
import { logBusinessAction } from "@/lib/logs/actions-logger";


export interface SyncPreviewItem {
    orderId: string;
    customerName: string;
    oldStatus: string;
    newStatus: string;
    accurateStatusName: string;
    provider?: string;
}

export async function previewTelegraphShippingSyncInternal(businessId: string): Promise<{ updates: SyncPreviewItem[], debugInfo?: any, error?: string }> {
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
        const { data: orders, error: ordersError } = await supabase
            .from("orders")
            .select("id, customer_info, status, tags")
            .eq("business_id", businessId)
            .in("status", ["Prepared", "Hold To redeliver", "Shipped", "Returning"]);

        if (ordersError) throw new Error(ordersError.message);
        if (!orders || orders.length === 0) return { updates: [], debugInfo: { message: "No active orders found" } };

        // Fetch Business Telegraph config
        const { data: business } = await supabase
            .from("businesses")
            .select("theme_config")
            .eq("id", businessId)
            .single();

        const telegraphConfig = business?.theme_config?.integrations?.shipping?.telegraph;
        
        if (!telegraphConfig || !telegraphConfig.enabled || !telegraphConfig.username || !telegraphConfig.password) {
            return { updates: [], error: "Telegraph integration is not configured or disabled in settings." };
        }

        // We use the first 8 characters of order id as refNumber
        const refNumbers = orders.map(o => o.id.substring(0, 8));
        const token = await loginAccurate(telegraphConfig.username, telegraphConfig.password);
        const accurateShipments = await fetchAccurateShipments(token, refNumbers);
        
        const debugInfo = {
            activeRefNumbers: refNumbers,
            fetchedShipments: accurateShipments.map(s => ({ ref: s.zuhaRef || s.refNumber, code: s.status?.code, name: s.status?.name }))
        };

        // --- DEBUG LOGGING ---
        await logIntegrationActivity(businessId, "Telegraph", "info", `[DEBUG] Fetched ${accurateShipments.length} matching shipments for ${refNumbers.length} active refNumbers.`, debugInfo);
        // ---------------------

        const updates: SyncPreviewItem[] = [];

        for (const order of orders) {
            const shortId = order.id.substring(0, 8);
            const accurateMatch = accurateShipments.find(s => {
                const matchRef = s.zuhaRef ? s.zuhaRef : s.refNumber;
                return matchRef && matchRef.toLowerCase() === shortId.toLowerCase();
            });

            if (accurateMatch) {
                const newStatus = mapAccurateStatusToZuha(accurateMatch.status.code, accurateMatch.status.name);
                if (newStatus && newStatus !== order.status) {
                    updates.push({
                        orderId: order.id,
                        customerName: (order.customer_info as any)?.name || "N/A",
                        oldStatus: order.status,
                        newStatus: newStatus,
                        accurateStatusName: accurateMatch.status.name,
                        provider: "Telegraph"
                    });
                }
            }
        }

        return { updates, debugInfo };
    } catch (error: any) {
        console.error("Preview sync error (Telegraph):", error);
        return { updates: [], error: error.message };
    }
}

export async function previewShippingSyncAction(businessId: string): Promise<{ updates: SyncPreviewItem[], debugInfo?: any, error?: string }> {
    try {
        const [telegraphResult, bostaResult, jtResult, aramexResult, filtareeqResult] = await Promise.all([
            previewTelegraphShippingSyncInternal(businessId),
            previewBostaShippingSyncAction(businessId),
            previewGenericShippingSyncAction(businessId, "jt"),
            previewGenericShippingSyncAction(businessId, "aramex"),
            previewGenericShippingSyncAction(businessId, "filtareeq"),
        ]);

        const allUpdates: SyncPreviewItem[] = [];

        if (telegraphResult.updates && telegraphResult.updates.length > 0) {
            allUpdates.push(...telegraphResult.updates);
        }

        const integrateResult = (result: any, providerName: string) => {
            if (result.updates && result.updates.length > 0) {
                for (const item of result.updates) {
                    if (!allUpdates.some(u => u.orderId === item.orderId)) {
                        allUpdates.push({ ...item, provider: providerName });
                    }
                }
            }
        };

        integrateResult(bostaResult, "Bosta");
        integrateResult(jtResult, "J&T");
        integrateResult(aramexResult, "Aramex");
        integrateResult(filtareeqResult, "Filtareeq");

        return {
            updates: allUpdates,
            debugInfo: {
                telegraph: telegraphResult.debugInfo,
                bosta: bostaResult.debugInfo,
                jt: jtResult.debugInfo,
                aramex: aramexResult.debugInfo,
                filtareeq: filtareeqResult.debugInfo
            }
        };
    } catch (error: any) {
        console.error("Unified preview shipping sync error:", error);
        return { updates: [], error: error.message };
    }
}


export async function previewBostaShippingSyncAction(businessId: string): Promise<{ updates: SyncPreviewItem[], debugInfo?: any, error?: string }> {
    try {
        const cookieStore = await cookies();
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
        
        const supabase = createServerClient(
            supabaseUrl,
            supabaseKey,
            {
                cookies: {
                    get(name: string) { return cookieStore.get(name)?.value; },
                },
            }
        );

        const { data: orders, error: ordersError } = await supabase
            .from("orders")
            .select("id, customer_info, status, tags")
            .eq("business_id", businessId)
            .in("status", ["Prepared", "Hold To redeliver", "Shipped", "Returning"]);

        if (ordersError) throw new Error(ordersError.message);
        if (!orders || orders.length === 0) return { updates: [], debugInfo: { message: "No active orders found" } };

        const { data: business } = await supabase
            .from("businesses")
            .select("theme_config")
            .eq("id", businessId)
            .single();

        const bostaConfig = business?.theme_config?.integrations?.shipping?.bosta;
        
        if (!bostaConfig || !bostaConfig.enabled || !bostaConfig.apiKey) {
            return { updates: [], error: "Bosta integration is not configured or disabled in settings." };
        }

        const refNumbers = orders.map(o => o.id.substring(0, 8));
        const bostaShipments = await fetchBostaShipments(bostaConfig.apiKey, refNumbers);
        
        const debugInfo = {
            activeRefNumbers: refNumbers,
            fetchedShipments: bostaShipments.map(s => ({ ref: s.zuhaRef || s.trackingNumber, code: s.state?.code, value: s.state?.value }))
        };

        await logIntegrationActivity(businessId, "Bosta", "info", `[DEBUG] Fetched ${bostaShipments.length} matching shipments for ${refNumbers.length} active refNumbers.`, debugInfo);

        const updates: SyncPreviewItem[] = [];

        for (const order of orders) {
            const shortId = order.id.substring(0, 8);
            const bostaMatch = bostaShipments.find(s => {
                const matchRef = s.zuhaRef ? s.zuhaRef : s.trackingNumber;
                return matchRef && matchRef.toLowerCase() === shortId.toLowerCase();
            });

            if (bostaMatch) {
                const newStatus = mapBostaStatusToZuha(bostaMatch.state.value);
                if (newStatus && newStatus !== order.status) {
                    updates.push({
                        orderId: order.id,
                        customerName: (order.customer_info as any)?.name || "N/A",
                        oldStatus: order.status,
                        newStatus: newStatus,
                        accurateStatusName: bostaMatch.state.value
                    });
                }
            }
        }

        return { updates, debugInfo };
    } catch (error: any) {
        console.error("Preview sync error (Bosta):", error);
        return { updates: [], error: error.message };
    }
}

export async function applyShippingUpdatesAction(updates: SyncPreviewItem[], businessId: string, shippingProvider?: string): Promise<{ success: boolean; error?: string }> {
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
            const updatePayload: any = { status: update.newStatus };
            if (update.newStatus === "Shipped" && shippingProvider) {
                updatePayload.shipping_company_id = shippingProvider;
            }
            const { error } = await supabase
                .from("orders")
                .update(updatePayload)
                .eq("business_id", businessId)
                .eq("id", update.orderId);
            if (error) {
                console.error(`Failed to update order ${update.orderId}:`, error);
            } else {
                logBusinessAction({
                    businessId,
                    userEmail: "System / Shipping Sync",
                    actionType: "update_status",
                    entityType: "order",
                    entityId: update.orderId,
                    entityName: `Order #${update.orderId.substring(0, 8)} (${update.customerName || "Customer"})`,
                    changes: [
                        { field: "Status", old_value: update.oldStatus, new_value: update.newStatus }
                    ]
                });

                syncStatusToEasyOrders(update.orderId, update.newStatus, businessId).catch(err => {

                    console.error("Failed to sync status to EasyOrders:", err);
                });

                // VROBO Integration for problematic orders
                if (update.newStatus === "Returning" || update.newStatus === "Hold To redeliver") {
                    processOrderForVrobo(update.orderId).catch(err => {
                        console.error("Failed to process VROBO sync:", err);
                    });
                }
            }
        }

        if (updates.length > 0) {
            logIntegrationActivity(businessId, "Telegraph", "success", `Successfully synced ${updates.length} orders.`, { updates });
        }

        return { success: true };
    } catch (error: any) {
        console.error("Apply sync error:", error);
        logIntegrationActivity(businessId, "Telegraph", "error", `Failed to apply shipping updates: ${error.message}`);
        return { success: false, error: error.message };
    }
}

export async function debugTelegraphSearch(businessId: string, refNumber: string): Promise<any> {
    try {
        const cookieStore = await cookies();
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
        
        const supabase = createServerClient(
            supabaseUrl,
            supabaseKey,
            {
                cookies: {
                    get(name: string) { return cookieStore.get(name)?.value; },
                },
            }
        );

        const { data: business } = await supabase.from("businesses").select("theme_config").eq("id", businessId).single();
        const telegraphConfig = business?.theme_config?.integrations?.shipping?.telegraph;
        
        if (!telegraphConfig || !telegraphConfig.enabled) {
            return { error: "Telegraph not enabled" };
        }

        const token = await loginAccurate(telegraphConfig.username, telegraphConfig.password);
        
        const query = `
            query {
                byRef: listShipments(first: 10, input: { refNumber: "${refNumber}" }) {
                    data {
                        id
                        code
                        refNumber
                        status {
                            name
                        }
                    }
                }
                bySearch: listShipments(first: 10, input: { search: "${refNumber}" }) {
                    data {
                        id
                        code
                        refNumber
                        status {
                            name
                        }
                    }
                }
            }
        `;
        
        const res = await fetch("https://system.telegraphex.com:8443/graphql", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ query }),
            cache: "no-store"
        });
        
        const json = await res.json();
        return { data: json };
    } catch (error: any) {
        return { error: error.message };
    }
}

export async function previewGenericShippingSyncAction(businessId: string, providerKey: "jt" | "aramex" | "filtareeq"): Promise<{ updates: SyncPreviewItem[], debugInfo?: any, error?: string }> {
    try {
        const cookieStore = await cookies();
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
        
        const supabase = createServerClient(supabaseUrl, supabaseKey, {
            cookies: { get(name: string) { return cookieStore.get(name)?.value; }, },
        });

        const { data: business } = await supabase
            .from("businesses")
            .select("theme_config")
            .eq("id", businessId)
            .single();

        const config = business?.theme_config?.integrations?.shipping?.[providerKey];
        if (!config || !config.enabled || !config.apiKey) {
            return { updates: [], error: `${providerKey} integration is not configured or disabled in settings.` };
        }

        const { data: orders, error: ordersError } = await supabase
            .from("orders")
            .select("id, customer_info, status, tags")
            .eq("business_id", businessId)
            .in("status", ["Prepared", "Hold To redeliver", "Shipped", "Returning"]);

        if (ordersError) throw new Error(ordersError.message);
        if (!orders || orders.length === 0) return { updates: [], debugInfo: { message: "No active orders found" } };

        const refNumbers = orders.map(o => o.id.substring(0, 8));
        let shipments: any[] = [];
        let mapStatus: (v: string) => string | null = () => null;

        if (providerKey === "jt") {
            shipments = await fetchJTShipments(config, refNumbers);
            mapStatus = mapJTStatusToZuha;
        } else if (providerKey === "aramex") {
            shipments = await fetchAramexShipments(config, refNumbers);
            mapStatus = mapAramexStatusToZuha;
        } else if (providerKey === "filtareeq") {
            shipments = await fetchFiltareeqShipments(config, refNumbers);
            mapStatus = mapFiltareeqStatusToZuha;
        }

        const debugInfo = {
            activeRefNumbers: refNumbers,
            fetchedShipments: shipments.map((s: any) => ({ ref: s.zuhaRef || s.trackingNumber, code: s.state?.code, value: s.state?.value }))
        };

        const updates: SyncPreviewItem[] = [];

        for (const order of orders) {
            const shortId = order.id.substring(0, 8);
            const match = shipments.find((s: any) => {
                const matchRef = s.zuhaRef ? s.zuhaRef : s.trackingNumber;
                return matchRef && matchRef.toLowerCase() === shortId.toLowerCase();
            });

            if (match) {
                const newStatus = mapStatus(match.state.value);
                if (newStatus && newStatus !== order.status) {
                    updates.push({
                        orderId: order.id,
                        customerName: (order.customer_info as any)?.name || "N/A",
                        oldStatus: order.status,
                        newStatus: newStatus,
                        accurateStatusName: match.state.value
                    });
                }
            }
        }

        return { updates, debugInfo };
    } catch (error: any) {
        console.error(`Preview sync error (${providerKey}):`, error);
        return { updates: [], error: error.message };
    }
}
