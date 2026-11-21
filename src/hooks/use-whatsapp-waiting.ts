"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * How many WhatsApp chats are waiting for a reply (the customer wrote last),
 * for the menu badge. Live: a customer's message updates it at once, and the
 * tab's title shows it too, so it is seen from another tab. Read once, then
 * kept current from the live feed (no polling). Nothing before
 * 20261124 is run, or for a business with no number.
 */
export function useWhatsAppWaiting(businessId: string | undefined) {
    const [count, setCount] = useState(0);
    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        // One number from the database (whatsapp_waiting_count, 20261129); before
        // that migration, worked out here from the latest messages.
        const last = new Map<string, { direction: string; at: string }>();
        let fromDb = true;
        const recount = () => { if (!gone) setCount([...last.values()].filter(v => v.direction === "in").length); };
        const load = async () => {
            if (fromDb) {
                const { data, error } = await supabase.rpc("whatsapp_waiting_count", { p_business: businessId });
                if (gone) return;
                if (!error) { setCount(Number(data) || 0); return; }
                fromDb = false;
            }
            const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
            const { data, error } = await supabase.from("whatsapp_messages").select("customer_phone, direction, type, sent_at")
                .eq("business_id", businessId).gte("sent_at", since).order("sent_at", { ascending: false }).limit(1000);
            if (gone || error) return;
            last.clear();
            for (const m of data || []) if (m.type !== "reaction" && !last.has(m.customer_phone)) last.set(m.customer_phone, { direction: m.direction, at: m.sent_at });
            recount();
        };
        load();
        const channel = supabase.channel(`wa-waiting-${businessId}`)
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages", filter: `business_id=eq.${businessId}` }, payload => {
                const m = payload.new as { customer_phone: string; direction: string; type: string; sent_at: string };
                if (!m?.customer_phone || m.type === "reaction") return;
                if (fromDb) { if (timer) clearTimeout(timer); timer = setTimeout(load, 1500); return; }
                const prev = last.get(m.customer_phone);
                if (!prev || prev.at <= m.sent_at) last.set(m.customer_phone, { direction: m.direction, at: m.sent_at });
                recount();
            })
            .subscribe();
        return () => { gone = true; if (timer) clearTimeout(timer); supabase.removeChannel(channel); };
    }, [businessId]);

    // The count in the tab's title, so it shows from any other tab.
    useEffect(() => {
        const base = document.title.replace(/^\(\d+\)\s*/, "");
        document.title = count > 0 ? `(${count}) ${base}` : base;
    }, [count]);
    return count;
}
