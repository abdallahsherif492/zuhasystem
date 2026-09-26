"use client";

import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdPerformance } from "@/components/ads/ad-performance";
import { DailySpend } from "@/components/ads/daily-spend";

/**
 * Ads: performance by product from uploaded ad reports, and the daily spend
 * totals the Insights page reads (which uploads here fill in by themselves).
 */
export default function AdsPage() {
    const { activeBusiness } = useBusiness();
    const { language } = useLanguage();
    const ar = language === "ar";

    return (
        <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
            <div>
                <h1 className="text-3xl font-bold tracking-tight">{ar ? "الإعلانات" : "Ads"}</h1>
                <p className="text-muted-foreground">
                    {ar ? "ارفع تقرير الإعلانات واعرف كل منتج بيكلّفك كام في الأوردر." : "Upload your ad reports and see what each product's orders cost."}
                </p>
            </div>
            <Tabs defaultValue="performance">
                <TabsList>
                    <TabsTrigger value="performance">{ar ? "أداء الإعلانات حسب المنتج" : "Performance by product"}</TabsTrigger>
                    <TabsTrigger value="daily">{ar ? "المصروف اليومي" : "Daily spend"}</TabsTrigger>
                </TabsList>
                <TabsContent value="performance" className="mt-4">
                    {activeBusiness && <AdPerformance key={activeBusiness.id} businessId={activeBusiness.id} ar={ar} />}
                </TabsContent>
                <TabsContent value="daily" className="mt-4" dir="ltr">
                    <DailySpend />
                </TabsContent>
            </Tabs>
        </div>
    );
}
