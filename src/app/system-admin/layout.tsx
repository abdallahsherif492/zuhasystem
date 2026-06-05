"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Store, Ticket, ShieldCheck, LogOut, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";

function AdminSidebar({ pathname }: { pathname: string }) {
    return (
        <div className="space-y-4 py-4">
            <div className="px-3 py-2">
                <div className="flex items-center justify-center mb-8 px-2">
                    <div className="relative h-16 w-32">
                        <Image src="/logo.png" alt="Zuha Logo" fill className="object-contain" />
                    </div>
                </div>
                <div className="space-y-1">
                    <Link href="/system-admin">
                        <Button
                            variant={pathname === "/system-admin" ? "secondary" : "ghost"}
                            className="w-full justify-start"
                        >
                            <LayoutDashboard className="mr-2 h-4 w-4" />
                            Overview
                        </Button>
                    </Link>
                    <Link href="/system-admin/businesses">
                        <Button
                            variant={pathname.startsWith("/system-admin/businesses") ? "secondary" : "ghost"}
                            className="w-full justify-start"
                        >
                            <Store className="mr-2 h-4 w-4" />
                            Businesses
                        </Button>
                    </Link>
                    <Link href="/system-admin/tickets">
                        <Button
                            variant={pathname.startsWith("/system-admin/tickets") ? "secondary" : "ghost"}
                            className="w-full justify-start"
                        >
                            <Ticket className="mr-2 h-4 w-4" />
                            Support Tickets
                        </Button>
                    </Link>
                </div>
            </div>
            <div className="mt-auto px-3 py-2 absolute bottom-4 w-64">
                <Button 
                    variant="ghost" 
                    className="w-full justify-start text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={async () => {
                        await supabase.auth.signOut();
                        window.location.href = "/login";
                    }}
                >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                </Button>
            </div>
        </div>
    );
}

export default function SystemAdminLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    return (
        <div className="flex min-h-screen bg-muted/40">
            {/* Desktop Sidebar */}
            <aside className="hidden lg:block w-64 border-r bg-background fixed h-screen z-10">
                <div className="flex items-center gap-2 p-4 border-b bg-primary/5 text-primary">
                    <ShieldCheck className="h-5 w-5" />
                    <span className="font-semibold">System Admin Portal</span>
                </div>
                <AdminSidebar pathname={pathname} />
            </aside>

            <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
                {/* Mobile Header */}
                <header className="lg:hidden flex items-center h-16 px-4 border-b bg-background sticky top-0 z-20">
                    <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
                        <SheetTrigger asChild>
                            <Button variant="outline" size="icon" className="mr-4">
                                <Menu className="h-5 w-5" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="w-64 p-0">
                            <div className="flex items-center gap-2 p-4 border-b bg-primary/5 text-primary">
                                <ShieldCheck className="h-5 w-5" />
                                <span className="font-semibold">System Admin</span>
                            </div>
                            <AdminSidebar pathname={pathname} />
                        </SheetContent>
                    </Sheet>
                    <div className="font-semibold text-lg">Zuha Admin</div>
                </header>

                <main className="flex-1 p-6 lg:p-8 max-w-7xl mx-auto w-full">
                    {children}
                </main>
            </div>
        </div>
    );
}
