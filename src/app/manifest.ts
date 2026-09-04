import type { MetadataRoute } from "next";

/**
 * What Android and iOS read when someone installs this from the browser.
 *
 * A route rather than a static public/manifest.json so it stays in one place
 * with the rest of the app's metadata and cannot drift out of sync with the
 * icons that actually exist in public/.
 *
 * `display: standalone` is the point of the whole exercise: the moderators work
 * on phones, and the browser's address bar and toolbars were eating close to a
 * fifth of a 812px screen on the busiest page in the system.
 */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "eCommerx",
        short_name: "eCommerx",
        description: "نظام إدارة الأوردرات والمخزون والحسابات",
        start_url: "/dashboard",
        // Launching straight into the dashboard rather than "/" saves the
        // redirect hop the middleware would otherwise do on every cold start.
        id: "/dashboard",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#ffffff",
        theme_color: "#6366f1",
        dir: "rtl",
        lang: "ar",
        categories: ["business", "productivity"],
        icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            // Separate file, not the same one reused: a launcher crops a
            // maskable icon to its own shape, and the transparent versions
            // above would lose the corners of the box.
            { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
            {
                name: "أوردرات الموقع",
                short_name: "الموقع",
                url: "/platform-orders",
                icons: [{ src: "/icon-192.png", sizes: "192x192" }],
            },
            {
                name: "الأوردرات",
                short_name: "أوردرات",
                url: "/orders",
                icons: [{ src: "/icon-192.png", sizes: "192x192" }],
            },
            {
                name: "الشحن",
                short_name: "شحن",
                url: "/logistics",
                icons: [{ src: "/icon-192.png", sizes: "192x192" }],
            },
        ],
    };
}
