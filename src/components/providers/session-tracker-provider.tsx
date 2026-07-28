"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import {
    getSessionId,
    getDeviceType,
    getBrowser,
    getOS,
    getScreenSize,
    getViewport,
    getTimezone,
    getExternalReferrer,
} from "@/lib/session-tracker";

/** How often an open tab reports that it is still there. */
const HEARTBEAT_MS = 15_000;

/**
 * Reports this tab's presence into `live_sessions` so System Admin > Live
 * Analytics can show who is using the platform right now.
 *
 * Presence is heartbeat-based rather than event-based: a row is "live" while
 * its last_seen_at is recent, so a closed laptop or crashed tab disappears on
 * its own without needing a reliable unload signal.
 */
export function SessionTrackerProvider() {
    const pathname = usePathname();
    const { currentUser, activeBusiness } = useBusiness();

    // Kept in refs so the heartbeat interval always sends current values
    // without being torn down and recreated on every navigation.
    const pathRef = useRef(pathname);
    const pageEnteredAt = useRef<string>(new Date().toISOString());
    const pageViews = useRef(1);
    const entryPage = useRef<string>("");
    const isIdle = useRef(false);

    // Holds the latest reporter so navigation can fire one immediately without
    // tearing down and rebuilding the heartbeat interval.
    const reportRef = useRef<() => void>(() => {});

    useEffect(() => {
        if (pathRef.current !== pathname) {
            pathRef.current = pathname;
            pageEnteredAt.current = new Date().toISOString();
            pageViews.current += 1;
            reportRef.current();
        }
    }, [pathname]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (!entryPage.current) entryPage.current = pathRef.current || "/";

        const sessionId = getSessionId();
        if (!sessionId) return;

        let stopped = false;

        const report = async () => {
            if (stopped) return;

            const row = {
                session_id: sessionId,
                user_email: currentUser?.email ?? null,
                business_id: activeBusiness?.id ?? null,
                business_name: activeBusiness?.name ?? null,
                page_path: pathRef.current || "/",
                page_title: typeof document !== "undefined" ? document.title : null,
                page_entered_at: pageEnteredAt.current,
                page_views: pageViews.current,
                device_type: getDeviceType(),
                browser: getBrowser(),
                os: getOS(),
                screen_size: getScreenSize(),
                viewport: getViewport(),
                language: navigator.language || null,
                timezone: getTimezone(),
                referrer: getExternalReferrer() || null,
                entry_page: entryPage.current,
                is_idle: isIdle.current,
                last_seen_at: new Date().toISOString(),
            };

            // Upsert keeps started_at from the original insert (it is not in
            // the payload) while refreshing everything else.
            const { error } = await supabase
                .from("live_sessions")
                .upsert(row, { onConflict: "session_id" });

            // Silent by design: analytics must never interrupt the app. The
            // most likely cause is the migration not having been run yet.
            if (error && process.env.NODE_ENV === "development") {
                console.warn("[SessionTracker]", error.message);
            }
        };

        reportRef.current = report;
        report();
        const interval = setInterval(report, HEARTBEAT_MS);

        // A backgrounded tab is still open but not in use — worth
        // distinguishing from someone actively working.
        const onVisibility = () => {
            isIdle.current = document.visibilityState === "hidden";
            report();
        };
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            stopped = true;
            clearInterval(interval);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [currentUser?.email, activeBusiness?.id, activeBusiness?.name]);

    return null;
}
