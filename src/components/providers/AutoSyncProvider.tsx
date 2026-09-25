"use client";

import { useEffect } from "react";
import { useBusiness } from "@/contexts/BusinessContext";
import { safeLocal } from "@/lib/safe-storage";

/**
 * Pings the auto-sync endpoint while someone has the dashboard open, as a
 * fallback to the external scheduler. The endpoint itself decides whether a
 * sync is due (every 15 minutes by default), so pinging more often than that
 * only costs requests.
 *
 * It used to ping every minute from every open tab of every staff member —
 * hidden tabs included. Now one tab per browser does it, only while visible,
 * and at most every five minutes: the same syncs run, far fewer requests.
 */
const PING_INTERVAL = 5 * 60 * 1000;
const LAST_PING_KEY = "ecx:autoSyncLastPing";

export function AutoSyncProvider({ children }: { children: React.ReactNode }) {
    const { activeBusiness } = useBusiness();

    useEffect(() => {
        if (!activeBusiness) return;
        // Same trigger as before: Telegraph or VROBO auto-sync switched on.
        const integrations = activeBusiness.theme_config?.integrations;
        if (!integrations?.shipping?.telegraph?.autoSync && !integrations?.tools?.vrobo?.autoSync) return;

        const maybePing = () => {
            if (document.visibilityState === "hidden") return;
            // Shared across tabs: whichever tab gets here first after five
            // minutes pings, the others see the fresh stamp and skip.
            const last = Number(safeLocal.get(LAST_PING_KEY) || 0);
            if (Date.now() - last < PING_INTERVAL) return;
            safeLocal.set(LAST_PING_KEY, String(Date.now()));
            fetch("/api/cron/auto-sync", { method: "GET", headers: { "Cache-Control": "no-cache" } })
                .catch(err => console.error("[AutoSyncProvider] Failed to ping sync endpoint:", err));
        };

        maybePing();
        const timer = setInterval(maybePing, 60 * 1000);
        document.addEventListener("visibilitychange", maybePing);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", maybePing);
        };
    }, [activeBusiness]);

    return <>{children}</>;
}
