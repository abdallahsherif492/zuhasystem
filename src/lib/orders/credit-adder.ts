import { supabase } from "@/lib/supabase";

/**
 * A moderator added a product (or a bundle) to an order by hand: the order
 * is credited to them (orders.closed_by), so its commission and the league
 * count it, unless someone was credited already (who confirmed it by hand,
 * or entered it). Orders confirmed on their own by WhatsApp carry no
 * closed_by and earn nobody commission until a person does something on them.
 * Returns who it is credited to now, or null when that did not change.
 */
export async function creditAdder(businessId: string | undefined, orderId: string, email: string | null | undefined): Promise<string | null> {
    if (!businessId || !email) return null;
    const { data } = await supabase.from("orders").update({ closed_by: email })
        .eq("business_id", businessId).eq("id", orderId).is("closed_by", null).select("closed_by");
    return data?.[0]?.closed_by ?? null;
}
