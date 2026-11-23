"use client";

import { useEffect, useState } from "react";
import { Loader2, Truck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { teamName } from "@/lib/team-names";
import type { TeamMember, WhatsAppSettings } from "@/lib/whatsapp/settings";

/**
 * Settings → WhatsApp → «فريق الشحن» (lib/whatsapp/team-alerts.ts): who gets
 * the customers' answers to shipping messages, ready to forward to the
 * courier's group, and the last ones that went.
 */

type Person = { user_email: string; role: string; shift_start: string | null; shift_end: string | null; weekend_days: string[] | null };
type Alert = { id: string; order_id: string; member_email: string; body: string; error: string | null; created_at: string };

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "—");

export function TeamAlertsSettings({ businessId, value, onChange, onSave, saving, manager }: {
    businessId: string; value: WhatsAppSettings["team_alerts"]; onChange: (v: WhatsAppSettings["team_alerts"]) => void;
    onSave: () => void; saving: boolean; manager: boolean;
}) {
    const [people, setPeople] = useState<Person[] | null>(null);
    const [alerts, setAlerts] = useState<Alert[] | null>(null);
    useEffect(() => {
        let gone = false;
        (async () => {
            const [p, a] = await Promise.all([
                supabase.from("business_users").select("user_email, role, shift_start, shift_end, weekend_days").eq("business_id", businessId),
                supabase.from("whatsapp_team_alerts").select("id, order_id, member_email, body, error, created_at").eq("business_id", businessId)
                    .order("created_at", { ascending: false }).limit(15),
            ]);
            if (gone) return;
            setPeople(((p.data || []) as Person[]).sort((x, y) => teamName(x.user_email).localeCompare(teamName(y.user_email), "ar")));
            // Before 20261201 the table is not there: nothing to show yet.
            setAlerts(a.error ? [] : (a.data || []) as Alert[]);
        })();
        return () => { gone = true; };
    }, [businessId]);

    const memberOf = (email: string): TeamMember =>
        value.members.find(m => m.email.toLowerCase() === email.toLowerCase()) || { email, phone: "", on: false };
    const setMember = (email: string, patch: Partial<TeamMember>) => {
        const next = { ...memberOf(email), ...patch };
        onChange({ ...value, members: [...value.members.filter(m => m.email.toLowerCase() !== email.toLowerCase()), next] });
    };
    const ready = value.members.filter(m => m.on && m.phone.replace(/\D/g, "").length >= 10).length;

    return (
        <section className="space-y-5 rounded-2xl border bg-card p-5">
            <label className="flex items-start justify-between gap-4">
                <span>
                    <span className="flex items-center gap-2 text-lg font-bold"><Truck className="h-5 w-5 text-[#25d366]" />ردود العملاء على متابعة الشحن</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                        لما العميل يرد على رسالة «المندوب ماقدرش يوصله» أو «الشحنة راجعة»، مودريتور من اللي في الشيفت بيوصله على واتسابه رسالة جاهزة يحوّلها لجروب شركة الشحن:
                        البوليصة، كود الأوردر، العميل، المطلوب من شركة الشحن (يحاولوا تاني بسرعة / يكلموا العميل / يوقفوا المحاولات ويرجّعوه)، وكل ردود العميل، الزراير واللي كتبه بإيده.
                        لو العميل كتب حاجة تانية بعدها، الرسالة بتتبعت تاني كاملة لنفس المودريتور.
                    </span>
                </span>
                <Switch checked={value.enabled} onCheckedChange={v => onChange({ ...value, enabled: v })} disabled={!manager} />
            </label>

            <div className="space-y-2">
                <p className="text-sm font-semibold">مين يستلم؟</p>
                <p className="text-xs text-muted-foreground">
                    بتتقسم على اللي عامل تسجيل حضور دلوقتي؛ لو محدش، على اللي شيفته دلوقتي؛ ولو محدش خالص، على أي حد مفعّل. اللي استلم أقل النهارده بياخد الجاية، ونفس الأوردر بيروح لنفس المودريتور.
                    أول ما شيفت المودريتور يبدأ (يسجّل حضور، أو ييجي ميعاد شيفته) بتوصله رسالة واحدة فيها زرار «جاهز» (قالب بحوالي 0.2 جنيه). لما يدوس «جاهز»، كل الرسايل اللي بتوصله بعدها لمدة 24 ساعة بتبقى ببلاش. لو مادسش، كل رسالة بتتبعت كقالب مدفوع.
                </p>
                {!people ? (
                    <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : (
                    <div className="divide-y rounded-xl border">
                        {people.map(p => {
                            const m = memberOf(p.user_email);
                            return (
                                <div key={p.user_email} className="flex flex-wrap items-center gap-3 p-3">
                                    <div className="min-w-32 flex-1">
                                        <p className="font-semibold">{teamName(p.user_email)}</p>
                                        <p className="text-xs text-muted-foreground" dir="ltr">
                                            {hhmm(p.shift_start)}–{hhmm(p.shift_end)}{(p.weekend_days || []).length ? ` · off ${(p.weekend_days || []).join(", ")}` : ""}
                                        </p>
                                    </div>
                                    <Input dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" className="h-10 w-40" value={m.phone} disabled={!manager}
                                        onChange={e => setMember(p.user_email, { phone: e.target.value.trim() })} />
                                    <Switch checked={m.on} disabled={!manager || m.phone.replace(/\D/g, "").length < 10}
                                        onCheckedChange={v => setMember(p.user_email, { on: v })} aria-label={`${teamName(p.user_email)} يستلم`} />
                                </div>
                            );
                        })}
                    </div>
                )}
                {value.enabled && ready === 0 && <p className="text-sm font-medium text-amber-700">مفيش حد مفعّل برقمه: مش هيتبعت لحد.</p>}
            </div>

            <div className="flex justify-end">
                <Button onClick={onSave} disabled={!manager || saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}احفظ</Button>
            </div>

            {alerts && alerts.length > 0 && (
                <div className="space-y-2 border-t pt-4">
                    <p className="text-sm font-semibold">آخر اللي اتبعت</p>
                    <ul className="space-y-2">
                        {alerts.map(a => (
                            <li key={a.id} className="rounded-lg bg-muted/40 p-3 text-sm">
                                <p className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                                    <span>لـ {teamName(a.member_email)} · <span dir="ltr">#{a.order_id.slice(0, 8).toUpperCase()}</span></span>
                                    <span>{new Date(a.created_at).toLocaleString("ar-EG", { day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                                </p>
                                <p className="mt-1 line-clamp-3 whitespace-pre-wrap">{a.body}</p>
                                {a.error && <p className="mt-1 text-xs font-medium text-red-600">ماوصلتش: {a.error}</p>}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}
