import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { BusinessSwitcher } from "@/components/layout/business-switcher";
import { CommandPalette } from "@/components/layout/command-palette";
import { AnnouncementBanner } from "@/components/layout/announcement-banner";
import { ExpirationBanner } from "@/components/layout/expiration-banner";
import { PermissionGuard } from "@/components/layout/permission-guard";
import { SubscriptionGuard } from "@/components/layout/subscription-guard";
import { AutoSyncProvider } from "@/components/providers/AutoSyncProvider";
import { FloatingChatWidget } from "@/components/support/floating-chat-widget";
import { WalkthroughWrapper } from "@/components/walkthrough/walkthrough-wrapper";
import { StartHereLink } from "@/components/onboarding/getting-started";
import { StarterExtras } from "@/components/onboarding/starter-extras";
import { PageTutorialButton } from "@/components/onboarding/tutorials";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full">
      <Sidebar className="w-64 hidden md:block" />
      {/*
        min-w-0 is load-bearing. A flex item defaults to min-width:auto, so this
        column refuses to shrink below the intrinsic width of its widest child.
        A page with a wide table (logistics is ~1050px of columns) pushed this
        column past the viewport and scrolled the entire shell sideways, sidebar
        included — you had to scroll right to reach the rest of the page.
        With min-w-0 the column stays viewport-width and the table scrolls
        inside its own card, which is what its overflow-x-auto wrapper is for.
      */}
      <div className="flex flex-col flex-1 min-w-0">
        <AnnouncementBanner />
        <ExpirationBanner />
        <header className="flex min-h-14 flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 lg:min-h-[60px] lg:px-6">
          <MobileNav />
          <CommandPalette />
          <StartHereLink />
          <PageTutorialButton />
          <div className="min-w-0 flex flex-1 justify-end items-center gap-2">
            <BusinessSwitcher />
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 min-w-0">
          <AutoSyncProvider>
            <PermissionGuard>
              <SubscriptionGuard>
                <WalkthroughWrapper>
                  {children}
                </WalkthroughWrapper>
              </SubscriptionGuard>
            </PermissionGuard>
          </AutoSyncProvider>
        </main>
      </div>
      <FloatingChatWidget />
      <StarterExtras />
    </div>
  );
}
