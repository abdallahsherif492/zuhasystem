"use client";

import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, UserCog } from "lucide-react";
import { toast } from "sonner";

/**
 * This person's own interface settings.
 *
 * Separate card, above the business ones, because they answer different
 * questions: the business section decides what a new member starts on, this
 * decides what the person reading it sees. Saving here changes nothing for
 * anyone else.
 */
export function MyPreferences() {
    const {
        t, language, direction,
        businessLanguage, businessDirection,
        isPersonal, setPreference,
    } = useLanguage();

    const [saving, setSaving] = useState(false);

    // "default" is a real, selectable state rather than an absence: someone who
    // set English once should be able to hand the choice back to the business
    // without guessing which value that was.
    const langValue = isPersonal || language !== businessLanguage ? language : "default";
    const dirValue = isPersonal || direction !== businessDirection ? direction : "default";

    async function save(next: { language: string; direction: string }) {
        setSaving(true);
        try {
            await setPreference({
                language: next.language === "default" ? null : next.language as "en" | "ar",
                direction: next.direction === "default" ? null : next.direction as "ltr" | "rtl",
            });
            toast.success(t("Saved"));
        } catch (e: any) {
            console.error("Failed to save preferences:", e);
            toast.error(
                e?.code === "42P01"
                    ? "شغّل مايجريشن 20260907_user_preferences.sql الأول."
                    : (e?.message || t("Failed to save"))
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <UserCog className="h-5 w-5 text-muted-foreground" />
                    {t("My preferences")}
                    {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </CardTitle>
                <CardDescription>
                    {t("These apply to your account on every device you sign in from. Nobody else on the team is affected.")}
                </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                    <Label>{t("Language")}</Label>
                    <Select
                        value={langValue}
                        onValueChange={v => save({ language: v, direction: dirValue })}
                    >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="default">
                                {t("Business default")}
                                {" — "}
                                {businessLanguage === "ar" ? t("Arabic") : t("English")}
                            </SelectItem>
                            <SelectItem value="ar">{t("Arabic")}</SelectItem>
                            <SelectItem value="en">{t("English")}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-2">
                    <Label>{t("Layout Direction")}</Label>
                    <Select
                        value={dirValue}
                        onValueChange={v => save({ language: langValue, direction: v })}
                    >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="default">
                                {t("Business default")}
                                {" — "}
                                {businessDirection.toUpperCase()}
                            </SelectItem>
                            <SelectItem value="ltr">{t("Left to Right (LTR)")}</SelectItem>
                            <SelectItem value="rtl">{t("Right to Left (RTL)")}</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        {t("Controls the page layout direction, independently of the language.")}
                    </p>
                </div>

                {isPersonal && (
                    <div className="md:col-span-2">
                        <Button
                            variant="outline" size="sm" disabled={saving}
                            onClick={() => save({ language: "default", direction: "default" })}
                        >
                            {t("Use the business default again")}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
