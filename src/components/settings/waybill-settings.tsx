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
import { cn } from "@/lib/utils";
import {
    SHIPPING_PLACEHOLDER, refusalNoteFor, waybillSettingsOf, type WaybillSettings, type WaybillTemplate,
} from "@/lib/orders/waybill-settings";

const EXAMPLE_SHIPPING = 70;

const TEMPLATES: { id: WaybillTemplate; name: string; about: string }[] = [
    { id: "courier", name: "للمندوب", about: "المبلغ والباركود في عمود على الشمال، واللوجو ورسالة الشكر تحتهم. أوضح قالب للأوردرات الكبيرة." },
    { id: "ticket", name: "تذكرة", about: "جزء على الشمال للعميل فيه اللوجو كبير ورسالة الشكر، والباقي للمندوب." },
    { id: "letterhead", name: "ورقة رسمية", about: "اللوجو ورسالة الشكر في شريط فوق، وتحته العميل والمنتجات والمبلغ جنب بعض." },
];

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
                    <Label className="text-base">شكل البوليصة</Label>
                    <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="شكل البوليصة">
                        {TEMPLATES.map(tpl => (
                            <button
                                key={tpl.id}
                                type="button"
                                role="radio"
                                aria-checked={settings.template === tpl.id}
                                onClick={() => setSettings(s => ({ ...s, template: tpl.id }))}
                                className={cn(
                                    "rounded-lg border-2 p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    settings.template === tpl.id ? "border-primary bg-primary/5" : "border-border hover:border-foreground/30",
                                )}
                            >
                                <p className="font-bold">{tpl.name}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{tpl.about}</p>
                            </button>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">كل القوالب بتطبع 3 بوالص في ورقة A4، واللوجو بييجي من لوجو البيزنس.</p>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                        <Label className="text-base">رقم المتجر</Label>
                        <p className="text-sm text-muted-foreground">بيتطبع جنب اللوجو عشان المندوب أو العميل يكلمكم.</p>
                        <Input dir="ltr" inputMode="tel" value={settings.storePhone} onChange={e => setSettings(s => ({ ...s, storePhone: e.target.value }))} placeholder="01xxxxxxxxx" />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-base">رسالة الشكر</Label>
                        <p className="text-sm text-muted-foreground">سطر للعميل جنب اللوجو. سيبها فاضية لو مش عايزها.</p>
                        <Input value={settings.thanks} onChange={e => setSettings(s => ({ ...s, thanks: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-base">عرض للأوردر الجاي</Label>
                        <p className="text-sm text-muted-foreground">بيتطبع بعد رسالة الشكر. سيبه فاضي لو مفيش عرض.</p>
                        <Input value={settings.offer} onChange={e => setSettings(s => ({ ...s, offer: e.target.value }))} placeholder="خصم 10% على أوردرك الجاي بالكود" />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-base">كود الخصم</Label>
                        <p className="text-sm text-muted-foreground">بيتطبع جنب العرض في مربع متقطع عشان العميل يحتفظ بيه.</p>
                        <Input dir="ltr" value={settings.promoCode} onChange={e => setSettings(s => ({ ...s, promoCode: e.target.value }))} placeholder="LAYLA10" />
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <Label className="text-base">ملاحظة في حالة عدم الاستلام</Label>
                            <p className="text-sm text-muted-foreground">
                                بتطلب من المندوب يحصّل مصاريف الشحن لو العميل رفض الأوردر. ليها مكان في كل القوالب، بخط كبير وفي مربع.
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
                        بتتطبع على كل بوليصة. لو الشحن مجاني، بيتكتب مكانه اللي شركة الشحن بتاخده مننا.
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
