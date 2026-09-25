import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  images: {
    // Logo files are named with a timestamp, so a new upload is a new URL.
    // Without this the optimiser went back to Supabase for the original about
    // once a minute per size — for a 1.1 MB logo, a real share of the egress.
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

// Source maps upload only when all three credentials are present, so builds
// without Sentry configured (local, forks, previews) behave exactly as before.
const uploadSourceMaps = Boolean(
  process.env.SENTRY_ORG && process.env.SENTRY_PROJECT && process.env.SENTRY_AUTH_TOKEN
);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  silent: !process.env.CI,
  sourcemaps: { disable: !uploadSourceMaps },

  // Routes Sentry through our own domain. This app's users demonstrably run
  // ad blockers — the Meta pixel proved it — and those block Sentry too.
  tunnelRoute: "/monitoring",

  telemetry: false,
});
