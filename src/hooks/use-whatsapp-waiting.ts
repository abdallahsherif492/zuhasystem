"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * How many WhatsApp chats are waiting for a reply (the customer wrote last),
 * for the menu badge. Live: a customer's message updates it at once, and the
 * tab's title shows it too, so it is seen from another tab. Nothing before
 * 20261124 is run, or for a business with no number.
 */
export function useWhatsAppWaiting(businessId: string | undefined) {
    const [count, setCount] = useState(0);
    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        const load = async () => {
            const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
            const { data, error } = await supabase.from("whatsapp_messages").select("customer_phone, direction, type, sent_at")
                .eq("business_id", businessId).gte("sent_at", since).order("sent_at", { ascending: false }).limit(3000);
            if (gone || error) return;
            const last = new Map<string, string>();
            for (const m of data || []) if (m.type !== "reaction" && !last.has(m.customer_phone)) last.set(m.customer_phone, m.direction);
            setCount([...last.values()].filter(d => d === "in").length);
        };
        load();
        const timer = setInterval(load, 120_000);
        const channel = supabase.channel(`wa-waiting-${businessId}`)
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages", filter: `business_id=eq.${businessId}` }, () => load())
            .subscribe();
        return () => { gone = true; clearInterval(timer); supabase.removeChannel(channel); };
    }, [businessId]);

    // The count in the tab's title, so it shows from any other tab.
    useEffect(() => {
        const base = document.title.replace(/^\(\d+\)\s*/, "");
        document.title = count > 0 ? `(${count}) ${base}` : base;
    }, [count]);
    return count;
}
