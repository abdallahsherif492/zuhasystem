"use client";

import { useBusiness } from "@/contexts/BusinessContext";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ExpirationBanner() {
    const { activeBusiness, isSystemAdmin } = useBusiness();
    const [daysRemaining, setDaysRemaining] = useState<number | null>(null);

    useEffect(() => {
        if (!activeBusiness?.subscription_end_date) {
            setDaysRemaining(null);
            return;
        }

        const endDate = new Date(activeBusiness.subscription_end_date);
        const now = new Date();
        const diffTime = endDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        setDaysRemaining(diffDays);
    }, [activeBusiness]);

    // Don't show to system admins if they are impersonating (or maybe we should? let's show it so they know it's expiring)
    // Only show if between 0 and 10 days remaining. If < 0, they are suspended (handled by SubscriptionGuard).
    if (daysRemaining === null || daysRemaining > 10 || daysRemaining < 0) {
        return null;
    }

    return (
        <div className="bg-yellow-500/15 border-b border-yellow-500/30 text-yellow-600 dark:text-yellow-500 px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-4 w-full text-sm z-50 relative">
            <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-5 w-5" />
                <span>
                    تنبيه: باقة الاشتراك الخاصة بك ستنتهي خلال {daysRemaining} يوم. سيتم إيقاف النظام بالكامل بعد انتهاء فترة السماح إذا لم يتم التجديد.
                </span>
            </div>
            <Button asChild size="sm" variant="outline" className="border-yellow-500/50 hover:bg-yellow-500/20 text-yellow-700 dark:text-yellow-500 shrink-0">
                <Link href="/settings?tab=subscription">
                    إدارة الاشتراك وتجديد الباقة
                </Link>
            </Button>
        </div>
    );
}
