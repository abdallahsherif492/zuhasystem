"use client";

import { useBusiness } from "@/contexts/BusinessContext";
import { ShieldAlert, Loader2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function MaintenancePage() {
    const { platformSettings, isSystemAdmin, loading } = useBusiness();
    const router = useRouter();

    useEffect(() => {
        if (!loading && platformSettings && !platformSettings.maintenance_mode) {
            router.push("/dashboard");
        }
    }, [loading, platformSettings, router]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-muted/40">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-muted/40 p-4">
            <div className="max-w-md w-full text-center space-y-6 bg-background p-8 rounded-xl shadow-lg border-2 border-primary/20">
                <div className="flex justify-center mb-8">
                    <div className="relative h-16 w-40">
                        <Image
                            src="/logo.png"
                            alt="eCommerx Logo"
                            fill
                            className="object-contain"
                        />
                    </div>
                </div>
                
                <div className="flex justify-center text-red-500">
                    <ShieldAlert className="h-16 w-16" />
                </div>
                
                <h1 className="text-3xl font-bold tracking-tight">System Under Maintenance</h1>
                
                <p className="text-muted-foreground text-lg">
                    {platformSettings?.maintenance_message || "We are currently performing scheduled maintenance. Please check back soon."}
                </p>

                {isSystemAdmin && (
                    <div className="mt-8 p-4 bg-muted rounded-lg border text-sm text-left">
                        <p className="font-semibold mb-2">System Admin Notice:</p>
                        <p className="text-muted-foreground">You are currently seeing this because you visited the /maintenance URL directly. However, your account bypasses maintenance mode. You can go back to the dashboard.</p>
                        <button onClick={() => router.push("/system-admin/settings")} className="text-primary hover:underline mt-2 block">
                            Manage Settings
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
