"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, which is what makes the app installable.
 *
 * Renders nothing. Registration is deferred to the load event so it never
 * competes with the first paint for bandwidth on a phone — the worker has
 * nothing to do on the visit that installs it.
 *
 * Development is skipped on purpose: a worker holding onto hashed chunks
 * across hot reloads produces stale-module errors that look like real bugs.
 */
export function ServiceWorkerProvider() {
    useEffect(() => {
        if (process.env.NODE_ENV !== "production") return;
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

        const register = () => {
            navigator.serviceWorker.register("/sw.js").catch(err => {
                // Not fatal: without it the app still works, it just cannot be
                // installed to the home screen.
                console.warn("Service worker registration failed:", err);
            });
        };

        if (document.readyState === "complete") register();
        else {
            window.addEventListener("load", register);
            return () => window.removeEventListener("load", register);
        }
    }, []);

    return null;
}
