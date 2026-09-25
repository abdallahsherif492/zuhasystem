"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useStarterMode } from "@/hooks/use-starter-mode";
import { activationAlreadyReported, reportActivation } from "@/lib/activation";
import { TutorialFloatingButton } from "@/components/onboarding/tutorials";

/** Stores older than this are not new signups; their first product is long past. */
const NEW_STORE_DAYS = 30;

/**
 * What a store still getting started gets on top of the normal app: a tutorial
 * video button on every screen, and — once — a signal to Meta that this signup has
 * started using the system. Renders nothing for an established store.
 */
export function StarterExtras() {
    const { activeBusiness } = useBusiness();
    const { isStarter } = useStarterMode();
    const pathname = usePathname();
    const businessId = activeBusiness?.id;

    useEffect(() => {
        if (!businessId || !isStarter || activationAlreadyReported(businessId)) return;
        let cancelled = false;
        (async () => {
            const { data: biz } = await supabase.from("businesses").select("created_at").eq("id", businessId).single();
            const created = biz?.created_at ? new Date(biz.created_at).getTime() : 0;
            if (cancelled || !created || Date.now() - created > NEW_STORE_DAYS * 86_400_000) return;

            const tc = activeBusiness?.theme_config || {};
            const platform = !!(tc.easyorders_token || tc.integrations?.platforms?.easyorders?.webhookToken
                || tc.integrations?.platforms?.easyorders?.apiKey || tc.integrations?.platforms?.shopify?.enabled);
            const [products, orders] = await Promise.all([
                supabase.from("products").select("id").eq("business_id", businessId).limit(1),
                supabase.from("orders").select("id").eq("business_id", businessId).limit(1),
            ]);
            if (cancelled) return;
            const reason = orders.data?.length ? "order" : products.data?.length ? "product" : platform ? "platform" : null;
            if (reason) await reportActivation(businessId, reason);
        })();
        return () => { cancelled = true; };
        // pathname: re-check after each page, since that is when a product or a
        // connection has just been saved.
    }, [businessId, isStarter, pathname, activeBusiness?.theme_config]);

    if (!isStarter) return null;
    // Videos first: new stores messaged us before trying anything. WhatsApp
    // is still one tap away, under each video.
    return <TutorialFloatingButton />;
}
