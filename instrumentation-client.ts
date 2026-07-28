import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, sentryEnabled } from "@/lib/sentry-options";

if (sentryEnabled) {
    Sentry.init({
        ...baseSentryOptions,
        // Session replay is off: this dashboard shows tenant customer names,
        // phone numbers and addresses, which must not leave the app.
        integrations: [],
    });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
