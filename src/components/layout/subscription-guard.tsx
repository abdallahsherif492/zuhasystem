"use client";

import { usePathname } from "next/navigation";
import { useBusiness } from "@/contexts/BusinessContext";
import { useEffect, useState } from "react";
import { Loader2, AlertOctagon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";

export function SubscriptionGuard({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { activeBusiness, isSystemAdmin, loading } = useBusiness();
    const [suspended, setSuspended] = useState(false);
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        if (loading) return;

        // System Admins bypass the guard (they might be impersonating)
        if (isSystemAdmin && !activeBusiness) {
            setSuspended(false);
            setChecking(false);
            return;
        }

        // Settings page is always accessible to allow renewals
        if (pathname.startsWith("/settings")) {
            setSuspended(false);
            setChecking(false);
            return;
        }

        if (activeBusiness && activeBusiness.subscription_end_date) {
            const endDate = new Date(activeBusiness.subscription_end_date);
            const now = new Date();
            const diffTime = endDate.getTime() - now.getTime();
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            // If subscription is expired AND 7 days grace period has passed (diffDays < -7)
            if (diffDays < -7) {
                setSuspended(true);
            } else {
                setSuspended(false);
            }
        } else if (activeBusiness && !activeBusiness.subscription_end_date) {
            // No subscription date means they might be a new business or legacy, allow for now unless forced
            setSuspended(false);
        }

        setChecking(false);
    }, [pathname, loading, activeBusiness, isSystemAdmin]);

    if (loading || checking) {
        return (
            <div className="flex h-[50vh] w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (suspended) {
        return (
            <div className="flex h-[80vh] w-full items-center justify-center p-4">
                <Card className="max-w-md w-full border-destructive/50 shadow-lg shadow-destructive/10">
                    <CardHeader className="text-center pb-2">
                        <div className="mx-auto w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
                            <AlertOctagon className="h-6 w-6 text-destructive" />
                        </div>
                        <CardTitle className="text-2xl text-destructive">Account Suspended</CardTitle>
                        <CardDescription className="text-base mt-2">
                            تم إيقاف النظام بسبب انتهاء فترة السماح للاشتراك الخاص بك. يرجى تجديد الباقة لاستعادة الوصول لجميع الميزات.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="text-center text-sm text-muted-foreground pt-4">
                        لا يزال بإمكانك الوصول إلى صفحة الإعدادات والمحفظة لتجديد اشتراكك بكل سهولة.
                    </CardContent>
                    <CardFooter className="flex justify-center pt-4 pb-6">
                        <Button asChild className="w-full sm:w-auto">
                            <Link href="/settings?tab=subscription">
                                الذهاب لصفحة التجديد
                            </Link>
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    return <>{children}</>;
}
