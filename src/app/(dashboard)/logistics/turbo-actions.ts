"use server";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
    TURBO_CAIRO_GIZA_OUTSKIRTS, TURBO_GOVERNORATE, addTurboOrder, getTurboAreas, getTurboGovernments, guessTurboArea,
    type TurboConfig, type TurboPlace,
} from "@/lib/shipping/turbo";
import { logIntegrationActivity } from "@/lib/logs/integration-logger";
import { logBusinessAction } from "@/lib/logs/actions-logger";

/**
 * Sending orders to Turbo from the logistics page: first a preview of what
 * would go (governorate, guessed area, amount to collect), then the send.
 * Both run as the signed-in user, so row-level security keeps each business
 * to its own orders.
 */

async function memberClient(businessId: string) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) throw new Error("Sign in again.");
    const { data: member } = await supabase.from("business_users").select("id")
        .eq("business_id", businessId).ilike("user_email", user.email).maybeSingle();
    if (!member) throw new Error("You are not a member of this business.");
    const { data: business } = await supabase.from("businesses").select("theme_config").eq("id", businessId).single();
    const config = business?.theme_config?.integrations?.shipping?.turbo as TurboConfig | undefined;
    if (!config?.enabled || !config.apiKey || !config.accountId) {
        throw new Error("Turbo is not set up. Add the authentication key and client code in Settings → Integrations.");
    }
    return { supabase, config, email: user.email };
}

interface OrderRow {
    id: string;
    status: string | null;
    customer_info: { name?: string; phone?: string; phone2?: string; address?: string; governorate?: string } | null;
    total_amount: number | null;
    paid_amount: number | null;
    payment_status: string | null;
    notes: string | null;
    courier_code?: string | null;
    items: { quantity: number; unmapped_name: string | null; variant: { title: string | null; product: { name: string | null } | null } | null }[];
}

const ORDER_SELECT = "id, status, customer_info, total_amount, paid_amount, payment_status, notes, courier_code, items:order_items(quantity, unmapped_name, variant:variants(title, product:products(name)))";

/** What the courier collects: the total less any deposit already paid. */
const amountToCollect = (o: OrderRow) =>
    o.payment_status === "Paid" ? 0 : Math.max(0, (Number(o.total_amount) || 0) - (Number(o.paid_amount) || 0));

const summaryOf = (o: OrderRow) => (o.items || []).map(i => {
    const name = i.variant?.product?.name || i.unmapped_name || "منتج";
    const v = i.variant?.title && i.variant.title !== "Default" ? ` - ${i.variant.title}` : "";
    return `${i.quantity}× ${name}${v}`;
}).join(" + ").slice(0, 250);

export interface TurboPreviewRow {
    orderId: string;
    reference: string;
    customer: string;
    phone: string;
    address: string;
    governorate: string;
    governmentId: number | null;
    areaId: number | null;
    areaGuessed: boolean;
    total: number;
    deposit: number;
    amount: number;
    alreadySent: string | null;
    status: string | null;
}

export async function turboPrepareAction(businessId: string, orderIds: string[]): Promise<{
    rows: TurboPreviewRow[]; governments: TurboPlace[]; areas: Record<number, TurboPlace[]>; error?: string;
}> {
    try {
        const { supabase } = await memberClient(businessId);
        const orders: OrderRow[] = [];
        for (let i = 0; i < orderIds.length; i += 100) {
            const { data, error } = await supabase.from("orders").select(ORDER_SELECT)
                .eq("business_id", businessId).in("id", orderIds.slice(i, i + 100));
            if (error) {
                if (/courier_code/.test(error.message)) throw new Error("Run supabase/migrations/20261019_courier_codes.sql first.");
                throw error;
            }
            orders.push(...((data as unknown as OrderRow[]) || []));
        }
        const governments = (await getTurboGovernments()).filter(g => g.id !== 29); // not international
        const areas: Record<number, TurboPlace[]> = {};
        const areasOf = async (id: number) => (areas[id] ??= await getTurboAreas(id));

        const rows: TurboPreviewRow[] = [];
        for (const o of orders) {
            const ci = o.customer_info || {};
            let governmentId = TURBO_GOVERNORATE[ci.governorate || ""] ?? null;
            let area: TurboPlace | null = null;
            if (governmentId) {
                area = guessTurboArea(ci.address || "", await areasOf(governmentId));
                // Not found in Cairo or Giza: it may be on the edge, which Turbo
                // keeps as a governorate of its own.
                if (!area && (governmentId === 1 || governmentId === 2)) {
                    const edge = guessTurboArea(ci.address || "", await areasOf(TURBO_CAIRO_GIZA_OUTSKIRTS));
                    if (edge) { area = edge; governmentId = TURBO_CAIRO_GIZA_OUTSKIRTS; }
                }
            }
            const deposit = o.payment_status === "Paid" ? Number(o.total_amount) || 0 : Number(o.paid_amount) || 0;
            rows.push({
                orderId: o.id, reference: o.id.slice(0, 8), customer: ci.name || "", phone: ci.phone || "",
                address: ci.address || "", governorate: ci.governorate || "",
                governmentId, areaId: area?.id ?? null, areaGuessed: !!area,
                total: Number(o.total_amount) || 0, deposit, amount: amountToCollect(o),
                alreadySent: o.courier_code || null, status: o.status,
            });
        }
        const order = new Map(orderIds.map((id, i) => [id, i]));
        rows.sort((a, b) => (order.get(a.orderId) ?? 0) - (order.get(b.orderId) ?? 0));
        return { rows, governments, areas };
    } catch (e) {
        return { rows: [], governments: [], areas: {}, error: (e as Error).message };
    }
}

export async function turboAreasAction(governmentId: number): Promise<TurboPlace[]> {
    return getTurboAreas(governmentId);
}

export interface TurboSendResult { orderId: string; ok: boolean; code?: string; message?: string }

export async function turboSendAction(businessId: string, items: { orderId: string; governmentId: number; areaId: number }[]): Promise<{ results: TurboSendResult[]; error?: string }> {
    try {
        const { supabase, config, email } = await memberClient(businessId);
        const results: TurboSendResult[] = [];
        for (const item of items) {
            const { data: o, error } = await supabase.from("orders").select(ORDER_SELECT)
                .eq("business_id", businessId).eq("id", item.orderId).single();
            if (error || !o) { results.push({ orderId: item.orderId, ok: false, message: error?.message || "Order not found" }); continue; }
            const order = o as unknown as OrderRow;
            // Never twice: a second send would be a second parcel.
            if (order.courier_code) { results.push({ orderId: order.id, ok: false, message: `Already sent as ${order.courier_code}` }); continue; }

            const ci = order.customer_info || {};
            const ref = order.id.slice(0, 8);
            const res = await addTurboOrder(config, {
                government: item.governmentId,
                area: item.areaId,
                address: ci.address || "",
                amount_to_be_collected: amountToCollect(order),
                order_summary: summaryOf(order),
                notes: order.notes || "",
                remote_order_id: ref,
                invoice_number: ref,
                receiver: ci.name || "",
                phone1: ci.phone || "",
                phone2: ci.phone2 || undefined,
            });

            if (!res.ok) {
                results.push({ orderId: order.id, ok: false, message: res.message });
                await logIntegrationActivity(businessId, "Turbo", "error", `Order #${ref} was not sent to Turbo: ${res.message}`, { orderId: order.id, governmentId: item.governmentId, areaId: item.areaId });
                continue;
            }

            const patch: Record<string, unknown> = { courier_code: res.code, courier_sent_at: new Date().toISOString() };
            if (config.shippingCompanyId) patch.shipping_company_id = config.shippingCompanyId;
            const { error: upErr } = await supabase.from("orders").update(patch).eq("business_id", businessId).eq("id", order.id);
            results.push({ orderId: order.id, ok: true, code: res.code, message: upErr ? `Sent as ${res.code}, but the code was not saved: ${upErr.message}` : undefined });
            await logIntegrationActivity(businessId, "Turbo", "success", `Order #${ref} sent to Turbo as ${res.code} (collect ${amountToCollect(order)} EGP).`, { orderId: order.id, code: res.code });
            logBusinessAction({
                businessId, userEmail: email, actionType: "edit", entityType: "order", entityId: order.id,
                entityName: `Order #${ref} (${ci.name || "Customer"})`,
                changes: [{ field: "Turbo shipment", old_value: null, new_value: res.code }],
                metadata: { source: "turbo_send", amount_to_collect: amountToCollect(order) },
            });
        }
        return { results };
    } catch (e) {
        return { results: [], error: (e as Error).message };
    }
}
