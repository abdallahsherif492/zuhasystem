/**
 * Meta (Facebook) Pixel — modular integration.
 *
 * The pixel is fully driven by the `platform_settings` row managed from
 * System Admin > Settings. Nothing here runs unless a System Admin has both
 * switched the integration on and saved a Pixel ID, so the whole integration
 * can be attached or detached at any time without touching the code.
 *
 * Every `track*` helper is a safe no-op while the pixel is off, so call sites
 * never need to guard.
 */

declare global {
    interface Window {
        fbq?: FbqFunction;
        _fbq?: FbqFunction;
    }
}

type FbqFunction = ((...args: any[]) => void) & {
    callMethod?: (...args: any[]) => void;
    queue?: any[];
    push?: any;
    loaded?: boolean;
    version?: string;
};

const SCRIPT_ID = "meta-pixel-sdk";
const SDK_SRC = "https://connect.facebook.net/en_US/fbevents.js";

/** Standard Meta events used across the marketing funnel. */
export const PIXEL_EVENTS = {
    PAGE_VIEW: "PageView",
    VIEW_CONTENT: "ViewContent",
    LEAD: "Lead",
    COMPLETE_REGISTRATION: "CompleteRegistration",
} as const;

let initializedPixelId: string | null = null;

/** Whether a pixel is currently initialized in this browser session. */
export const isPixelActive = () => initializedPixelId !== null;

/**
 * Injects the Meta Pixel SDK and initializes it with `pixelId`.
 * Safe to call repeatedly: the SDK is injected once, and re-initializing with
 * the same id is ignored.
 */
export function initMetaPixel(pixelId: string) {
    if (typeof window === "undefined" || !pixelId) return;
    if (initializedPixelId === pixelId) return;

    if (!window.fbq) {
        const fbq: FbqFunction = function (...args: any[]) {
            if (fbq.callMethod) {
                fbq.callMethod.apply(fbq, args);
            } else {
                fbq.queue!.push(args);
            }
        };
        fbq.push = fbq;
        fbq.loaded = true;
        fbq.version = "2.0";
        fbq.queue = [];

        window.fbq = fbq;
        if (!window._fbq) window._fbq = fbq;
    }

    if (!document.getElementById(SCRIPT_ID)) {
        const script = document.createElement("script");
        script.id = SCRIPT_ID;
        script.async = true;
        script.src = SDK_SRC;
        document.head.appendChild(script);
    }

    window.fbq!("init", pixelId);
    initializedPixelId = pixelId;
}

/**
 * Tears the pixel down — used when a System Admin switches the integration off
 * or swaps the Pixel ID while the app is open. Meta's SDK has no official
 * "destroy", so we drop the script and the global queue and let the next
 * `initMetaPixel` rebuild it from scratch.
 */
export function disableMetaPixel() {
    if (typeof window === "undefined") return;

    document.getElementById(SCRIPT_ID)?.remove();
    delete window.fbq;
    delete window._fbq;
    initializedPixelId = null;
}

/** Fires a standard Meta event. No-op while the pixel is off. */
export function trackPixelEvent(event: string, params?: Record<string, any>) {
    if (typeof window === "undefined" || !window.fbq || !initializedPixelId) return;
    window.fbq("track", event, params);
}

/** Fires a custom (non-standard) Meta event. No-op while the pixel is off. */
export function trackPixelCustomEvent(event: string, params?: Record<string, any>) {
    if (typeof window === "undefined" || !window.fbq || !initializedPixelId) return;
    window.fbq("trackCustom", event, params);
}

export const trackPageView = () => trackPixelEvent(PIXEL_EVENTS.PAGE_VIEW);

/** A visitor clicked a call-to-action that starts the sign-up funnel. */
export const trackLead = (source: string, params?: Record<string, any>) =>
    trackPixelEvent(PIXEL_EVENTS.LEAD, { content_name: source, ...params });

/** A visitor reached a meaningful part of the marketing page (e.g. pricing). */
export const trackViewContent = (contentName: string, params?: Record<string, any>) =>
    trackPixelEvent(PIXEL_EVENTS.VIEW_CONTENT, { content_name: contentName, ...params });

/** A visitor finished creating an account. */
export const trackCompleteRegistration = (params?: Record<string, any>) =>
    trackPixelEvent(PIXEL_EVENTS.COMPLETE_REGISTRATION, {
        content_name: "Signup",
        status: "completed",
        ...params,
    });

/** The events the System Admin test button can fire. */
export const TESTABLE_EVENTS = [
    PIXEL_EVENTS.PAGE_VIEW,
    PIXEL_EVENTS.VIEW_CONTENT,
    PIXEL_EVENTS.LEAD,
    PIXEL_EVENTS.COMPLETE_REGISTRATION,
] as const;

export type TestableEvent = (typeof TESTABLE_EVENTS)[number];

/**
 * Fires sample events so a System Admin can confirm the pixel is wired up
 * before any real traffic arrives.
 *
 * These are genuine pixel events — Meta has no "dry run" mode for the browser
 * pixel — so each one is tagged with `test_event: true` and a distinct
 * `content_name` to keep them separable from real funnel data in Events
 * Manager. Uses the ID passed in rather than the saved one, so an admin can
 * validate a new Pixel ID before committing to it.
 */
export function sendTestPixelEvents(pixelId: string, events: readonly string[]) {
    const trimmedId = pixelId.trim();
    if (!trimmedId) {
        return { success: false as const, error: "Pixel ID is required.", sent: [] as string[] };
    }
    if (events.length === 0) {
        return { success: false as const, error: "Select at least one event.", sent: [] as string[] };
    }

    try {
        initMetaPixel(trimmedId);

        const sentAt = new Date().toISOString();
        events.forEach((event) => {
            trackPixelEvent(event, {
                content_name: `Test — ${event}`,
                content_category: "System Admin Test",
                test_event: true,
                sent_at: sentAt,
            });
        });

        return { success: true as const, error: null, sent: [...events] };
    } catch (e: any) {
        return { success: false as const, error: e?.message || "Failed to send test events.", sent: [] as string[] };
    }
}
