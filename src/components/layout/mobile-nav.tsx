"use client";

import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { SidebarContent } from "@/components/layout/sidebar";
import Image from "next/image";
import { useState } from "react";

export function MobileNav() {
    const [open, setOpen] = useState(false);

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">Toggle menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0">
                <div className="flex flex-col h-full py-6 px-4">
                    <div className="flex items-center justify-center mb-8">
                        <div className="relative h-16 w-32">
                            <Image
                                src="/logo.png"
                                alt="eCommerx Logo"
                                fill
                                className="object-contain"
                                priority
                            />
                        </div>
                    </div>
                    {/* Reuse the Sidebar logic, pass onLinkClick to close sheet only on real navigation */}
                    <SidebarContent onLinkClick={() => setOpen(false)} />
                </div>
            </SheetContent>
        </Sheet>
    );
}
