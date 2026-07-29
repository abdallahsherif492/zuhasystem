import type { Metadata } from "next";
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
  ...(facebookDomainVerification
    ? {
        verification: {
          other: { "facebook-domain-verification": facebookDomainVerification },
        },
      }
    : {}),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="ltr" suppressHydrationWarning>
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
