"use client";

import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePathname } from "next/navigation";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { 
    LayoutDashboard, AlertTriangle, Package, ShoppingCart, Settings, Users, Truck, 
    Banknote, LineChart, ShoppingBag, Megaphone, Box, DollarSign, ShieldCheck, 
    FileText, Ticket, CreditCard, Clock, Inbox, Calendar, LogOut, Globe,
    ChevronDown, ChevronRight, BarChart3, PieChart
} from "lucide-react";
import Image from "next/image";
import { useState, useEffect } from "react";

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> { }

export function Sidebar({ className }: SidebarProps) {
    const { t } = useLanguage();
    const { currentUser, userRole, activeBusiness } = useBusiness();
    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
    };

    return (
        <div className={cn("pb-12 h-screen border-r flex flex-col bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60", className)}>
            <div className="space-y-4 py-4 flex-1 overflow-auto custom-scrollbar">
                <div className="px-3 py-2">
                    <div className="flex items-center justify-center mb-8 px-2 flex-col gap-2">
                        <div className="relative h-16 w-32 transition-transform hover:scale-105 duration-300">
                            <Image
                                src={activeBusiness?.logo_url || "/logo.png"}
                                alt={activeBusiness?.name || "Zuha Logo"}
                                fill
                                className="object-contain"
                                priority
                            />
                        </div>
                        {activeBusiness?.name && (
                            <h2 className="text-lg font-bold text-center leading-tight tracking-tight text-foreground/90">
                                {activeBusiness.name}
                            </h2>
                        )}
                    </div>
                    <SidebarContent />
                </div>
            </div>

            <div className="p-4 mt-auto border-t flex flex-col gap-2 bg-muted/20">
                {currentUser && (
                    <div className="px-3 py-2 text-xs text-muted-foreground break-all">
                        {t("Logged in as")}:<br />
                        <span className="font-medium text-foreground truncate block mt-0.5">{currentUser.email}</span>
                        {userRole && <div className="mt-1 capitalize text-primary font-medium">{userRole.replace('_', ' ')}</div>}
                    </div>
                )}
                <Button
                    variant="ghost"
                    className="w-full justify-start h-10 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50 transition-colors"
                    onClick={handleLogout}
                >
                    <LogOut className="mr-2 h-4 w-4" />
                    {t("Log Out")}
                </Button>
            </div>
        </div>
    );
}

type NavItem = {
    title: string;
    href: string;
    icon: React.ElementType;
    exactMatch?: boolean;
    adminOnly?: boolean;
    systemAdminOnly?: boolean;
    subItems?: Omit<NavItem, 'subItems'>[];
};

type NavGroup = {
    title: string;
    items: NavItem[];
};

export function SidebarContent({ onLinkClick }: { onLinkClick?: () => void }) {
    const pathname = usePathname();
    const { userRole, allowedPages, isSystemAdmin, loading } = useBusiness();
    const { t } = useLanguage();
    const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
    
    const role = userRole?.toLowerCase().trim() || "";
    const isAdminRole = role === "owner" || role === "admin" || role === "platform admin" || role.includes("super");

    const canAccess = (path: string) => {
        if (isSystemAdmin) return true;
        if (isAdminRole) return true;
        if (path === "/dashboard") return true;
        
        if (allowedPages && allowedPages.length > 0) {
            return allowedPages.some(allowed => pathname.startsWith(allowed) || path.startsWith(allowed));
        }
        return false;
    };

    // Define the menu structure
    const menuGroups: NavGroup[] = [
        {
            title: t("Overview"),
            items: [
                { title: t("Dashboard"), href: "/dashboard", icon: LayoutDashboard, exactMatch: true },
                { title: t("My HR"), href: "/my-hr", icon: Calendar },
            ]
        },
        {
            title: t("Sales & Orders"),
            items: [
                { title: t("Orders"), href: "/orders", icon: ShoppingCart, exactMatch: true },
                { title: t("Easy Orders"), href: "/easy-orders", icon: Globe },
                { title: t("Customers"), href: "/customers", icon: Users },
                { title: t("Support"), href: "/support", icon: Ticket },
            ]
        },
        {
            title: t("Catalog & Inventory"),
            items: [
                { title: t("Products"), href: "/products", icon: Package },
                { 
                    title: t("Inventory"), 
                    href: "/inventory", 
                    icon: Box,
                    exactMatch: true,
                    subItems: [
                        { title: t("Damages"), href: "/inventory/damages", icon: AlertTriangle }
                    ]
                },
            ]
        },
        {
            title: t("Supply Chain"),
            items: [
                { title: t("Purchases"), href: "/purchases", icon: ShoppingBag },
                { title: t("Accounts Payable"), href: "/payable", icon: FileText },
                { title: t("Logistics"), href: "/logistics", icon: Truck },
                { title: t("Shipping"), href: "/shipping", icon: Truck }, // Using truck again or Box
            ]
        },
        {
            title: t("Finance & Growth"),
            items: [
                { title: t("Accounting"), href: "/accounting", icon: Banknote },
                { title: t("Ads Spent"), href: "/ads", icon: Megaphone },
                { 
                    title: t("Insights"), 
                    href: "/insights", 
                    icon: LineChart,
                    exactMatch: true,
                    subItems: [
                        { title: t("EasyOrders"), href: "/insights/easyorders", icon: Globe },
                        { title: t("Revenues"), href: "/insights/revenues", icon: DollarSign },
                        { title: t("Actual Returns"), href: "/insights/actual-returns", icon: DollarSign },
                        { title: t("Expenses"), href: "/insights/expenses", icon: Banknote },
                        { title: t("Channels"), href: "/insights/channel-analytics", icon: PieChart },
                        { title: t("Products"), href: "/insights/products-analysis", icon: BarChart3 },
                    ]
                },
            ]
        },
        {
            title: t("Administration"),
            items: [
                { 
                    title: t("Team"), 
                    href: "/team", 
                    icon: Users,
                    exactMatch: true,
                    adminOnly: true,
                    subItems: [
                        { title: t("Attendance"), href: "/team/attendance", icon: Clock },
                        { title: t("Leave Requests"), href: "/team/requests", icon: Inbox },
                    ]
                },
                { title: t("Users & Permissions"), href: "/users", icon: ShieldCheck, systemAdminOnly: true },
                { title: t("Settings"), href: "/settings", icon: Settings, adminOnly: true },
            ]
        }
    ];

    // Filter accessible groups and items
    const accessibleGroups = menuGroups.map(group => {
        const filteredItems = group.items.filter(item => {
            if (item.systemAdminOnly && !isSystemAdmin) return false;
            if (item.adminOnly && !isAdminRole && !isSystemAdmin) {
                // Team is a special case, users might have access to /team/something via allowedPages
                if (item.href === "/team" && (canAccess("/team/attendance") || canAccess("/team/requests"))) {
                    return true; 
                }
                return false;
            }
            return canAccess(item.href);
        }).map(item => {
            if (item.subItems) {
                const filteredSubItems = item.subItems.filter(subItem => canAccess(subItem.href));
                return { ...item, subItems: filteredSubItems };
            }
            return item;
        });
        
        return { ...group, items: filteredItems };
    }).filter(group => group.items.length > 0);

    // Auto-expand groups based on active path
    useEffect(() => {
        const activeGroups: string[] = [];
        accessibleGroups.forEach(group => {
            const hasActiveItem = group.items.some(item => {
                const isItemActive = item.exactMatch ? pathname === item.href : pathname.startsWith(item.href);
                const hasActiveSubItem = item.subItems?.some(sub => sub.exactMatch ? pathname === sub.href : pathname.startsWith(sub.href));
                return isItemActive || hasActiveSubItem;
            });
            if (hasActiveItem) activeGroups.push(group.title);
        });
        // Prevent closing manually expanded groups, just add the active ones
        setExpandedGroups(prev => Array.from(new Set([...prev, ...activeGroups])));
    }, [pathname, loading]); // Added loading to deps to re-evaluate once loaded

    const toggleGroup = (title: string) => {
        setExpandedGroups(prev => 
            prev.includes(title) ? prev.filter(g => g !== title) : [...prev, title]
        );
    };

    if (loading) {
        return (
            <div className="space-y-4 p-4">
                {[1,2,3,4,5].map(i => (
                    <div key={i} className="space-y-2">
                        <div className="h-4 bg-muted/60 rounded w-1/3 animate-pulse mb-3"></div>
                        <div className="h-8 bg-muted rounded w-full animate-pulse"></div>
                        <div className="h-8 bg-muted rounded w-full animate-pulse"></div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-6 select-none">
            {accessibleGroups.map((group, groupIndex) => {
                const isExpanded = expandedGroups.includes(group.title);
                
                return (
                    <div key={groupIndex} className="space-y-1">
                        <button
                            onClick={() => toggleGroup(group.title)}
                            className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-foreground/80 hover:text-foreground hover:bg-muted/50 rounded-md transition-colors group"
                        >
                            <span className="uppercase tracking-widest">{group.title}</span>
                            {isExpanded ? (
                                <ChevronDown className="h-4 w-4 opacity-70 group-hover:opacity-100 transition-all" />
                            ) : (
                                <ChevronRight className="h-4 w-4 opacity-70 group-hover:opacity-100 transition-all" />
                            )}
                        </button>
                        
                        <div className={cn(
                            "grid transition-all duration-200 ease-in-out",
                            isExpanded ? "grid-rows-[1fr] opacity-100 mt-1" : "grid-rows-[0fr] opacity-0"
                        )}>
                            <div className="overflow-hidden space-y-1">
                                {group.items.map((item, itemIndex) => {
                                    const isActive = item.exactMatch ? pathname === item.href : pathname.startsWith(item.href) && !item.subItems?.some(s => pathname.startsWith(s.href));
                                    
                                    return (
                                        <div key={itemIndex} className="space-y-1">
                                            <Link href={item.href} onClick={onLinkClick}>
                                                <Button
                                                    variant={isActive ? "secondary" : "ghost"}
                                                    className={cn(
                                                        "w-full justify-start h-9 transition-all duration-200",
                                                        isActive ? "bg-primary/10 text-primary font-medium hover:bg-primary/15" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                                    )}
                                                >
                                                    <item.icon className={cn("mr-3 h-4 w-4", isActive ? "text-primary" : "opacity-70")} />
                                                    {item.title}
                                                </Button>
                                            </Link>
                                            
                                            {/* Sub Items */}
                                            {item.subItems && item.subItems.length > 0 && (
                                                <div className="ml-9 border-l-2 border-muted pl-2 space-y-1 my-1">
                                                    {item.subItems.map((subItem, subIndex) => {
                                                        const isSubActive = subItem.exactMatch ? pathname === subItem.href : pathname.startsWith(subItem.href);
                                                        return (
                                                            <Link key={subIndex} href={subItem.href} onClick={onLinkClick}>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className={cn(
                                                                        "w-full justify-start h-8 text-xs transition-colors",
                                                                        isSubActive 
                                                                            ? "bg-muted/50 text-foreground font-medium" 
                                                                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                                                                    )}
                                                                >
                                                                    <subItem.icon className={cn("mr-2 h-3.5 w-3.5", isSubActive ? "text-foreground" : "opacity-50")} />
                                                                    {subItem.title}
                                                                </Button>
                                                            </Link>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                );
            })}
            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: hsl(var(--muted));
                    border-radius: 4px;
                }
                .custom-scrollbar:hover::-webkit-scrollbar-thumb {
                    background: hsl(var(--muted-foreground) / 0.3);
                }
            `}</style>
        </div>
    );
}
