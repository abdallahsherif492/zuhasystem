/**
 * Shared Sentry configuration.
 *
 * The DSN is optional on purpose: with none set, Sentry initialises inert and
 * the app behaves exactly as before. That keeps local development and any
 * fork free of a mandatory third-party account.
 */

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || "";
export const sentryEnabled = SENTRY_DSN.length > 0;

/** Errors that say nothing about our code and would drown the real signal. */
const IGNORED = [
    // Browser extensions and injected scripts
    /extension:\//i,
    /^chrome:\/\//i,
    // Benign navigation/abort noise
    "AbortError",
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    // Blocked trackers — expected, already handled in the pixel loader
    /fbevents\.js/i,
    // Offline / flaky mobile networks, which this app sees a lot of
    "Failed to fetch",
    "NetworkError when attempting to fetch resource",
    "Load failed",
];

export const baseSentryOptions = {
    dsn: SENTRY_DSN,
    enabled: sentryEnabled,

    // Every error, but only a sample of performance traces — traces are the
    // expensive part of the quota and errors are the point of this.
    tracesSampleRate: 0.1,

    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",

    ignoreErrors: IGNORED,

    // Never ship request bodies, headers or cookies: this app handles tenant
    // customer data and courier API credentials.
    sendDefaultPii: false,
};
