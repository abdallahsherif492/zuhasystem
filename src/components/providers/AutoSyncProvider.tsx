"use client";

import { useEffect, useRef } from "react";
import { useBusiness } from "@/contexts/BusinessContext";

// This component silently pings the auto-sync endpoint if any sync is enabled
// It ensures syncs happen as long as the user has the dashboard open, serving as a fallback to external crons.
export function AutoSyncProvider({ children }: { children: React.ReactNode }) {
    const { activeBusiness } = useBusiness();
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!activeBusiness) return;

        const integrations = activeBusiness.theme_config?.integrations;
        const telegraphAutoSync = integrations?.shipping?.telegraph?.autoSync;
        const vroboAutoSync = integrations?.tools?.vrobo?.autoSync;

        // If no auto-sync is enabled, clear any existing interval
        if (!telegraphAutoSync && !vroboAutoSync) {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            return;
        }

        // We check every 1 minute. The backend will determine if it's actually time to run based on lastSyncAt
        const PING_INTERVAL = 60 * 1000; // 1 minute

        const pingSyncEndpoint = async () => {
            try {
                // Call the API endpoint silently
                await fetch('/api/cron/auto-sync', {
                    method: 'GET',
                    headers: {
                        'Cache-Control': 'no-cache',
                    }
                });
            } catch (err) {
                console.error("[AutoSyncProvider] Failed to ping sync endpoint:", err);
            }
        };

        // Initial Ping
        pingSyncEndpoint();

        // Setup interval
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(pingSyncEndpoint, PING_INTERVAL);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [activeBusiness]);

    return <>{children}</>;
}
