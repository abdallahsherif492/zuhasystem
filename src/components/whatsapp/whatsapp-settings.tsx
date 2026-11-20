"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TEMPLATES } from "@/lib/whatsapp/templates";
import { FlowsEditor } from "@/components/whatsapp/flows-editor";
import { CONFIRM_TEMPLATES, ORDER_EVENTS, whatsappSettingsOf, type WhatsAppSettings } from "@/lib/whatsapp/settings";

/**
 * Settings → WhatsApp, below the connected number: the message templates and
 * their review status at Meta, and how answers to the confirmation message
 * are handled (businesses.theme_config.whatsapp).
 */

const STATUS: Record<string, { label: string; tone: string }> = {
    APPROVED: { label: "متوافق عليه", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
    PENDING: { label: "بيتراجع", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
    IN_APPEAL: { label: "بيتراجع", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
    REJECTED: { label: "مرفوض", tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
    PAUSED: { label: "متوقف", tone: "bg-zinc-200 text-zinc-700" },
};

export function WhatsAppTemplatesAndRules({ businessId, manager }: { businessId: string; manager: boolean }) {
    const [meta, setMeta] = useState<{ name: string; status: string; rejected_reason?: string }[] | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [settings, setSettings] = useState<WhatsAppSettings | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let gone = false;
        (async () => {
            const [t, b] = await Promise.all([
                fetch(`/api/whatsapp/templates?business_id=${businessId}`).then(r => r.json()).catch(() => ({})),
                supabase.from("businesses").select("theme_config").eq("id", businessId).maybeSingle(),
            ]);
            if (gone) return;
            setMeta(t.templates || []);
            setSettings(whatsappSettingsOf(b.data?.theme_config));
        })();
        return () => { gone = true; };
    }, [businessId]);

    const submit = async () => {
        setSubmitting(true);
        const res = await fetch("/api/whatsapp/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ business_id: businessId }) });
        const body = await res.json().catch(() => ({}));
        setSubmitting(false);
        if (!res.ok) { toast.error(body.error || "ما اتبعتتش."); return; }
        setMeta(body.templates || []);
        const failed = (body.results || []).filter((r: { ok: boolean }) => !r.ok);
        if (failed.length) toast.error(`${failed.length} ما اتبعتوش: ${failed.map((f: { name: string; error?: string }) => `${f.name} (${f.error})`).join("، ")}`);
        else toast.success(body.results?.length ? `اتبعت ${body.results.length} قالب لـ Meta تراجعهم.` : "كل القوالب متبعتة قبل كده.");
    };

    const save = async () => {
        if (!settings) return;
        setSaving(true);
        const { data: fresh } = await supabase.from("businesses").select("theme_config").eq("id", businessId).single();
        const theme_config = { ...(fresh?.theme_config || {}), whatsapp: settings };
        const { data, error } = await supabase.from("businesses").update({ theme_config }).eq("id", businessId).select("id");
        setSaving(false);
        if (error || !data?.length) { toast.error("ما اتحفظش. الأونر أو الأدمن بس اللي يقدر يغيّر الإعدادات."); return; }
        toast.success("اتحفظ.");
    };

    const byName = new Map((meta || []).map(t => [t.name, t]));
    const missing = TEMPLATES.filter(t => !byName.has(t.name)).length;
    const set = (patch: Partial<WhatsAppSettings>) => setSettings(s => (s ? { ...s, ...patch } : s));

    return (
        <>
            <section className="space-y-3 rounded-2xl border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-bold">القوالب</h2>
                    {manager && missing > 0 && (
                        <Button onClick={submit} disabled={submitting} className="gap-2">
                            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}ابعت {missing} قالب لـ Meta
                        </Button>
                    )}
                </div>
                <p className="text-sm text-muted-foreground">أول رسالة لأي عميل لازم تكون قالب Meta وافقت عليه. المراجعة بتاخد من دقايق لكام ساعة.</p>
                {meta === null ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
                    <ul className="divide-y">
                        {TEMPLATES.map(t => {
                            const m = byName.get(t.name);
                            const st = m ? STATUS[m.status] || { label: m.status, tone: "bg-muted" } : { label: "مش متبعت", tone: "bg-muted text-muted-foreground" };
                            return (
                                <li key={t.name} className="flex items-start justify-between gap-3 py-2.5">
                                    <div className="min-w-0">
                                        <p className="font-semibold">{t.purpose}</p>
                                        <p className="font-mono text-xs text-muted-foreground" dir="ltr">{t.name}</p>
                                        {m?.rejected_reason && m.rejected_reason !== "NONE" && <p className="text-xs text-red-700">سبب الرفض: {m.rejected_reason}</p>}
                                    </div>
                                    <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", st.tone)}>{st.label}</span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            {settings && (
                <section className="space-y-3 rounded-2xl border bg-card p-5">
                    <h2 className="text-lg font-bold">رسايل بتتبعت لوحدها</h2>
                    <p className="text-sm text-muted-foreground">أول ما حالة الأوردر تتغير، العميل بتوصله الرسالة في خلال دقيقة من رقم الشركة. الأوردر الواحد مابيوصلوش نفس الرسالة مرتين.</p>
                    <ul className="divide-y">
                        {ORDER_EVENTS.map(e => {
                            const ready = (e.key === "new_order" ? CONFIRM_TEMPLATES : [e.template]).some(n => byName.get(n)?.status === "APPROVED");
                            return (
                                <li key={e.key}>
                                    <label className="flex items-center justify-between gap-4 py-3">
                                        <span className="min-w-0">
                                            <span className="block font-semibold">{e.label}</span>
                                            {meta && !ready && <span className="block text-xs text-amber-700">القالب لسه ماتوافقش عليه، هيبدأ يتبعت أول ما Meta توافق.</span>}
                                        </span>
                                        <Switch checked={settings.events[e.key]} disabled={!manager}
                                            onCheckedChange={v => set({ events: { ...settings.events, [e.key]: v } })} />
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                    {manager && <Button onClick={save} disabled={saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}احفظ</Button>}
                </section>
            )}

            {settings && (
                <section className="space-y-4 rounded-2xl border bg-card p-5">
                    <h2 className="text-lg font-bold">لما العميل يرد على رسالة التأكيد</h2>
                    <label className="flex items-start justify-between gap-4">
                        <span>
                            <span className="block font-semibold">«تأكيد» يأكد الأوردر لوحده</span>
                            <span className="block text-sm text-muted-foreground">لو فيه منتج مش متربط، أو العميل استلامه ضعيف، أو العنوان ناقص، الأوردر بيفضل للمودريتور والعميل بيوصله المطلوب منه.</span>
                        </span>
                        <Switch checked={settings.auto_confirm} onCheckedChange={v => set({ auto_confirm: v })} disabled={!manager} />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5"><Label>الديبوزت (جنيه)</Label><Input type="number" min={0} value={settings.deposit_amount} disabled={!manager} onChange={e => set({ deposit_amount: Number(e.target.value) || 0 })} /></div>
                        <div className="space-y-1.5"><Label>رقم انستا باي</Label><Input dir="ltr" value={settings.deposit_instapay} disabled={!manager} onChange={e => set({ deposit_instapay: e.target.value })} /></div>
                        <div className="space-y-1.5"><Label>محفظة كاش</Label><Input dir="ltr" value={settings.deposit_wallet} disabled={!manager} onChange={e => set({ deposit_wallet: e.target.value })} /></div>
                    </div>
                    <div className="max-w-xs space-y-1.5">
                        <Label>العنوان يعتبر ناقص لو أقل من (كلمة)</Label>
                        <Input type="number" min={1} value={settings.min_address_words} disabled={!manager} onChange={e => set({ min_address_words: Number(e.target.value) || 1 })} />
                    </div>
                    {manager && <Button onClick={save} disabled={saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}احفظ</Button>}
                </section>
            )}

            {settings && (
                <FlowsEditor businessId={businessId} flows={settings.flows} manager={manager} saving={saving}
                    onChange={flows => set({ flows })} onSave={save} />
            )}
        </>
    );
}
