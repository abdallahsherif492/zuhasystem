"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cancellationReviewOf } from "@/lib/orders/cancel-reasons";

/**
 * Settings → Cancellations: whether the suspected cancellations of the last
 * three days go back to Waiting by themselves every morning. Saved the moment
 * it is switched.
 */
export function CancellationReviewSettingsCard() {
    const { activeBusiness } = useBusiness();
    const [auto, setAuto] = useState(() => cancellationReviewOf(activeBusiness?.theme_config).auto);
    const [saving, setSaving] = useState(false);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setAuto(cancellationReviewOf(activeBusiness?.theme_config).auto); }, [activeBusiness?.id]);

    const save = async (next: boolean) => {
        if (!activeBusiness) return;
        setSaving(true);
        setAuto(next);
        try {
            // Merged into what is saved now, so nothing saved elsewhere is undone.
            const { data: fresh, error: readError } = await supabase.from("businesses").select("theme_config").eq("id", activeBusiness.id).single();
            if (readError) throw readError;
            const theme_config = { ...(fresh?.theme_config || {}), cancellation_review: { ...(fresh?.theme_config?.cancellation_review || {}), auto: next } };
            const { data, error } = await supabase.from("businesses").update({ theme_config }).eq("id", activeBusiness.id).select("id");
            if (error) throw error;
            if (!data?.length) throw new Error("RLS_BLOCKED");
            activeBusiness.theme_config = theme_config;
            toast.success(next ? "اتشغّل: الأوردرات المشكوك فيها هترجع Waiting كل يوم الساعة 9 الصبح." : "اتوقف الإرجاع التلقائي.");
        } catch (e) {
            console.error(e);
            setAuto(!next);
            toast.error((e as Error).message === "RLS_BLOCKED" ? "مش مسموحلك تعدّل الإعدادات (لازم تكون الأونر)." : "ماتحفظتش، جرّب تاني.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card dir="rtl">
            <CardHeader>
                <CardTitle>الإلغاءات المشكوك فيها</CardTitle>
                <CardDescription>
                    أوردرات اتلغت بسرعة، أو من غير محاولات اتصال كفاية، أو من غير سبب. السيستم بيشك إنها اتلغت إهمال، وبيرجّعها للسيلز يحاولوا عليها تاني.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex items-start justify-between gap-6 rounded-lg border p-4">
                    <div>
                        <Label htmlFor="cancel-review-auto" className="text-base">رجّعهم Waiting أوتوماتيك كل يوم</Label>
                        <p className="mt-1 text-sm text-muted-foreground">
                            كل يوم الساعة 9 الصبح، الأوردرات المشكوك فيها اللي اتلغت في آخر 3 أيام بترجع Waiting، وعليها علامة «محاولة تانية بعد الإلغاء».
                            كل أوردر بيرجع مرة واحدة بس، ولو اتلغى تاني بيفضل ملغي.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                        {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        <Switch id="cancel-review-auto" checked={auto} disabled={saving} onCheckedChange={save} />
                    </div>
                </div>

                <div className="space-y-2 text-sm">
                    <p className="font-medium">إمتى السيستم بيشك في الإلغاء</p>
                    <p className="text-muted-foreground">
                        بيدّي كل إلغاء نقط، واللي يوصل 50 نقطة أو أكتر بيبقى مشكوك فيه:
                    </p>
                    <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
                        <li>اتلغى من غير ولا محاولة اتصال متسجلة: 45. محاولة واحدة بس: 25. كل المحاولات في ساعة واحدة: 15.</li>
                        <li>اتلغى في أقل من ساعة من وصوله: 30. في أول 6 ساعات: 20. في نفس يومه: 10.</li>
                        <li>اتلغى من غير سبب، أو عشان مابيردش: 10. الإلغاء عشان مابيردش بيتحسب محاولة.</li>
                        <li>تقييم استلامه عالي في EasyOrders: 10 (ضعيف: −15). استلم مننا قبل كده: 15.</li>
                    </ul>
                    <p className="text-muted-foreground">
                        ومش بيشك أبدًا في أوردر اتلغى عشان العميل رفض، أو مكرر، أو الرقم غلط، أو وهمي، أو السعر، أو المنتج مش موجود؛ ولا في عميل عامل أوردر تاني خلال 3 أيام؛ ولا في ملاحظة بتقول إنه مش عايز؛ ولا في أوردر كان اتأكد أو اتشحن قبل ما يتلغى.
                    </p>
                    <p>
                        <Link href="/insights/cancellations" className="text-primary underline-offset-4 hover:underline">شوف المشكوك فيهم ونتيجة الإرجاع في صفحة تحليل الإلغاءات</Link>
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
