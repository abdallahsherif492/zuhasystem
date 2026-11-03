"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
    SHIPPING_PLACEHOLDER, refusalNoteFor, waybillSettingsOf, type WaybillSettings,
} from "@/lib/orders/waybill-settings";

const EXAMPLE_SHIPPING = 70;

/** Settings → Waybill: the notes printed for the courier on every waybill. */
export function WaybillSettingsCard() {
    const { activeBusiness } = useBusiness();
    const [settings, setSettings] = useState<WaybillSettings>(() => waybillSettingsOf(activeBusiness?.theme_config));
    const [saving, setSaving] = useState(false);

    // Reloaded when the business changes, not when saving here updates its
    // theme_config, which would only put back what is already on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setSettings(waybillSettingsOf(activeBusiness?.theme_config)); }, [activeBusiness?.id]);

    const setRefusal = (patch: Partial<WaybillSettings["refusalNote"]>) =>
        setSettings(s => ({ ...s, refusalNote: { ...s.refusalNote, ...patch } }));

    const missingAmount = settings.refusalNote.enabled && !settings.refusalNote.text.includes(SHIPPING_PLACEHOLDER);
    const example = refusalNoteFor({ ...settings, refusalNote: { ...settings.refusalNote, enabled: true } }, EXAMPLE_SHIPPING);

    const save = async () => {
        if (!activeBusiness) return;
        setSaving(true);
        try {
            // Merged into what is saved now, not into the copy this page
            // loaded with, so nothing saved from another tab is undone.
            const { data: fresh, error: readError } = await supabase.from("businesses").select("theme_config").eq("id", activeBusiness.id).single();
            if (readError) throw readError;
            const theme_config = { ...(fresh?.theme_config || {}), waybill: settings };
            const { data, error } = await supabase.from("businesses").update({ theme_config }).eq("id", activeBusiness.id).select("id");
            if (error) throw error;
            if (!data?.length) throw new Error("RLS_BLOCKED");
            // The other tabs here save by spreading the business's theme_config
            // over their own changes; without this they would drop the waybill
            // settings until the page is reloaded. The print page reads it too.
            activeBusiness.theme_config = theme_config;
            toast.success("اتحفظت إعدادات البوليصة.");
        } catch (e) {
            console.error(e);
            toast.error((e as Error).message === "RLS_BLOCKED" ? "مش مسموحلك تعدّل الإعدادات (لازم تكون الأونر)." : "ماتحفظتش، جرّب تاني.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card dir="rtl">
            <CardHeader>
                <CardTitle>البوليصة</CardTitle>
                <CardDescription>
                    الملاحظات اللي بتتطبع للمندوب على كل بوليصة. وبتتبعت كمان لشركات الشحن اللي بتطبع البوليصة بنفسها (زي Turbo).
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <Label className="text-base">ملاحظة في حالة عدم الاستلام</Label>
                            <p className="text-sm text-muted-foreground">
                                بتطلب من المندوب يحصّل مصاريف الشحن لو العميل رفض الأوردر. بتتطبع بخط كبير في عرض البوليصة.
                            </p>
                        </div>
                        <Switch checked={settings.refusalNote.enabled} onCheckedChange={enabled => setRefusal({ enabled })} />
                    </div>
                    <Textarea
                        rows={2}
                        value={settings.refusalNote.text}
                        onChange={e => setRefusal({ text: e.target.value })}
                        disabled={!settings.refusalNote.enabled}
                    />
                    <p className="text-xs text-muted-foreground">
                        اكتب <code className="rounded bg-muted px-1">{SHIPPING_PLACEHOLDER}</code> في المكان اللي عايز يظهر فيه مبلغ شحن الأوردر.
                        الأوردرات اللي شحنها مجاني مش هيتطبع عليها الملاحظة دي.
                    </p>
                    {missingAmount && (
                        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                            الملاحظة مفيهاش {SHIPPING_PLACEHOLDER}، فالمندوب مش هيعرف يحصّل كام.
                        </p>
                    )}
                    {settings.refusalNote.enabled && example && (
                        <div className="rounded-md border-2 border-dashed p-3">
                            <p className="mb-1 text-xs text-muted-foreground">هتظهر كده على أوردر شحنه {EXAMPLE_SHIPPING} جنيه:</p>
                            <p className="font-bold">{example}</p>
                        </div>
                    )}
                </div>

                <div className="space-y-2">
                    <Label className="text-base">ملاحظة ثابتة</Label>
                    <p className="text-sm text-muted-foreground">بتتطبع على كل بوليصة جنب ملاحظات الأوردر. سيبها فاضية لو مش عايزها.</p>
                    <Input value={settings.fixedNote} onChange={e => setSettings(s => ({ ...s, fixedNote: e.target.value }))} placeholder="قابل للكسر" />
                </div>
            </CardContent>
            <CardFooter className="border-t p-6">
                <Button onClick={save} disabled={saving}>
                    {saving && <Loader2 className="h-4 w-4 animate-spin me-2" />}
                    حفظ إعدادات البوليصة
                </Button>
            </CardFooter>
        </Card>
    );
}
