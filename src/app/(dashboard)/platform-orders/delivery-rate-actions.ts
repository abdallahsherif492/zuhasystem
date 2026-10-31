"use server";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readDeliveryRate, type DeliveryRate } from "@/lib/easyorders-delivery-rate";

/**
 * EasyOrders' delivery rating for waiting orders that came in without one —
 * placed before the webhook kept it, or rated after the order was sent. Runs
 * as the signed-in user, so row-level security keeps each business to its own
 * orders. EasyOrders limits how fast its API is read, so a call handles a
 * handful of orders one after another and stops at the first refusal; the
 * page asks again for the rest.
 */

const EO_API = "https://api.easy-orders.net/api/v1/external-apps";
const FALLBACK_URL = "https://telkkknuygjejmqcvyev.supabase.co";
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";
const envOr = (v: string | undefined, fallback: string) => (v && v !== "undefined" ? v : fallback);
const PER_CALL = 15;

export interface DeliveryRateResult {
    rates: Record<string, DeliveryRate>;
    /** EasyOrders asked us to slow down, or there were more than one call takes. */
    more: boolean;
}

export async function fetchDeliveryRatesAction(businessId: string, orderIds: string[]): Promise<DeliveryRateResult> {
    const none = { rates: {}, more: false };
    if (!businessId || !orderIds.length) return none;

    const cookieStore = await cookies();
    const supabase = createServerClient(
        envOr(process.env.NEXT_PUBLIC_SUPABASE_URL, FALLBACK_URL),
        envOr(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, FALLBACK_KEY),
        { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return none;

    const { data: business } = await supabase.from("businesses").select("theme_config").eq("id", businessId).maybeSingle();
    const apiKey = business?.theme_config?.integrations?.platforms?.easyorders?.apiKey || business?.theme_config?.easyorders_api_key;
    if (!apiKey) return none;

    const { data: orders } = await supabase.from("orders")
        .select("id, easyorders_id, customer_info")
        .eq("business_id", businessId)
        .in("id", orderIds.slice(0, 200))
        .ilike("status", "waiting")
        .not("easyorders_id", "is", null);
    const todo = (orders || []).filter(o => !o.customer_info?.delivery_rate);

    const rates: Record<string, DeliveryRate> = {};
    let more = todo.length > PER_CALL;
    for (const o of todo.slice(0, PER_CALL)) {
        let res: Response;
        try {
            res = await fetch(`${EO_API}/orders/${encodeURIComponent(o.easyorders_id)}`, {
                headers: { "Api-Key": apiKey, Accept: "application/json" },
                cache: "no-store",
            });
        } catch { more = true; break; }
        if (res.status === 429) { more = true; break; }
        if (!res.ok) continue;
        const rate = readDeliveryRate((await res.json().catch(() => null))?.metadata);
        if (!rate) continue;
        // Merged into what is there now, not what was read above: someone may
        // have corrected the name or address in the meantime.
        const { data: fresh } = await supabase.from("orders").select("customer_info").eq("id", o.id).single();
        const { error } = await supabase.from("orders")
            .update({ customer_info: { ...(fresh?.customer_info || o.customer_info || {}), delivery_rate: rate } })
            .eq("business_id", businessId).eq("id", o.id);
        if (!error) rates[o.id] = rate;
        await new Promise(r => setTimeout(r, 250));
    }
    return { rates, more };
}
