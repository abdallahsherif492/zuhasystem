"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShippingManagement } from "@/components/shipping/ShippingManagement";
import { ShippingAnalytics } from "@/components/shipping/ShippingAnalytics";
import { Loader2 } from "lucide-react";

function ShippingPageContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const tab = searchParams.get("tab") || "management";

    const handleTabChange = (value: string) => {
        const params = new URLSearchParams(searchParams);
        params.set("tab", value);
        router.replace(`${pathname}?${params.toString()}`);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Shipping</h1>
                    <p className="text-muted-foreground">Manage companies and view performance reports.</p>
                </div>
            </div>

            <Tabs value={tab} onValueChange={handleTabChange} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="management">Management</TabsTrigger>
                    <TabsTrigger value="analytics">Analytics & Reports</TabsTrigger>
                </TabsList>
                <TabsContent value="management" className="space-y-4">
                    <ShippingManagement />
                </TabsContent>
                <TabsContent value="analytics" className="space-y-4">
                    <ShippingAnalytics />
                </TabsContent>
            </Tabs>
        </div>
    );
}

export default function ShippingPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>}>
            <ShippingPageContent />
        </Suspense>
    );
}
