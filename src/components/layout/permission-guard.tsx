"use client";

import { usePathname, useRouter } from "next/navigation";
import { useBusiness } from "@/contexts/BusinessContext";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export function PermissionGuard({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { userRole, allowedPages, isSystemAdmin, loading } = useBusiness();
    const [authorized, setAuthorized] = useState(false);

    useEffect(() => {
        if (loading) return;

        const role = userRole?.toLowerCase().trim() || "";
        
        if (isSystemAdmin || role === "owner" || role === "admin" || role === "platform admin" || role === "super admin") {
            setAuthorized(true);
            return;
        }

        // Always allow dashboard
        if (pathname === "/dashboard") {
            setAuthorized(true);
            return;
        }

        // Check explicit permissions
        if (allowedPages && allowedPages.length > 0) {
            const hasAccess = allowedPages.some(allowed => pathname.startsWith(allowed));
            if (hasAccess) {
                setAuthorized(true);
                return;
            }
        }

        // Unauthorized
        setAuthorized(false);
        router.push("/unauthorized");
    }, [pathname, loading, userRole, allowedPages, isSystemAdmin, router]);

    if (loading || !authorized) {
        return (
            <div className="flex h-[50vh] w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return <>{children}</>;
}
