"use client";

import { usePathname, useRouter } from "next/navigation";
import { useBusiness } from "@/contexts/BusinessContext";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { canOpenPage } from "@/lib/navigation-access";

export function PermissionGuard({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { userRole, allowedPages, isSystemAdmin, loading } = useBusiness();
    const authorized = canOpenPage(pathname, userRole, allowedPages, isSystemAdmin);

    useEffect(() => {
        if (loading) return;

        if (!authorized) router.replace("/unauthorized");
    }, [loading, authorized, router]);

    if (loading || !authorized) {
        return (
            <div className="flex h-[50vh] w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return <>{children}</>;
}
