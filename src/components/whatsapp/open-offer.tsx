"use client";

import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { whatsappSettingsOf } from "@/lib/whatsapp/settings";
import { tappedButtonId } from "@/lib/whatsapp/chats";

/**
 * Orders whose customer still has the offer open (lib/whatsapp/upsell.ts):
 * sent less than `offer_hours` ago and not answered «لا شكراً». A product may
 * still be added, so the fulfilment page says so until the time is up; then
 * the order is final. Read once, then kept current from the live feed.
 */
export function useOpenOffers(businessId: string | undefined) {
    const [offers, setOffers] = useState<Map<string, number>>(new Map());
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const load = async () => {
            const [{ data: b }, { data: sent }, { data: declined }] = await Promise.all([
                supabase.from("businesses").select("theme_config").eq("id", businessId).maybeSingle(),
                supabase.from("whatsapp_messages").select("order_id, sent_at").eq("business_id", businessId).eq("direction", "out")
                    .eq("payload->>kind", "upsell").gte("sent_at", new Date(Date.now() - 86_400_000).toISOString()).limit(1000),
                supabase.from("whatsapp_messages").select("payload").eq("business_id", businessId).eq("direction", "in")
                    .or("payload->interactive->button_reply->>id.like.upsell:no:*,payload->button->>payload.like.upsell:no:*").gte("sent_at", new Date(Date.now() - 86_400_000).toISOString()).limit(1000),
            ]);
            if (gone) return;
            const hours = whatsappSettingsOf(b?.theme_config).upsell.offer_hours;
            const no = new Set((declined || []).map(d => tappedButtonId(d.payload).split(":")[2]));
            const out = new Map<string, number>();
            for (const m of sent || []) {
                if (!m.order_id || no.has(m.order_id)) continue;
                const until = Date.parse(m.sent_at) + hours * 3_600_000;
                if (until > (out.get(m.order_id) || 0)) out.set(m.order_id, until);
            }
            setOffers(out);
        };
        load();
        const channel = supabase.channel(`wa-open-offers-${businessId}`)
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages", filter: `business_id=eq.${businessId}` }, () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(load, 1500);
            })
            .subscribe();
        return () => { gone = true; if (timer) clearTimeout(timer); supabase.removeChannel(channel); };
    }, [businessId]);
    return (orderId: string) => { const u = offers.get(orderId); return u && u > now ? u : null; };
}

export function OpenOfferBadge({ until }: { until: number }) {
    const at = new Date(until).toLocaleTimeString("ar-EG-u-nu-latn", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" });
    return (
        <span dir="rtl" title="العميل ممكن يضيف منتج من العرض لحد الوقت ده. بعده الأوردر نهائي."
            className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
            <Gift className="h-3 w-3" />عرض مفتوح للعميل لحد {at}
        </span>
    );
}
