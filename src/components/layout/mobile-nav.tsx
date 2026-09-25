"use client";

import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { SidebarContent } from "@/components/layout/sidebar";
import Image from "next/image";
import { useState } from "react";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
export function MobileNav() {
    const [open, setOpen] = useState(false);
    const { activeBusiness } = useBusiness();
    const { direction, language } = useLanguage();

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">Toggle menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side={direction === "rtl" ? "right" : "left"} className="p-0">
                <SheetTitle className="sr-only">{language === "ar" ? "القائمة الرئيسية" : "Main navigation"}</SheetTitle>
                <SheetDescription className="sr-only">{language === "ar" ? "اختار الصفحة اللي محتاجها" : "Choose a page"}</SheetDescription>
                <div className="flex flex-col h-full overflow-y-auto overscroll-contain py-6 px-4">
                    <div className="flex items-center justify-center mb-8">
                        <div className="relative h-20 w-40">
                            <Image
                                src={activeBusiness?.logo_url || "/logo.png"}
                                alt={activeBusiness?.name || "eCommerx Logo"}
                                fill sizes="160px"
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
