import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, sentryEnabled } from "@/lib/sentry-options";

if (sentryEnabled) {
    Sentry.init(baseSentryOptions);
}
