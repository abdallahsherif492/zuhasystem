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

            // Written through a SECURITY DEFINER function rather than the
            // table: upserting directly needs a SELECT policy on the row, and
            // only System Admins may read this table — so a direct write
            // silently failed for everyone else, including every anonymous
            // visitor on the marketing pages. The function also takes the
            // signed-in identity from the JWT, so it cannot be spoofed here.
            const { error } = await supabase.rpc("record_live_session", {
                p_session_id: sessionId,
                p_page_path: pathRef.current || "/",
                p_business_id: activeBusiness?.id ?? null,
                p_business_name: activeBusiness?.name ?? null,
                p_page_title: typeof document !== "undefined" ? document.title : null,
                p_page_entered_at: pageEnteredAt.current,
                p_page_views: pageViews.current,
                p_device_type: getDeviceType(),
                p_browser: getBrowser(),
                p_os: getOS(),
                p_screen_size: getScreenSize(),
                p_viewport: getViewport(),
                p_language: navigator.language || null,
                p_timezone: getTimezone(),
                p_referrer: getExternalReferrer() || null,
                p_entry_page: entryPage.current,
                p_is_idle: isIdle.current,
            });

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
        // currentUser is not sent (the function reads it from the JWT) but is
        // still a dependency: signing in or out has to re-report immediately
        // so the session flips between anonymous and identified.
    }, [currentUser?.email, activeBusiness?.id, activeBusiness?.name]);

    return null;
}
