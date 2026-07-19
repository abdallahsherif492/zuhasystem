import { Sidebar } from "@/components/layout/sidebar";
import { ModeToggle } from "@/components/layout/theme-toggle";
import { MobileNav } from "@/components/layout/mobile-nav";
import { BusinessSwitcher } from "@/components/layout/business-switcher";
import { AnnouncementBanner } from "@/components/layout/announcement-banner";
import { PermissionGuard } from "@/components/layout/permission-guard";
import { AutoSyncProvider } from "@/components/providers/AutoSyncProvider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full">
      <Sidebar className="w-64 hidden md:block" />
      <div className="flex flex-col flex-1">
        <AnnouncementBanner />
        <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
          <MobileNav />
          <div className="w-full flex justify-end items-center gap-4">
            <BusinessSwitcher />
            <ModeToggle />
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
          <AutoSyncProvider>
            <PermissionGuard>
              {children}
            </PermissionGuard>
          </AutoSyncProvider>
        </main>
      </div>
    </div>
  );
}
