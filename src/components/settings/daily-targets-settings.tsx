"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DAILY_TARGETS_MIGRATION, settingsOf, type TargetSettings } from "@/lib/hr/daily-targets";

type Member = { user_email: string; role: string; shift_start: string | null; shift_end: string | null; weekend_days: string[] | null };

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "—");

/**
 * Settings → Moderator targets: who is measured, what each shift owes, and
 * what a missed target costs. Amounts start at 0: shown, never deducted,
 * until the owner sets them.
 */
export function DailyTargetsSettings() {
    const { activeBusiness, currentUser } = useBusiness();
    const [s, setS] = useState<TargetSettings | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [missing, setMissing] = useState(false);
    const [saving, setSaving] = useState(false);
    const businessId = activeBusiness?.id;

    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        (async () => {
            const [m, row] = await Promise.all([
                supabase.from("business_users").select("user_email, role, shift_start, shift_end, weekend_days").eq("business_id", businessId),
                supabase.from("moderator_target_settings").select("*").eq("business_id", businessId).maybeSingle(),
            ]);
            if (gone) return;
            if (row.error) setMissing(true);
            setMembers(((m.data || []) as Member[]).sort((a, b) => a.user_email.localeCompare(b.user_email)));
            setS(settingsOf(row.data));
        })();
        return () => { gone = true; };
    }, [businessId]);

    if (!s) return <Card><CardContent className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></CardContent></Card>;

    const set = <K extends keyof TargetSettings>(k: K, v: TargetSettings[K]) => setS(prev => prev ? { ...prev, [k]: v } : prev);
    const num = (k: keyof TargetSettings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, (e.target.value === "" ? 0 : Number(e.target.value)) as never);
    const toggleMember = (email: string, on: boolean) =>
        set("members", on ? [...new Set([...s.members, email.toLowerCase()])] : s.members.filter(x => x !== email.toLowerCase()));

    const save = async () => {
        if (!businessId) return;
        setSaving(true);
        const { error } = await supabase.from("moderator_target_settings").upsert({
            business_id: businessId,
            ...s,
            monthly_cap: s.monthly_cap === null || Number.isNaN(s.monthly_cap) ? null : s.monthly_cap,
            starts_on: s.starts_on || null,
            updated_by: currentUser?.email || null,
            updated_at: new Date().toISOString(),
        });
        let failed = error;
        if (error && /grace_minutes|deduct_late|deduct_early|deduct_no_clock/.test(error.message)) {
            // 20261114_target_attendance.sql not run yet: save the rest.
            const { grace_minutes, deduct_late, deduct_early, deduct_no_clockout, deduct_no_clockin, ...rest } = s;
            void grace_minutes; void deduct_late; void deduct_early; void deduct_no_clockout; void deduct_no_clockin;
            ({ error: failed } = await supabase.from("moderator_target_settings").upsert({
                business_id: businessId, ...rest, starts_on: rest.starts_on || null,
                updated_by: currentUser?.email || null, updated_at: new Date().toISOString(),
            }));
            if (!failed) toast.warning("اتحفظ من غير خصومات الحضور. شغّل supabase/migrations/20261114_target_attendance.sql الأول.");
        }
        setSaving(false);
        if (failed) {
            const error = failed;
            console.error(error);
            toast.error(/row-level security/i.test(error.message) ? "الأونر أو الأدمن بس اللي يقدر يغيّر الإعدادات دي." : "ماتحفظش، جرّب تاني.");
            return;
        }
        if (!error) toast.success("اتحفظ.");
    };

    const amount = (k: keyof TargetSettings, label: string, hint: string) => (
        <div className="space-y-1">
            <Label htmlFor={`dt-${k}`} className="text-sm">{label}</Label>
            <div className="relative">
                <Input id={`dt-${k}`} type="number" min={0} step="1" inputMode="decimal" className="pe-12"
                    value={Number(s[k]) || ""} placeholder="0" onChange={num(k)} />
                <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground">ج.م</span>
            </div>
            <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
    );

    return (
        <Card dir="rtl">
            <CardHeader>
                <CardTitle>تارجت المودريتورز اليومي</CardTitle>
                <CardDescription>
                    كل شيفت مطلوب منه اللي البيزنس محتاجه: الأوردرات تتشغل في وقتها، والشحنات المتعطلة تتتابع، وأوردرات من الرسايل، ونسبة تأكيد كويسة.
                    بعد كل شيفت بنص ساعة السيستم بيعمل للمودريتور كشف، ولو فيه حاجة متحققتش وليها خصم، بيتسجل في المرتبات.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
                {missing && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                        شغّل الملف <code className="font-mono">{DAILY_TARGETS_MIGRATION}</code> في Supabase الأول.
                    </div>
                )}

                <div className="flex items-start justify-between gap-6 rounded-lg border p-4">
                    <div>
                        <Label htmlFor="dt-enabled" className="text-base">شغّل الكشف اليومي</Label>
                        <p className="mt-1 text-sm text-muted-foreground">مقفول: محدش بيتقاس ومفيش خصم.</p>
                    </div>
                    <Switch id="dt-enabled" checked={s.enabled} onCheckedChange={v => set("enabled", v)} />
                </div>

                {/* Who */}
                <section className="space-y-3">
                    <h3 className="font-medium">مين بيتقاس</h3>
                    <p className="text-sm text-muted-foreground">
                        الشيفت بييجي من مواعيد كل واحد في <Link href="/team" className="text-primary underline-offset-4 hover:underline">الفريق</Link>. ولو سجّل حضور وانصراف، بنستخدم الساعات الحقيقية.
                    </p>
                    <ul className="divide-y rounded-lg border">
                        {members.map(m => {
                            const on = s.members.includes(m.user_email.toLowerCase());
                            return (
                                <li key={m.user_email}>
                                    <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/40">
                                        <span className="flex min-w-0 items-center gap-2.5">
                                            <Checkbox checked={on} onCheckedChange={v => toggleMember(m.user_email, !!v)} />
                                            <span className="truncate text-sm">{m.user_email}</span>
                                        </span>
                                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" dir="ltr">
                                            {hhmm(m.shift_start)}–{hhmm(m.shift_end)}{(m.weekend_days || []).length ? ` · off ${(m.weekend_days || []).join(", ")}` : ""}
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                </section>

                {/* What the business needs */}
                <section className="space-y-4">
                    <h3 className="font-medium">البيزنس محتاج إيه من كل شيفت</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Label htmlFor="dt-h" className="text-sm">كل أوردر يتشغل عليه خلال (ساعات)</Label>
                            <Input id="dt-h" type="number" min={0} step="0.5" value={s.confirm_within_hours} onChange={num("confirm_within_hours")} />
                            <p className="text-xs text-muted-foreground">يتأكد، أو يتلغى، أو تتسجل عليه محاولة اتصال.</p>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="dt-b" className="text-sm">الـ Waiting القديم المحسوب على الشيفت (أيام)</Label>
                            <Input id="dt-b" type="number" min={0} value={s.backlog_days} onChange={num("backlog_days")} />
                            <p className="text-xs text-muted-foreground">الأقدم من كده شغل تنضيف، مش شغل يوم. بأرقام زُهى: يوم واحد يطلع حوالي 30 أوردر للشيفت، و7 أيام تطلع 90.</p>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="dt-m" className="text-sm">أقل عدد أوردرات من الرسايل في الشيفت</Label>
                            <Input id="dt-m" type="number" min={0} value={s.min_message_orders} onChange={num("min_message_orders")} />
                            <p className="text-xs text-muted-foreground">0 يعني مش مطلوب.</p>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="dt-f" className="text-sm">كل شحنة متعطلة تتتابع كل (أيام)</Label>
                            <Input id="dt-f" type="number" min={1} value={s.followup_every_days} onChange={num("followup_every_days")} />
                            <p className="text-xs text-muted-foreground">المتعطلة: Returning، أو Hold to redeliver، أو Shipped من {s.stale_days} أيام أو أكتر.</p>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="dt-r" className="text-sm">أقل نسبة تأكيد (%)</Label>
                            <Input id="dt-r" type="number" min={0} max={100} value={s.min_confirm_rate} onChange={num("min_confirm_rate")} />
                            <p className="text-xs text-muted-foreground">بتتحسب لو قفل {s.min_handled_for_rate} أوردر أو أكتر في الشيفت. 0 يعني مش مطلوب.</p>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="dt-st" className="text-sm">يبدأ من يوم</Label>
                            <Input id="dt-st" type="date" value={s.starts_on || ""} onChange={e => set("starts_on", e.target.value || null)} />
                            <p className="text-xs text-muted-foreground">الشيفتات اللي قبله مش بتتقاس.</p>
                        </div>
                    </div>
                </section>

                {/* Attendance */}
                <section className="space-y-4">
                    <div>
                        <h3 className="font-medium">الحضور والانصراف</h3>
                        <p className="text-sm text-muted-foreground">
                            بيتقارن بمواعيد الشيفت المتسجلة في الفريق، فلازم تكون مظبوطة. المودريتور بيسجّل من صفحة «يومي»: /my-hr/today. أي بند تسيبه 0 مش بيتخصم عليه.
                        </p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Label htmlFor="dt-g" className="text-sm">سماح (دقايق)</Label>
                            <Input id="dt-g" type="number" min={0} value={s.grace_minutes} onChange={num("grace_minutes")} />
                            <p className="text-xs text-muted-foreground">التأخير أو الخروج بدري أقل من كده مش بيتحسب.</p>
                        </div>
                        {amount("deduct_late", "التأخير", "سجّل حضور بعد بداية الشيفت + السماح.")}
                        {amount("deduct_early", "الخروج بدري", "سجّل انصراف قبل آخر الشيفت − السماح.")}
                        {amount("deduct_no_clockout", "نسيان تسجيل الانصراف", "الشيفت خلص من نص ساعة ولسه ماسجلش انصراف.")}
                        {amount("deduct_no_clockin", "شغل من غير تسجيل حضور", "اشتغل على أوردرات في الشيفت ومسجلش حضور خالص.")}
                    </div>
                </section>

                {/* What a missed target costs */}
                <section className="space-y-4">
                    <div>
                        <h3 className="font-medium">الخصم لو متحققش</h3>
                        <p className="text-sm text-muted-foreground">قيمة الخصم لكل بند في الشيفت. لو سبتها 0، البند بيظهر في الكشف من غير خصم.</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        {amount("deduct_confirm", "سرعة التأكيد", "اشتغل على أقل من نصيبه من الأوردرات.")}
                        {amount("deduct_messages", "أوردرات الرسايل", "عمل أقل من الحد الأدنى.")}
                        {amount("deduct_followups", "متابعة الشحن", "تابع أقل من نصيبه من الشحنات المتعطلة.")}
                        {amount("deduct_rate", "نسبة التأكيد", "نسبته أقل من المطلوب.")}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Label htmlFor="dt-cap" className="text-sm">أقصى خصم في الشهر لكل مودريتور</Label>
                            <div className="relative">
                                <Input id="dt-cap" type="number" min={0} className="pe-12" placeholder="من غير حد"
                                    value={s.monthly_cap ?? ""} onChange={e => set("monthly_cap", e.target.value === "" ? null : Number(e.target.value))} />
                                <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground">ج.م</span>
                            </div>
                            <p className="text-xs text-muted-foreground">قانون العمل بيحط حد للجزاءات (حوالي 5 أيام أجر في الشهر). راجع المحاسب.</p>
                        </div>
                        <div className={cn("flex items-start justify-between gap-4 rounded-lg border p-3")}>
                            <div>
                                <Label htmlFor="dt-pay" className="text-sm">سجّل الخصم في المرتبات أوتوماتيك</Label>
                                <p className="mt-1 text-xs text-muted-foreground">لو قفلته، الخصم بيظهر في الكشف بس. وأي خصم اتسجل تقدر تمسحه من المرتبات قبل ما تسوّي الشهر.</p>
                            </div>
                            <Switch id="dt-pay" checked={s.apply_to_payroll} onCheckedChange={v => set("apply_to_payroll", v)} />
                        </div>
                    </div>
                </section>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <Link href="/team/targets" className="text-sm text-primary underline-offset-4 hover:underline">شوف كشوف المودريتورز</Link>
                    <Button onClick={save} disabled={saving || missing}>
                        {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}احفظ
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
