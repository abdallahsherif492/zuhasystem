"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { safeLocal } from "@/lib/safe-storage";
import { useBusiness } from "@/contexts/BusinessContext";

/**
 * Whether this store is still getting started, and whether its owner asked to
 * see the whole menu anyway.
 *
 * A brand-new merchant opened the app to 33 pages — payables, courier
 * settlements, damages, attendance, leave requests, an audit log, six reports —
 * built for a business with thousands of orders and a team. Every one of the
 * merchants who signed up from ads left the same day. Until a store has real
 * volume the menu shows only what the first week needs; everything else is one
 * tap away and never disabled, only tucked away.
 *
 * Decided by volume, not by date, so an established store never sees a change:
 * at STARTER_ORDER_LIMIT orders the full menu comes back for good.
 */
export const STARTER_ORDER_LIMIT = 30;

/** Pages a store needs before it has volume. Everything else waits behind "all pages". */
export const STARTER_PAGES = new Set([
    "/getting-started", "/dashboard", "/guide",
    "/orders", "/platform-orders", "/logistics",
    "/products", "/shipping", "/settings",
]);

const EVENT = "ecx-menu-mode";
const key = (businessId: string) => `ecx:fullMenu:${businessId}`;

export function useStarterMode() {
    const { activeBusiness } = useBusiness();
    const businessId = activeBusiness?.id;
    // null until known. Unknown shows the full menu, so a store that has always
    // seen everything never watches items vanish while the count loads.
    // Keyed by store so switching stores reads as "unknown" until its own count arrives.
    const [measured, setMeasured] = useState<{ businessId: string; starter: boolean } | null>(null);
    const isStarter = measured && measured.businessId === businessId ? measured.starter : null;
    const [showAll, setShowAllState] = useState(false);

    useEffect(() => {
        if (!businessId) return;
        let cancelled = false;
        supabase.from("orders").select("id").eq("business_id", businessId).limit(STARTER_ORDER_LIMIT)
            .then(({ data, error }) => {
                if (cancelled) return;
                setMeasured({ businessId, starter: error ? false : (data?.length ?? 0) < STARTER_ORDER_LIMIT });
            });
        return () => { cancelled = true; };
    }, [businessId]);

    useEffect(() => {
        if (!businessId) return;
        const read = () => setShowAllState(safeLocal.get(key(businessId)) === "1");
        read();
        // The desktop sidebar and the mobile drawer each hold their own copy.
        window.addEventListener(EVENT, read);
        return () => window.removeEventListener(EVENT, read);
    }, [businessId]);

    const setShowAll = useCallback((value: boolean) => {
        if (!businessId) return;
        safeLocal.set(key(businessId), value ? "1" : "0");
        window.dispatchEvent(new Event(EVENT));
    }, [businessId]);

    return {
        isStarter: isStarter === true,
        /** The trimmed menu is in effect. */
        simpleMenu: isStarter === true && !showAll,
        showAll,
        setShowAll,
    };
}
