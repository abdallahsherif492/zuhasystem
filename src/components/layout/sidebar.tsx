"use client";

import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePathname } from "next/navigation";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, AlertTriangle, Package, ShoppingCart, Settings, Users, Truck, Banknote, LineChart, ShoppingBag, Megaphone, Box, DollarSign, ShieldCheck, FileText, Ticket, CreditCard, Clock, Inbox, Calendar, LogOut, Globe } from "lucide-react";

import Image from "next/image";

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> { }

export function Sidebar({ className }: SidebarProps) {
    const { t } = useLanguage();
    const { currentUser, userRole, activeBusiness } = useBusiness();
    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
    };

    return (
        <div className={cn("pb-12 h-screen border-r flex flex-col", className)}>
            <div className="space-y-4 py-4 flex-1 overflow-auto">
                <div className="px-3 py-2">
                    <div className="flex items-center justify-center mb-8 px-2 flex-col gap-2">
                        <div className="relative h-16 w-32">
                            <Image
                                src={activeBusiness?.logo_url || "/logo.png"}
                                alt={activeBusiness?.name || "Zuha Logo"}
                                fill
                                className="object-contain"
                                priority
                            />
                        </div>
                        {activeBusiness?.name && (
                            <h2 className="text-lg font-bold text-center leading-tight">
                                {activeBusiness.name}
                            </h2>
                        )}
                    </div>
                    <SidebarContent />
                </div>
            </div>

            <div className="p-4 mt-auto border-t flex flex-col gap-2">
                {currentUser && (
                    <div className="px-3 py-2 text-xs text-muted-foreground break-all">
                        {t("Logged in as")}:<br />
                        <span className="font-medium text-foreground">{currentUser.email}</span>
                        {userRole && <div className="mt-1 capitalize text-primary">{userRole.replace('_', ' ')}</div>}
                    </div>
                )}
                <Button
                    variant="ghost"
                    className="w-full justify-start h-10 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
                    onClick={handleLogout}
                >
                    <LogOut className="mr-2 h-4 w-4" />
                    {t("Log Out")}
                </Button>
            </div>
        </div>
    );
}

export function SidebarContent() {
    const pathname = usePathname();
    const { userRole, allowedPages, isSystemAdmin, loading } = useBusiness();
    const { t } = useLanguage();

    const role = userRole?.toLowerCase().trim() || "";

    const canAccess = (path: string) => {
        if (isSystemAdmin) return true;
        if (role === "owner" || role === "admin" || role === "platform admin" || role.includes("super")) return true;
        
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
            <Link href="/my-hr">
                <Button
                    variant={pathname.startsWith("/my-hr") ? "default" : "ghost"}
                    className="w-full justify-start"
                >
                    <Calendar className="mr-2 h-4 w-4" />
                    {t("My HR")}
                </Button>
            </Link>
            {canAccess("/dashboard") && (
                <Link href="/dashboard">
                    <Button
                        variant={pathname === "/dashboard" ? "default" : "ghost"}
                        className="w-full justify-start"
                    >
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        {t("Dashboard")}
                    </Button>
                </Link>
            )}
            {canAccess("/products") && (
                <Link href="/products">
                    <Button
                        variant={pathname.startsWith("/products") ? "default" : "ghost"}
                        className="w-full justify-start"
                    >
                        <Package className="mr-2 h-4 w-4" />
                        {t("Products")}
                    </Button>
                </Link>
            )}
            {canAccess("/inventory") && (
                <>
                    <Link href="/inventory">
                        <Button
                            variant={pathname === "/inventory" ? "default" : "ghost"}
                            className="w-full justify-start"
                        >
                            <Box className="mr-2 h-4 w-4" />
                            {t("Inventory")}
                        </Button>
                    </Link>
                    <Link href="/inventory/damages">
                        <Button
                            variant={pathname.startsWith("/inventory/damages") ? "default" : "ghost"}
                            className="w-full justify-start pl-8 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                        >
                            <AlertTriangle className="mr-2 h-3.5 w-3.5" />
                            {t("Damages (التلفيات)")}
                        </Button>
                    </Link>
                </>
            )}
            {canAccess("/orders") && (
                <>
                    <Link href="/orders">
                        <Button
                            variant={pathname.startsWith("/orders") && !pathname.startsWith("/easy-orders") ? "default" : "ghost"}
                            className="w-full justify-start"
                        >
                            <ShoppingCart className="mr-2 h-4 w-4" />
                            {t("Orders")}
                        </Button>
                    </Link>
                </>
            )}
            {canAccess("/easy-orders") && (
                <Link href="/easy-orders">
                    <Button
                        variant={pathname.startsWith("/easy-orders") ? "default" : "ghost"}
                        className="w-full justify-start pl-8 text-sm"
                    >
                        <Globe className="mr-2 h-3.5 w-3.5" />
                        {t("Easy Orders")}
                    </Button>
                </Link>
            )}
            {canAccess("/purchases") && (
                <Link href="/purchases">
                    <Button
                        variant={pathname.startsWith("/purchases") ? "default" : "ghost"}
                        className="w-full justify-start"
                    >
                        <ShoppingBag className="mr-2 h-4 w-4" />
                        {t("Purchases")}
                    </Button>
                </Link>
            )}
            {canAccess("/customers") && (
                <Link href="/customers">
                    <Button
                        variant={pathname.startsWith("/customers") ? "default" : "ghost"}
                        className="w-full justify-start"
                    >
                        <Users className="mr-2 h-4 w-4" />
                        {t("Customers")}
                    </Button>
                </Link>
            )}
            {canAccess("/logistics") && (
                <Link href="/logistics">
                    <Button
                        variant={pathname.startsWith("/logistics") ? "default" : "ghost"}
                        className="w-full justify-start"
                    >
                        <Truck className="mr-2 h-4 w-4" />
                        {t("Logistics")}
                    </Button>
                </Link>
            )}
            {canAccess("/support") && (
                <Link href="/support">
                    <Button
                        variant={pathname.startsWith("/support") ? "default" : "ghost"}
                        className="w-full justify-start text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
                    >
                        <Ticket className="mr-2 h-4 w-4" />
                        {t("Support")}
                    </Button>
                </Link>
            )}
            {canAccess("/accounting") && (
                <Link href="/accounting">
                    <Button
                        variant={pathname.startsWith("/accounting") ? "default" : "ghost"}
                        className="w-full justify-start"
                    >
                        <Banknote className="mr-2 h-4 w-4" />
                        {t("Accounting")}
                    </Button>
                </Link>
            )}
            {canAccess("/insights") && (
                <Link href="/insights">
                    <Button
                        variant={pathname.startsWith("/insights") && !pathname.startsWith("/insights/") ? "default" : "ghost"}
                        className="w-full justify-start"
                    >
                        <LineChart className="mr-2 h-4 w-4" />
                        {t("Insights")}
                    </Button>
                </Link>
            )}
            {canAccess("/shipping") && (
                <Link href="/shipping">
                    <Button
                        variant={pathname.startsWith("/shipping") ? "default" : "ghost"}
                        className="w-full justify-start"
                    >
                        <Truck className="mr-2 h-4 w-4" />
                        {t("Shipping")}
                    </Button>
                </Link>
            )}
            {canAccess("/ads") && (
                <Link href="/ads">
                    <Button
                        variant={pathname.startsWith("/ads") ? "default" : "ghost"}
                        className="w-full justify-start"
                    >
                        <Megaphone className="mr-2 h-4 w-4" />
                        {t("Ads Spent")}
                    </Button>
                </Link>
            )}
            {canAccess("/payable") && (
                <Link href="/payable">
                    <Button
                        variant={pathname.startsWith("/payable") ? "default" : "ghost"}
                        className="w-full justify-start"
                    >
                        <FileText className="mr-2 h-4 w-4" />
                        {t("Accounts Payable")}
                    </Button>
                </Link>
            )}
            
            {canAccess("/insights") && (
                <div className="pt-4 pb-2">
                    <h4 className="mb-1 rounded-md px-2 py-1 text-sm font-semibold">
                        {t("Detailed Analytics")}
                    </h4>
                    <div className="grid grid-flow-row auto-rows-max text-sm gap-1">
                        <Link href="/insights/revenues">
                            <Button
                                variant={pathname.startsWith("/insights/revenues") ? "default" : "ghost"}
                                className="w-full justify-start h-8"
                                size="sm"
                            >
                                <DollarSign className="mr-2 h-3 w-3" />
                                {t("Revenues")}
                            </Button>
                        </Link>
                        <Link href="/insights/actual-returns">
                            <Button
                                variant={pathname.startsWith("/insights/actual-returns") ? "default" : "ghost"}
                                className="w-full justify-start h-8"
                                size="sm"
                            >
                                <DollarSign className="mr-2 h-3 w-3" />
                                {t("Actual Returns")}
                            </Button>
                        </Link>
                        <Link href="/insights/expenses">
                            <Button
                                variant={pathname.startsWith("/insights/expenses") ? "default" : "ghost"}
                                className="w-full justify-start h-8"
                                size="sm"
                            >
                                <Banknote className="mr-2 h-3 w-3" />
                                {t("Expenses")}
                            </Button>
                        </Link>
                        <Link href="/insights/channel-analytics">
                            <Button
                                variant={pathname.startsWith("/insights/channel-analytics") ? "default" : "ghost"}
                                className="w-full justify-start h-8"
                                size="sm"
                            >
                                <Megaphone className="mr-2 h-3 w-3" />
                                {t("Channels")}
                            </Button>
                        </Link>
                        <Link href="/insights/products-analysis">
                            <Button
                                variant={pathname.startsWith("/insights/products-analysis") ? "default" : "ghost"}
                                className="w-full justify-start h-8"
                                size="sm"
                            >
                                <Package className="mr-2 h-3 w-3" />
                                {t("Products")}
                            </Button>
                        </Link>
                    </div>
                </div>
            )}

            {(role === "owner" || role === "admin" || role === "platform admin" || role === "super admin" || role === "super_admin" || isSystemAdmin || canAccess("/team") || canAccess("/users")) && (
                <div className="pt-4 pb-2 border-t mt-4">
                    <h4 className="mb-1 rounded-md px-2 py-1 text-sm font-semibold">
                        {t("Administration")}
                    </h4>
                    <div className="grid grid-flow-row auto-rows-max text-sm gap-1">
                        {(role === "owner" || role === "admin" || role === "platform admin" || role === "super admin" || role === "super_admin" || isSystemAdmin || canAccess("/team")) && (
                            <>
                                <Link href="/team">
                                    <Button
                                        variant={pathname === "/team" ? "default" : "ghost"}
                                        className="w-full justify-start h-8"
                                        size="sm"
                                    >
                                        <Users className="mr-2 h-3 w-3" />
                                        {t("Team")}
                                    </Button>
                                </Link>
                                <Link href="/team/attendance">
                                    <Button
                                        variant={pathname.startsWith("/team/attendance") ? "default" : "ghost"}
                                        className="w-full justify-start h-8"
                                        size="sm"
                                    >
                                        <Clock className="mr-2 h-3 w-3" />
                                        {t("Attendance")}
                                    </Button>
                                </Link>
                                <Link href="/team/requests">
                                    <Button
                                        variant={pathname.startsWith("/team/requests") ? "default" : "ghost"}
                                        className="w-full justify-start h-8"
                                        size="sm"
                                    >
                                        <Inbox className="mr-2 h-3 w-3" />
                                        {t("Leave Requests")}
                                    </Button>
                                </Link>
                            </>
                        )}
                        {isSystemAdmin && (
                            <Link href="/users">
                                <Button
                                    variant={pathname.startsWith("/users") ? "default" : "ghost"}
                                    className="w-full justify-start h-8"
                                    size="sm"
                                >
                                    <ShieldCheck className="mr-2 h-3 w-3" />
                                    {t("Users & Permissions")}
                                </Button>
                            </Link>
                        )}
                    </div>
                    
                    {(role === "owner" || role === "super_admin" || role === "super admin" || isSystemAdmin) && (
                        <div className="mt-2">
                            <Link href="/settings">
                                <Button
                                    variant={pathname.startsWith("/settings") ? "default" : "ghost"}
                                    className="w-full justify-start h-8 text-muted-foreground hover:text-foreground"
                                    size="sm"
                                >
                                    <Settings className="mr-2 h-3 w-3" />
                                    {t("Settings")}
                                </Button>
                            </Link>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
