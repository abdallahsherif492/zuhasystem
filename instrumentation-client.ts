import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, sentryEnabled } from "@/lib/sentry-options";

if (sentryEnabled) {
    // Keep the default integrations. Passing `integrations: []` replaces them
    // — including globalHandlers, which is what captures uncaught errors and
    // unhandled rejections — and silently turns the whole SDK into a no-op.
    //
    // Session replay is not among the defaults: it only runs if
    // replayIntegration() is added, which is deliberately not done here. This
    // dashboard shows tenant customers' names, phones and addresses, and
    // replay would record all of it.
    Sentry.init(baseSentryOptions);
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
