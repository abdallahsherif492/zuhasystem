import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, sentryEnabled } from "@/lib/sentry-options";

if (sentryEnabled) {
    // Errors only on the server. Tracing here runs on every request the
    // platform bills by CPU time, for a sample nobody reads.
    Sentry.init({ ...baseSentryOptions, tracesSampleRate: 0 });
}
