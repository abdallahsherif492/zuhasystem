"use client";

import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePathname } from "next/navigation";
import { useBusiness } from "@/contexts/BusinessContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Package, ShoppingCart, Settings, Users, Truck, Banknote, LineChart, ShoppingBag, Megaphone, Box, DollarSign, ShieldCheck, FileText, Ticket, CreditCard, Clock, Inbox, Calendar, LogOut } from "lucide-react";

import Image from "next/image";

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> { }

export function Sidebar({ className }: SidebarProps) {
    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
    };

    return (
        <div className={cn("pb-12 h-screen border-r flex flex-col", className)}>
            <div className="space-y-4 py-4 flex-1 overflow-auto">
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

            <div className="p-4 mt-auto border-t">
                <Button
                    variant="ghost"
                    className="w-full justify-start h-10 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
                    onClick={handleLogout}
                >
                    <LogOut className="mr-2 h-4 w-4" />
                    Log Out
                </Button>
            </div>
        </div>
    );
}

export function SidebarContent() {
    const pathname = usePathname();
    const { userRole, allowedPages, isSystemAdmin, loading } = useBusiness();

    const role = userRole?.toLowerCase().trim() || "";

    const canAccess = (path: string) => {
        if (isSystemAdmin) return true;
        if (role === "owner" || role === "admin" || role === "platform admin" || role === "super admin") return true;
        
        // Always allow everyone to see the dashboard home
        if (path === "/dashboard") return true;
        
        // If they have explicit allowed pages
        if (allowedPages && allowedPages.length > 0) {
            // Dashboard is usually allowed by default or specifically, let's strictly check if the path starts with any allowed page
            return allowedPages.some(allowed => pathname.startsWith(allowed) || path.startsWith(allowed));
        }
        
        // Default viewer access (if not explicitly restricted)
        return false;
    };

    if (loading) {
        return (
            <div className="space-y-2 p-4">
                <div className="h-8 bg-muted rounded w-full animate-pulse"></div>
                <div className="h-8 bg-muted rounded w-full animate-pulse"></div>
                <div className="h-8 bg-muted rounded w-full animate-pulse"></div>
                <div className="h-8 bg-muted rounded w-full animate-pulse"></div>
                <div className="h-8 bg-muted rounded w-full animate-pulse"></div>
            </div>
        );
    }

    return (
        <div className="space-y-1">
            {canAccess("/dashboard") && (
                <Link href="/dashboard">
                    <Button
                        variant={pathname === "/dashboard" ? "secondary" : "ghost"}
                        className="w-full justify-start"
                    >
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        Dashboard
                    </Button>
                </Link>
            )}
            {canAccess("/products") && (
                <Link href="/products">
                    <Button
                        variant={pathname.startsWith("/products") ? "secondary" : "ghost"}
                        className="w-full justify-start"
                    >
                        <Package className="mr-2 h-4 w-4" />
                        Products
                    </Button>
                </Link>
            )}
            {canAccess("/inventory") && (
                <Link href="/inventory">
                    <Button
                        variant={pathname.startsWith("/inventory") ? "secondary" : "ghost"}
                        className="w-full justify-start"
                    >
                        <Box className="mr-2 h-4 w-4" />
                        Inventory
                    </Button>
                </Link>
            )}
            {canAccess("/orders") && (
                <Link href="/orders">
                    <Button
                        variant={pathname.startsWith("/orders") ? "secondary" : "ghost"}
                        className="w-full justify-start"
                    >
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        Orders
                    </Button>
                </Link>
            )}
            {canAccess("/purchases") && (
                <Link href="/purchases">
                    <Button
                        variant={pathname.startsWith("/purchases") ? "secondary" : "ghost"}
                        className="w-full justify-start"
                    >
                        <ShoppingBag className="mr-2 h-4 w-4" />
                        Purchases
                    </Button>
                </Link>
            )}
            {canAccess("/customers") && (
                <Link href="/customers">
                    <Button
                        variant={pathname.startsWith("/customers") ? "secondary" : "ghost"}
                        className="w-full justify-start"
                    >
                        <Users className="mr-2 h-4 w-4" />
                        Customers
                    </Button>
                </Link>
            )}
            {canAccess("/logistics") && (
                <Link href="/logistics">
                    <Button
                        variant={pathname.startsWith("/logistics") ? "secondary" : "ghost"}
                        className="w-full justify-start"
                    >
                        <Truck className="mr-2 h-4 w-4" />
                        Logistics
                    </Button>
                </Link>
            )}
            {canAccess("/support") && (
                <Link href="/support">
                    <Button
                        variant={pathname.startsWith("/support") ? "secondary" : "ghost"}
                        className="w-full justify-start text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
                    >
                        <Ticket className="mr-2 h-4 w-4" />
                        Support
                    </Button>
                </Link>
            )}
            {canAccess("/accounting") && (
                <Link href="/accounting">
                    <Button
                        variant={pathname.startsWith("/accounting") ? "secondary" : "ghost"}
                        className="w-full justify-start"
                    >
                        <Banknote className="mr-2 h-4 w-4" />
                        Accounting
                    </Button>
                </Link>
            )}
            {canAccess("/insights") && (
                <Link href="/insights">
                    <Button
                        variant={pathname.startsWith("/insights") && !pathname.startsWith("/insights/") ? "secondary" : "ghost"}
                        className="w-full justify-start"
                    >
                        <LineChart className="mr-2 h-4 w-4" />
                        Insights
                    </Button>
                </Link>
            )}
            {canAccess("/shipping") && (
                <Link href="/shipping">
                    <Button
                        variant={pathname.startsWith("/shipping") ? "secondary" : "ghost"}
                        className="w-full justify-start"
                    >
                        <Truck className="mr-2 h-4 w-4" />
                        Shipping
                    </Button>
                </Link>
            )}
            {canAccess("/ads") && (
                <Link href="/ads">
                    <Button
                        variant={pathname.startsWith("/ads") ? "secondary" : "ghost"}
                        className="w-full justify-start"
                    >
                        <Megaphone className="mr-2 h-4 w-4" />
                        Ads Spent
                    </Button>
                </Link>
            )}
            {canAccess("/payable") && (
                <Link href="/payable">
                    <Button
                        variant={pathname.startsWith("/payable") ? "secondary" : "ghost"}
                        className="w-full justify-start"
                    >
                        <FileText className="mr-2 h-4 w-4" />
                        Accounts Payable
                    </Button>
                </Link>
            )}
            
            {canAccess("/insights") && (
                <div className="pt-4 pb-2">
                    <h4 className="mb-1 rounded-md px-2 py-1 text-sm font-semibold">
                        Detailed Analytics
                    </h4>
                    <div className="grid grid-flow-row auto-rows-max text-sm gap-1">
                        <Link href="/insights/revenues">
                            <Button
                                variant={pathname.startsWith("/insights/revenues") ? "secondary" : "ghost"}
                                className="w-full justify-start h-8"
                                size="sm"
                            >
                                <DollarSign className="mr-2 h-3 w-3" />
                                Revenues
                            </Button>
                        </Link>
                        <Link href="/insights/actual-returns">
                            <Button
                                variant={pathname.startsWith("/insights/actual-returns") ? "secondary" : "ghost"}
                                className="w-full justify-start h-8"
                                size="sm"
                            >
                                <DollarSign className="mr-2 h-3 w-3" />
                                Actual Returns
                            </Button>
                        </Link>
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
            )}

            {(role === "owner" || role === "admin" || role === "platform admin" || role === "super admin" || isSystemAdmin || canAccess("/team") || canAccess("/users")) && (
                <div className="pt-4 pb-2 border-t mt-4">
                    <h4 className="mb-1 rounded-md px-2 py-1 text-sm font-semibold">
                        Administration
                    </h4>
                    <div className="grid grid-flow-row auto-rows-max text-sm gap-1">
                        {(role === "owner" || role === "admin" || role === "platform admin" || role === "super admin" || isSystemAdmin || canAccess("/team")) && (
                            <>
                                <Link href="/team">
                                    <Button
                                        variant={pathname === "/team" ? "secondary" : "ghost"}
                                        className="w-full justify-start h-8"
                                        size="sm"
                                    >
                                        <Users className="mr-2 h-3 w-3" />
                                        Team
                                    </Button>
                                </Link>
                                <Link href="/team/attendance">
                                    <Button
                                        variant={pathname.startsWith("/team/attendance") ? "secondary" : "ghost"}
                                        className="w-full justify-start h-8"
                                        size="sm"
                                    >
                                        <Clock className="mr-2 h-3 w-3" />
                                        Attendance
                                    </Button>
                                </Link>
                                <Link href="/team/requests">
                                    <Button
                                        variant={pathname.startsWith("/team/requests") ? "secondary" : "ghost"}
                                        className="w-full justify-start h-8"
                                        size="sm"
                                    >
                                        <Inbox className="mr-2 h-3 w-3" />
                                        Leave Requests
                                    </Button>
                                </Link>
                            </>
                        )}
                        {isSystemAdmin && (
                            <Link href="/users">
                                <Button
                                    variant={pathname.startsWith("/users") ? "secondary" : "ghost"}
                                    className="w-full justify-start h-8"
                                    size="sm"
                                >
                                    <ShieldCheck className="mr-2 h-3 w-3" />
                                    Users & Permissions
                                </Button>
                            </Link>
                        )}
                        <Link href="/my-hr">
                            <Button
                                variant={pathname.startsWith("/my-hr") ? "secondary" : "ghost"}
                                className="w-full justify-start h-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
                                size="sm"
                            >
                                <Calendar className="mr-2 h-3 w-3" />
                                My HR
                            </Button>
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
