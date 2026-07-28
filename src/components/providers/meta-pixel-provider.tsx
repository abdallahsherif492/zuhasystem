"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { initMetaPixel, disableMetaPixel, trackPageView } from "@/lib/meta-pixel";

/**
 * Routes the pixel is allowed to run on.
 *
 * Deliberately limited to the public marketing funnel: the dashboard is a
 * private multi-tenant workspace, and its URLs carry order/customer/business
 * identifiers that should not be handed to Meta on every navigation.
 */
const TRACKED_ROUTES = ["/landing", "/register", "/login"];

const isTrackedRoute = (pathname: string | null) =>
    !!pathname && TRACKED_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));

/**
 * Loads the Meta Pixel when a System Admin has enabled it in
 * System Admin > Settings, and fires a PageView on every marketing-page
 * navigation. Renders nothing.
 */
export function MetaPixelProvider() {
    const pathname = usePathname();
    // State (not a ref) so the PageView effect re-runs once the settings
    // request resolves and the pixel actually becomes available.
    const [activePixelId, setActivePixelId] = useState<string | null>(null);
    const lastTrackedPath = useRef<string | null>(null);

    // Load (or tear down) the pixel based on the platform settings.
    useEffect(() => {
        let cancelled = false;

        const syncPixel = async () => {
            const { data, error } = await supabase
                .from("platform_settings")
                .select("meta_pixel_enabled, meta_pixel_id")
                .eq("id", "global")
                .single();

            if (cancelled || error) return;

            const enabled = data?.meta_pixel_enabled === true;
            const pixelId = (data?.meta_pixel_id || "").trim();

            if (!enabled || !pixelId) {
                disableMetaPixel();
                lastTrackedPath.current = null;
                setActivePixelId(null);
                return;
            }

            initMetaPixel(pixelId);
            setActivePixelId((previous) => {
                // The admin swapped the Pixel ID while the app was open.
                if (previous && previous !== pixelId) lastTrackedPath.current = null;
                return pixelId;
            });
        };

        syncPixel();
        return () => {
            cancelled = true;
        };
    }, []);

    // Fire a PageView per marketing-page navigation, once the pixel is live.
    useEffect(() => {
        if (!activePixelId) return;
        if (!isTrackedRoute(pathname)) return;
        if (lastTrackedPath.current === pathname) return;

        trackPageView();
        lastTrackedPath.current = pathname;
    }, [pathname, activePixelId]);

    return null;
}
