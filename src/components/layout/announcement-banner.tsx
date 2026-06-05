"use client";

import { useBusiness } from "@/contexts/BusinessContext";
import { AlertTriangle, Info, CheckCircle2, XCircle, AlertOctagon } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";

export function AnnouncementBanner() {
    const { platformSettings, isSystemAdmin, loading } = useBusiness();
    const router = useRouter();
    const pathname = usePathname();

    if (loading || !platformSettings) return null;

    // Redirect if in maintenance mode and not system admin
    if (platformSettings.maintenance_mode && !isSystemAdmin && pathname !== "/maintenance") {
        router.push("/maintenance");
        return null;
    }

    if (!platformSettings.announcement_active) return null;

    let bgColor = "bg-blue-500 text-white";
    let Icon = Info;

    switch (platformSettings.announcement_type) {
        case "warning":
            bgColor = "bg-yellow-500 text-white";
            Icon = AlertTriangle;
            break;
        case "error":
            bgColor = "bg-red-500 text-white";
            Icon = AlertOctagon;
            break;
        case "success":
            bgColor = "bg-green-500 text-white";
            Icon = CheckCircle2;
            break;
    }

    return (
        <div className={`w-full p-2 px-4 flex items-center justify-center gap-2 text-sm font-medium ${bgColor}`}>
            <Icon className="h-4 w-4 shrink-0" />
            <span>{platformSettings.announcement_message}</span>
        </div>
    );
}
