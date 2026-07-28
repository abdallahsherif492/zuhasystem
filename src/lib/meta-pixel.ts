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

/**
 * Whether Meta's SDK actually downloaded.
 *
 * This matters: when fbevents.js is blocked (ad blocker, tracker-blocking
 * browser, corporate DNS), `fbq` still exists — it is our own stub — and every
 * call silently piles up in `fbq.queue` instead of reaching Meta. Without
 * tracking this, a "sent" report would be a lie.
 */
type SdkState = "idle" | "loading" | "loaded" | "blocked";
let sdkState: SdkState = "idle";
let sdkReady: Promise<boolean> | null = null;

/** Whether a pixel is currently initialized in this browser session. */
export const isPixelActive = () => initializedPixelId !== null;

/** Resolves true once Meta's SDK loads, false if it was blocked or timed out. */
export function whenPixelReady(timeoutMs = 5000): Promise<boolean> {
    if (sdkState === "loaded") return Promise.resolve(true);
    if (sdkState === "blocked" || !sdkReady) return Promise.resolve(false);

    return Promise.race([
        sdkReady,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(sdkState === "loaded"), timeoutMs)),
    ]);
}

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
        sdkState = "loading";
        sdkReady = new Promise<boolean>((resolve) => {
            const script = document.createElement("script");
            script.id = SCRIPT_ID;
            script.async = true;
            script.src = SDK_SRC;
            script.onload = () => {
                sdkState = "loaded";
                resolve(true);
            };
            script.onerror = () => {
                sdkState = "blocked";
                resolve(false);
            };
            document.head.appendChild(script);
        });
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
    sdkState = "idle";
    sdkReady = null;
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

/**
 * Fires an event, then gives the browser a moment to flush the beacon before
 * the caller navigates.
 *
 * `window.location.href` unloads the document, which can cancel the in-flight
 * request — silently dropping the conversion. Costs nothing when the pixel is
 * off: there is no beacon to wait for, so the user is never delayed.
 */
export async function flushPixelEvent(fire: () => void, graceMs = 400) {
    fire();
    if (!isPixelActive()) return;
    await new Promise((resolve) => setTimeout(resolve, graceMs));
}

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
export async function sendTestPixelEvents(pixelId: string, events: readonly string[]) {
    const fail = (error: string) => ({ success: false as const, error, sent: [] as string[] });

    const trimmedId = pixelId.trim();
    if (!trimmedId) return fail("Pixel ID is required.");
    if (events.length === 0) return fail("Select at least one event.");
    if (!/^\d{15,16}$/.test(trimmedId)) {
        return fail(`"${trimmedId}" does not look like a Meta Pixel ID — it should be 15–16 digits. Copy it from Events Manager > Data Sources.`);
    }

    try {
        initMetaPixel(trimmedId);

        // Wait for Meta's SDK before claiming anything was sent: until it
        // loads, fbq only buffers into a local queue.
        const ready = await whenPixelReady();
        if (!ready) {
            return fail(
                "Meta's script (fbevents.js) could not load — it is almost always an ad blocker or a tracker-blocking browser. " +
                "Events were queued locally and never reached Meta. Disable the blocker for this site, or try a different browser, then send again."
            );
        }

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
        return fail(e?.message || "Failed to send test events.");
    }
}
