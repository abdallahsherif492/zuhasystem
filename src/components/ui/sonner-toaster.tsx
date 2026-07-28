"use client";

import { useTheme } from "next-themes";
import { Toaster as SonnerToaster } from "sonner";

/**
 * Host for the `toast()` calls used across the dashboard.
 *
 * `sonner` renders nothing unless this is mounted, so it lives in the root
 * layout. Theme follows next-themes; `dir="auto"` makes sonner read the
 * document direction, which LanguageContext keeps in sync with the business's
 * layout-direction setting.
 */
export function Toaster() {
    const { resolvedTheme } = useTheme();

    return (
        <SonnerToaster
            theme={resolvedTheme === "dark" ? "dark" : "light"}
            dir="auto"
            position="top-center"
            richColors
            closeButton
        />
    );
}
