"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Package, ShoppingCart, Settings, Users, Truck, Banknote, LineChart, ShoppingBag, Megaphone } from "lucide-react";

import Image from "next/image";

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> { }

export function Sidebar({ className }: SidebarProps) {
    return (
        <div className={cn("pb-12 h-screen border-r", className)}>
            <div className="space-y-4 py-4">
                <div className="px-3 py-2">
                    <div className="flex items-center justify-center mb-8 px-2">
                        <div className="relative h-20 w-40">
                            <Image
                                src="/logo.png"
                                alt="Zuha Logo"
                                fill
                                className="object-contain"
                                priority
                            />
                        </div>
                    </div>
                    <SidebarContent />
                </div>
            </div>
        </div>
    );
}

export function SidebarContent() {
    const pathname = usePathname();

    return (
        <div className="space-y-1">
            <Link href="/">
                <Button
                    variant={pathname === "/" ? "secondary" : "ghost"}
                    className="w-full justify-start"
                >
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    Dashboard
                </Button>
            </Link>
            <Link href="/products">
                <Button
                    variant={pathname.startsWith("/products") ? "secondary" : "ghost"}
                    className="w-full justify-start"
                >
                    <Package className="mr-2 h-4 w-4" />
                    Products
                </Button>
            </Link>
            <Link href="/orders">
                <Button
                    variant={pathname.startsWith("/orders") ? "secondary" : "ghost"}
                    className="w-full justify-start"
                >
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    Orders
                </Button>
            </Link>
            <Link href="/purchases">
                <Button
                    variant={pathname.startsWith("/purchases") ? "secondary" : "ghost"}
                    className="w-full justify-start"
                >
                    <ShoppingBag className="mr-2 h-4 w-4" />
                    Purchases
                </Button>
            </Link>
            <Link href="/customers">
                <Button
                    variant={pathname.startsWith("/customers") ? "secondary" : "ghost"}
                    className="w-full justify-start"
                >
                    <Users className="mr-2 h-4 w-4" />
                    Customers
                </Button>
            </Link>
            <Link href="/logistics">
                <Button
                    variant={pathname.startsWith("/logistics") ? "secondary" : "ghost"}
                    className="w-full justify-start"
                >
                    <Truck className="mr-2 h-4 w-4" />
                    Logistics
                </Button>
            </Link>
            <Link href="/accounting">
                <Button
                    variant={pathname.startsWith("/accounting") ? "secondary" : "ghost"}
                    className="w-full justify-start"
                >
                    <Banknote className="mr-2 h-4 w-4" />
                    Accounting
                </Button>
            </Link>
            <Link href="/insights">
                <Button
                    variant={pathname.startsWith("/insights") ? "secondary" : "ghost"}
                    className="w-full justify-start"
                >
                    <LineChart className="mr-2 h-4 w-4" />
                    Insights
                </Button>
            </Link>
            <Link href="/ads">
                <Button
                    variant={pathname.startsWith("/ads") ? "secondary" : "ghost"}
                    className="w-full justify-start"
                >
                    <Megaphone className="mr-2 h-4 w-4" />
                    Ads Spent
                </Button>
            </Link>
        </div>
    );
}
