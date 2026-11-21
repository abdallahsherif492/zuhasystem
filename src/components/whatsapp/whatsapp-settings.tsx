"use client";

import { useEffect, useState } from "react";
import { Bot, FileText, Gift, Send, Zap } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WhatsAppBulkSend } from "@/components/whatsapp/bulk-send";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TEMPLATES } from "@/lib/whatsapp/templates";
import { ConditionsEditor, FlowsEditor } from "@/components/whatsapp/flows-editor";
import { TemplatesManager, type MetaTemplate } from "@/components/whatsapp/templates-manager";
import { CASES, type MessageCase } from "@/lib/whatsapp/template-fields";
import { UpsellSettings } from "@/components/whatsapp/upsell-settings";
import { OfferResults } from "@/components/whatsapp/offer-results";
import { CONFIRM_TEMPLATES, ORDER_EVENTS, whatsappSettingsOf, type WhatsAppSettings } from "@/lib/whatsapp/settings";

/**
 * Settings → WhatsApp, below the connected number: the message templates and
 * their review status at Meta, and how answers to the confirmation message
 * are handled (businesses.theme_config.whatsapp).
 */


export function WhatsAppTemplatesAndRules({ businessId, manager }: { businessId: string; manager: boolean }) {
    const [meta, setMeta] = useState<MetaTemplate[] | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [settings, setSettings] = useState<WhatsAppSettings | null>(null);
    const [saving, setSaving] = useState(false);
    const TABS = [
        { key: "auto", label: "الرسايل الأوتوماتيك", icon: Bot },
        { key: "templates", label: "القوالب", icon: FileText },
        { key: "flows", label: "الأتمتة", icon: Zap },
        { key: "offers", label: "العروض والنتايج", icon: Gift },
        ...(manager ? [{ key: "bulk", label: "إرسال للقديم", icon: Send }] : []),
    ];
    const [tab, setTab] = useState(() => {
        try { return (typeof window !== "undefined" && localStorage.getItem("wa-settings-tab")) || "auto"; } catch { return "auto"; }
    });
    const pickTab = (t: string) => { setTab(t); try { localStorage.setItem("wa-settings-tab", t); } catch { /* private mode */ } };

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

    // The template used for an automatic case: the system's own, or one picked here.
    const usable = (meta || []).filter(t => t.name !== "hello_world" && t.status !== "REJECTED");
    const caseTemplate = (theCase: MessageCase) => {
        const value = settings?.case_templates[theCase] || "";
        const picked = usable.find(t => t.name === value);
        return (
            <label className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">القالب:</span>
                <select value={value} disabled={!manager || !settings}
                    onChange={e => settings && set({ case_templates: { ...settings.case_templates, [theCase]: e.target.value || undefined } })}
                    className="h-8 min-w-0 max-w-full rounded-md border bg-background px-2 text-sm">
                    <option value="">الأساسي ({CASES.find(c => c.key === theCase)?.builtin})</option>
                    {usable.map(t => <option key={t.id} value={t.name}>{t.name}{t.status === "APPROVED" ? "" : " (لسه بيتراجع)"}</option>)}
                </select>
                {picked && picked.status !== "APPROVED" && <span className="text-xs text-amber-700">لحد ما يتوافق عليه بيتبعت الأساسي.</span>}
            </label>
        );
    };

    // In tabs: the page was nine sections one under the other.
    return (
        <Tabs value={tab} onValueChange={pickTab} dir="rtl" className="space-y-4">
            <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto bg-muted/60 p-1 [scrollbar-width:none]">
                {TABS.map(t => (
                    <TabsTrigger key={t.key} value={t.key} className="shrink-0 gap-1.5 px-3 py-2 text-sm data-[state=active]:font-bold">
                        <t.icon className="h-4 w-4" />{t.label}
                    </TabsTrigger>
                ))}
            </TabsList>

            <TabsContent value="auto" className="mt-0">
                <div className="grid items-start gap-4 lg:grid-cols-2">
                {settings && (
                    <section className="space-y-3 rounded-2xl border bg-card p-5">
                        <h2 className="text-lg font-bold">رسايل بتتبعت لوحدها</h2>
                        <p className="text-sm text-muted-foreground">أول ما حالة الأوردر تتغير، العميل بتوصله الرسالة في خلال دقيقة من رقم الشركة. الأوردر الواحد مابيوصلوش نفس الرسالة مرتين. اختار القالب لكل حالة: لو القالب اللي اخترته لسه ماتوافقش عليه أو وقع، بيتبعت الأساسي.</p>
                        <ul className="divide-y">
                            {ORDER_EVENTS.map(e => {
                                const ready = (e.key === "new_order" ? CONFIRM_TEMPLATES : [e.template, `${e.template}_photo`]).some(n => byName.get(n)?.status === "APPROVED");
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
                                        {caseTemplate(e.key === "new_order" ? "confirm" : e.key)}
                                    </li>
                                );
                            })}
                            <li className="py-3">
                                <span className="block font-semibold">تذكير بالتأكيد</span>
                                <span className="block text-xs text-muted-foreground">بيتبعت من قواعد الأتمتة (العميل مردش بعد X ساعة).</span>
                                {caseTemplate("reminder")}
                            </li>
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
                        {settings.auto_confirm && (
                            <div className="rounded-xl border bg-muted/30 p-3">
                                <ConditionsEditor title="ماعدا الأوردرات اللي" match={settings.auto_confirm_rule.match} conditions={settings.auto_confirm_rule.conditions} disabled={!manager}
                                    empty="مفيش استثناءات: كل الأوردرات بتتأكد لوحدها (غير الحالات اللي فوق)."
                                    onChange={patch => set({ auto_confirm_rule: { ...settings.auto_confirm_rule, ...patch } })} />
                                <p className="mt-2 text-xs text-muted-foreground">الأوردر اللي داخل في الشروط دي مابيتأكدش لوحده: بيفضل للمودريتور، والعميل بيوصله «استلمنا تأكيدك وهنراجع طلبك».</p>
                            </div>
                        )}
                        <label className="flex items-start justify-between gap-4 border-t pt-4">
                            <span>
                                <span className="block font-semibold">«إلغاء الطلب» يلغي الأوردر لوحده</span>
                                <span className="block text-sm text-muted-foreground">بيتلغى أول ما العميل يدوس، وبعدين يتسأل عن السبب. لو مقفول، الأوردر بيفضل ومكتوب عليه إن العميل عايز يلغي عشان المودريتور يكلمه.</span>
                            </span>
                            <Switch checked={settings.auto_cancel} onCheckedChange={v => set({ auto_cancel: v })} disabled={!manager} />
                        </label>
                        {settings.auto_cancel && (
                            <div className="rounded-xl border bg-muted/30 p-3">
                                <ConditionsEditor title="ماعدا الأوردرات اللي" match={settings.auto_cancel_rule.match} conditions={settings.auto_cancel_rule.conditions} disabled={!manager}
                                    empty="مفيش استثناءات: كل الأوردرات بتتلغي لوحدها."
                                    onChange={patch => set({ auto_cancel_rule: { ...settings.auto_cancel_rule, ...patch } })} />
                                <p className="mt-2 text-xs text-muted-foreground">الأوردر اللي داخل في الشروط دي مابيتلغيش لوحده: بيفضل ومكتوب عليه إن العميل عايز يلغي عشان المودريتور يكلمه. مثلاً: قيمة الأوردر أكتر من 1500.</p>
                            </div>
                        )}
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
                </div>
            </TabsContent>

            <TabsContent value="templates" className="mt-0">
            {settings && (
                <TemplatesManager businessId={businessId} manager={manager} meta={meta} setMeta={setMeta} settings={settings} set={set}
                    missing={missing} submitting={submitting} submitMissing={submit} />
            )}
            </TabsContent>

            <TabsContent value="flows" className="mt-0">
            {settings && (
                <FlowsEditor businessId={businessId} flows={settings.flows} manager={manager} saving={saving}
                    onChange={flows => set({ flows })} onSave={save} />
            )}
            </TabsContent>

            <TabsContent value="offers" className="mt-0 space-y-4">
            <OfferResults businessId={businessId} />

            {settings && (
                <UpsellSettings businessId={businessId} value={settings.upsell} manager={manager} saving={saving}
                    onChange={upsell => set({ upsell })} onSave={save} />
            )}
            </TabsContent>

            {manager && (
                <TabsContent value="bulk" className="mt-0">
                    <WhatsAppBulkSend businessId={businessId} />
                </TabsContent>
            )}
        </Tabs>
    );
}
