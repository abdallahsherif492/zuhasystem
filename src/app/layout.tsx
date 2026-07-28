import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { DynamicThemeProvider } from "@/components/dynamic-theme-provider";
import { BusinessProvider } from "@/contexts/BusinessContext";
import { LanguageProvider } from "@/contexts/LanguageContext";

import { ActionFeedbackProvider } from "@/contexts/ActionFeedbackContext";
import { MetaPixelProvider } from "@/components/providers/meta-pixel-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "eCommerx Admin System",
  description: "Internal E-commerce Dashboard",
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
                  {children}
                </DynamicThemeProvider>
              </ActionFeedbackProvider>
            </LanguageProvider>
          </BusinessProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
