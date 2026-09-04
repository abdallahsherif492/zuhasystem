import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { DynamicThemeProvider } from "@/components/dynamic-theme-provider";
import { BusinessProvider } from "@/contexts/BusinessContext";
import { LanguageProvider } from "@/contexts/LanguageContext";

import { ActionFeedbackProvider } from "@/contexts/ActionFeedbackContext";
import { MetaPixelProvider } from "@/components/providers/meta-pixel-provider";
import { Toaster } from "@/components/ui/sonner-toaster";
import { SessionTrackerProvider } from "@/components/providers/session-tracker-provider";
import { ServiceWorkerProvider } from "@/components/providers/service-worker-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Meta's domain verification token. Served as a <meta> tag in <head>, which is
// how Business Manager confirms we own e-commerx.com. Verification is what
// unlocks Aggregated Event Measurement — without it, conversions from iOS
// visitors are under-reported no matter how correct the pixel is.
//
// The token is public by design (anyone can read it in the page source), but
// it lives in an env var so it can be rotated or pointed at a different
// Business Manager without a code change.
const facebookDomainVerification = process.env.NEXT_PUBLIC_FB_DOMAIN_VERIFICATION;

export const metadata: Metadata = {
  // Absolute URLs for OG/social tags now that the app has a real domain.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://www.e-commerx.com"
  ),
  title: "eCommerx Admin System",
  description: "Internal E-commerce Dashboard",
  // Installing to the home screen: the manifest supplies the name, colours
  // and icons, and appleWebApp does the same job on iOS, which reads none of
  // it. The apple-touch-icon is a separate opaque file because iOS fills a
  // transparent icon with black.
  manifest: "/manifest.webmanifest",
  applicationName: "eCommerx",
  appleWebApp: {
    capable: true,
    title: "eCommerx",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: {
    // Android was turning order references and totals into dial links.
    telephone: false,
  },
  other: {
    // The meta form of the same instruction, which is what the Translate
    // toolbar itself reads before offering the banner at all.
    google: "notranslate",
  },
  ...(facebookDomainVerification
    ? {
        verification: {
          other: { "facebook-domain-verification": facebookDomainVerification },
        },
      }
    : {}),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#6366f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
  // The installed app runs edge to edge; without this the content sits under
  // the notch and the home indicator on a phone.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // translate="no" is load-bearing, not a preference.
    //
    // Chrome offers to translate a page marked lang="ar" whenever the browser
    // itself is set to another language, and accepting rewrites the DOM under
    // React: every text node is moved inside a <font> element the translator
    // inserts. React still holds the original node and its original parent, so
    // the next time it removes that subtree — confirming an order removes its
    // whole card — removeChild is called with a node that is no longer a child
    // of the node it is called on, and the page dies with NotFoundError.
    //
    // The staff who use this are Arabic speakers reading an Arabic interface.
    // Translation is never wanted here, and turning it off is the fix rather
    // than a workaround.
    <html lang="ar" dir="ltr" translate="no" className="notranslate" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <BusinessProvider>
            <LanguageProvider>
              <ActionFeedbackProvider>
                <DynamicThemeProvider>
                  <MetaPixelProvider />
                  <SessionTrackerProvider />
                  <ServiceWorkerProvider />
                  {children}
                  <Toaster />
                </DynamicThemeProvider>
              </ActionFeedbackProvider>
            </LanguageProvider>
          </BusinessProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
