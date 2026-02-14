"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Package, ShoppingCart, Settings, Users, Truck, Banknote, LineChart, ShoppingBag, Megaphone, Box } from "lucide-react";

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
            <Link href="/inventory">
                <Button
                    variant={pathname.startsWith("/inventory") ? "secondary" : "ghost"}
                    className="w-full justify-start"
                >
                    <Box className="mr-2 h-4 w-4" />
                    Inventory
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
            <Link href="/shipping">
                <Button
                    variant={pathname.startsWith("/shipping") ? "secondary" : "ghost"}
                    className="w-full justify-start"
                >
                    <Truck className="mr-2 h-4 w-4" />
                    Shipping
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
            <div className="pt-4 pb-2">
                <h4 className="mb-1 rounded-md px-2 py-1 text-sm font-semibold">
                    Detailed Analytics
                </h4>
                <div className="grid grid-flow-row auto-rows-max text-sm gap-1">
                    <Link href="/insights/expenses">
                        <Button
                            variant={pathname.startsWith("/insights/expenses") ? "secondary" : "ghost"}
                            className="w-full justify-start h-8"
                            size="sm"
                        >
                            <Banknote className="mr-2 h-3 w-3" />
                            Expenses
                        </Button>
                    </Link>
                    <Link href="/insights/channel-analytics">
                        <Button
                            variant={pathname.startsWith("/insights/channel-analytics") ? "secondary" : "ghost"}
                            className="w-full justify-start h-8"
                            size="sm"
                        >
                            <Megaphone className="mr-2 h-3 w-3" />
                            Channels
                        </Button>
                    </Link>
                    <Link href="/insights/products-analysis">
                        <Button
                            variant={pathname.startsWith("/insights/products-analysis") ? "secondary" : "ghost"}
                            className="w-full justify-start h-8"
                            size="sm"
                        >
                            <Package className="mr-2 h-3 w-3" />
                            Products
                        </Button>
                    </Link>
                </div>
            </div>
        </div>
    );
}
