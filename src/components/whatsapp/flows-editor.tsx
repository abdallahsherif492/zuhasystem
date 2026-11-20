"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Plus, Trash2, Zap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { teamName } from "@/lib/team-names";
import {
    EVENT_LABEL, FIELD_CHOICES, FIELD_LABEL, FIELD_OPS, FLOW_PRESETS, OP_LABEL, TEMPLATE_LABEL, TEXT_FIELDS, newFlowId,
    type Flow, type FlowAction, type FlowCondition, type FlowEvent, type FlowField, type FlowTemplate, type FlowTrigger,
} from "@/lib/whatsapp/flow-types";

/**
 * «الأتمتة»: the WhatsApp rules, written as sentences — لما … / لو … / يبقى …
 * Each rule acts once per order (once per message for answers); the engine
 * is lib/whatsapp/flows.ts. Saved with the rest of Settings → WhatsApp.
 */

const field = "h-10 rounded-lg border bg-background px-2.5 text-[15px] outline-none focus:ring-2 focus:ring-[#25d366] disabled:opacity-60";

const TRIGGERS: { value: string; label: string }[] = [
    ...(Object.keys(EVENT_LABEL) as FlowEvent[]).map(e => ({ value: `event:${e}`, label: EVENT_LABEL[e] })),
    { value: "reply", label: "العميل بعت رسالة" },
    { value: "no_reply", label: "العميل مردش على رسالة التأكيد" },
];
const triggerValue = (t: FlowTrigger) => (t.type === "event" ? `event:${t.event}` : t.type);
const toTrigger = (v: string, hours = 4): FlowTrigger =>
    v.startsWith("event:") ? { type: "event", event: v.slice(6) as FlowEvent } : v === "reply" ? { type: "reply" } : { type: "no_reply", hours };

const ACTIONS: { value: FlowAction["type"]; label: string }[] = [
    { value: "template", label: "ابعت قالب" },
    { value: "text", label: "ابعت رسالة" },
    { value: "status", label: "غيّر حالة الأوردر" },
    { value: "assign", label: "حوّله لمودريتور" },
    { value: "note", label: "اكتب ملاحظة على الأوردر" },
];
const blankAction = (type: FlowAction["type"]): FlowAction =>
    type === "template" ? { type, template: "reminder" } : type === "text" ? { type, text: "" } : type === "status" ? { type, status: "Pending" }
        : type === "assign" ? { type, email: "" } : { type: "note", text: "" };

function summary(f: Flow): string {
    const when = f.trigger.type === "event" ? EVENT_LABEL[f.trigger.event] : f.trigger.type === "reply" ? "العميل بعت رسالة" : `العميل مردش ${f.trigger.hours} ساعة`;
    const ifs = f.conditions.map(c => `${FIELD_LABEL[c.field]} ${OP_LABEL[c.op]} ${FIELD_CHOICES[c.field]?.find(x => x.value === c.value)?.label || c.value}`)
        .join(f.match === "any" ? " أو " : " و ");
    const does = f.actions.map(a => a.type === "template" ? `يبعت «${TEMPLATE_LABEL[a.template]}»` : a.type === "text" ? "يبعت رسالة"
        : a.type === "status" ? (a.status === "Pending" ? "يأكد الأوردر" : "يلغي الأوردر") : a.type === "assign" ? `يحوّله لـ ${teamName(a.email) || "…"}` : "يكتب ملاحظة").join("، ");
    return `لما ${when}${ifs ? `، لو ${ifs}` : ""} ← ${does || "…"}`;
}

export function FlowsEditor({ businessId, flows, onChange, onSave, saving, manager }: {
    businessId: string; flows: Flow[]; onChange: (flows: Flow[]) => void; onSave: () => void; saving: boolean; manager: boolean;
}) {
    const [open, setOpen] = useState<string | null>(null);
    const [members, setMembers] = useState<string[]>([]);
    useEffect(() => {
        let gone = false;
        (async () => {
            const { data } = await supabase.from("business_users").select("user_email").eq("business_id", businessId);
            if (!gone) setMembers((data || []).map(m => String(m.user_email).toLowerCase()).filter(Boolean));
        })();
        return () => { gone = true; };
    }, [businessId]);

    const update = (id: string, patch: Partial<Flow>) => onChange(flows.map(f => (f.id === id ? { ...f, ...patch } : f)));
    const add = (base?: Omit<Flow, "id">) => {
        const f: Flow = { id: newFlowId(), ...(base || { name: "قاعدة جديدة", enabled: true, trigger: { type: "event", event: "new_order" }, match: "all", conditions: [], actions: [{ type: "template", template: "reminder" }] }) };
        onChange([...flows, f]);
        setOpen(f.id);
    };
    const unusedPresets = FLOW_PRESETS.filter(p => !flows.some(f => f.name === p.flow.name));

    return (
        <section className="space-y-4 rounded-2xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-bold"><Zap className="h-5 w-5 text-[#25d366]" />الأتمتة</h2>
                    <p className="text-sm text-muted-foreground">قواعد بتشتغل لوحدها: لما يحصل حاجة، ولو الأوردر فيه شروط معينة، يعمل خطوات. كل قاعدة بتشتغل مرة واحدة على الأوردر.</p>
                </div>
                {manager && <Button onClick={() => add()} className="gap-1.5"><Plus className="h-4 w-4" />قاعدة جديدة</Button>}
            </div>

            {flows.length === 0 && <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">مفيش قواعد لسه. ابدأ بواحدة جاهزة من تحت أو اعمل قاعدة جديدة.</p>}

            <ul className="space-y-3">
                {flows.map(f => (
                    <li key={f.id} className={cn("overflow-hidden rounded-xl border", open === f.id && "ring-2 ring-[#25d366]/40")}>
                        <div className="flex items-center gap-3 p-3">
                            <Switch checked={f.enabled} disabled={!manager} onCheckedChange={v => update(f.id, { enabled: v })} aria-label="شغّال" />
                            <button type="button" onClick={() => setOpen(open === f.id ? null : f.id)} className="min-w-0 flex-1 text-start">
                                <span className={cn("block font-semibold", !f.enabled && "text-muted-foreground")}>{f.name}</span>
                                <span className="block text-sm text-muted-foreground">{summary(f)}</span>
                            </button>
                            <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", open === f.id && "rotate-180")} />
                        </div>
                        {open === f.id && (
                            <FlowForm flow={f} members={members} disabled={!manager}
                                onChange={patch => update(f.id, patch)}
                                onDelete={() => { onChange(flows.filter(x => x.id !== f.id)); setOpen(null); }} />
                        )}
                    </li>
                ))}
            </ul>

            {manager && unusedPresets.length > 0 && (
                <div className="space-y-2">
                    <p className="text-sm font-semibold text-muted-foreground">قواعد جاهزة</p>
                    <div className="flex flex-wrap gap-2">
                        {unusedPresets.map(p => (
                            <button key={p.title} type="button" onClick={() => add(p.flow)}
                                className="rounded-full border bg-background px-3 py-1.5 text-sm hover:bg-muted">+ {p.title}</button>
                        ))}
                    </div>
                </div>
            )}

            {manager && <Button onClick={onSave} disabled={saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}احفظ القواعد</Button>}
        </section>
    );
}

function FlowForm({ flow: f, members, disabled, onChange, onDelete }: {
    flow: Flow; members: string[]; disabled: boolean; onChange: (patch: Partial<Flow>) => void; onDelete: () => void;
}) {
    const setAction = (i: number, a: FlowAction) => onChange({ actions: f.actions.map((x, j) => (j === i ? a : x)) });
    const textOutsideWindow = f.trigger.type !== "reply" && f.actions.some(a => a.type === "text");

    return (
        <div dir="rtl" className="space-y-5 border-t bg-muted/30 p-4">
            <label className="block space-y-1.5">
                <span className="text-sm font-semibold">اسم القاعدة</span>
                <input value={f.name} disabled={disabled} onChange={e => onChange({ name: e.target.value })} className={cn(field, "w-full")} />
            </label>

            <div className="space-y-2">
                <p className="text-base font-bold">لما</p>
                <div className="flex flex-wrap items-center gap-2">
                    <select value={triggerValue(f.trigger)} disabled={disabled} className={cn(field, "min-w-0 flex-1")}
                        onChange={e => onChange({ trigger: toTrigger(e.target.value), conditions: e.target.value === "reply" ? f.conditions : f.conditions.filter(c => c.field !== "reply") })}>
                        {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    {f.trigger.type === "no_reply" && (
                        <span className="flex items-center gap-2 text-[15px]">بعد
                            <input type="number" min={1} max={72} value={f.trigger.hours} disabled={disabled} className={cn(field, "w-20")}
                                onChange={e => onChange({ trigger: { type: "no_reply", hours: Math.max(1, Number(e.target.value) || 1) } })} />
                            ساعة
                        </span>
                    )}
                </div>
                {f.trigger.type === "no_reply" && <p className="text-xs text-muted-foreground">بيتشيّك كل ساعة، والأوردر لازم يكون لسه في الانتظار.</p>}
            </div>

            <div className="space-y-2">
                <ConditionsEditor title="لو" match={f.match} conditions={f.conditions} disabled={disabled} allowReply={f.trigger.type === "reply"}
                    onChange={patch => onChange(patch)} />
            </div>

            <div className="space-y-2">
                <p className="text-base font-bold">يبقى</p>
                {f.actions.map((a, i) => (
                    <div key={i} className="space-y-2 rounded-lg bg-background p-2 ring-1 ring-border">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#25d366] text-xs font-bold text-white">{i + 1}</span>
                            <select value={a.type} disabled={disabled} className={field} onChange={e => setAction(i, blankAction(e.target.value as FlowAction["type"]))}>
                                {ACTIONS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                            </select>
                            {a.type === "template" && (
                                <select value={a.template} disabled={disabled} className={cn(field, "min-w-0 flex-1")} onChange={e => setAction(i, { type: "template", template: e.target.value as FlowTemplate })}>
                                    {(Object.keys(TEMPLATE_LABEL) as FlowTemplate[]).map(t => <option key={t} value={t}>{TEMPLATE_LABEL[t]}</option>)}
                                </select>
                            )}
                            {a.type === "status" && (
                                <select value={a.status} disabled={disabled} className={cn(field, "min-w-0 flex-1")} onChange={e => setAction(i, { type: "status", status: e.target.value as "Pending" | "Cancelled" })}>
                                    <option value="Pending">أكّد الأوردر</option>
                                    <option value="Cancelled">الغي الأوردر</option>
                                </select>
                            )}
                            {a.type === "assign" && (
                                <select value={a.email} disabled={disabled} className={cn(field, "min-w-0 flex-1")} onChange={e => setAction(i, { type: "assign", email: e.target.value })}>
                                    <option value="">اختار مودريتور</option>
                                    {members.map(m => <option key={m} value={m}>{teamName(m) || m}</option>)}
                                </select>
                            )}
                            <Button variant="ghost" size="icon" className="ms-auto" disabled={disabled} aria-label="شيل الخطوة" onClick={() => onChange({ actions: f.actions.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                        {(a.type === "text" || a.type === "note") && (
                            <>
                                <textarea value={a.text} disabled={disabled} rows={a.type === "text" ? 3 : 2} dir="rtl"
                                    placeholder={a.type === "text" ? "اكتب الرسالة…" : "الملاحظة…"}
                                    className="w-full rounded-lg border bg-background p-2.5 text-[15px] outline-none focus:ring-2 focus:ring-[#25d366]"
                                    onChange={e => setAction(i, { ...a, text: e.target.value })} />
                                <div className="flex flex-wrap gap-1.5">
                                    {TEXT_FIELDS.map(t => (
                                        <button key={t.key} type="button" disabled={disabled} onClick={() => setAction(i, { ...a, text: `${a.text}${a.text && !a.text.endsWith(" ") ? " " : ""}${t.key}` })}
                                            className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted">+ {t.label}</button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                ))}
                {textOutsideWindow && (
                    <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                        الرسالة العادية بتوصل بس لو العميل كاتبلنا في آخر 24 ساعة (قانون واتساب). في القواعد اللي مش بعد رد العميل، استخدم «ابعت قالب».
                    </p>
                )}
                <Button variant="outline" size="sm" disabled={disabled} className="gap-1" onClick={() => onChange({ actions: [...f.actions, blankAction("template")] })}>
                    <Plus className="h-4 w-4" />خطوة
                </Button>
            </div>

            {!disabled && (
                <button type="button" onClick={onDelete} className="flex items-center gap-1.5 text-sm font-semibold text-destructive hover:underline">
                    <Trash2 className="h-4 w-4" />امسح القاعدة
                </button>
            )}
        </div>
    );
}

/**
 * Conditions on an order — «كل الشروط (و)» or «أي شرط منهم (أو)» — shared by
 * the rules and by the automatic confirm / cancel settings.
 */
export function ConditionsEditor({ title, match, conditions, onChange, disabled, allowReply, empty }: {
    title: string; match: "all" | "any"; conditions: FlowCondition[]; disabled: boolean; allowReply?: boolean; empty?: string;
    onChange: (patch: { match?: "all" | "any"; conditions?: FlowCondition[] }) => void;
}) {
    const setCond = (i: number, patch: Partial<FlowCondition>) => onChange({ conditions: conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
    const fields = (Object.keys(FIELD_LABEL) as FlowField[]).filter(k => k !== "reply" || allowReply);
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-bold">{title}</p>
                {conditions.length > 1 && (
                    <div className="flex rounded-lg border bg-background p-0.5 text-sm">
                        {(["all", "any"] as const).map(m => (
                            <button key={m} type="button" disabled={disabled} onClick={() => onChange({ match: m })}
                                className={cn("rounded-md px-3 py-1", match === m ? "bg-[#25d366] font-semibold text-white" : "text-muted-foreground")}>
                                {m === "all" ? "كل الشروط (و)" : "أي شرط منهم (أو)"}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {conditions.length === 0 && <p className="text-sm text-muted-foreground">{empty || "من غير شروط: على كل الأوردرات."}</p>}
            {conditions.map((c, i) => {
                const choices = FIELD_CHOICES[c.field];
                return (
                    <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-background p-2 ring-1 ring-border">
                        {i > 0 && <span className="w-full text-xs font-bold text-[#0b7a3e]">{match === "any" ? "أو" : "و"}</span>}
                        <select value={c.field} disabled={disabled} className={field}
                            onChange={e => { const fl = e.target.value as FlowField; setCond(i, { field: fl, op: FIELD_OPS[fl][0], value: FIELD_CHOICES[fl]?.[0]?.value || "" }); }}>
                            {fields.map(k => <option key={k} value={k}>{FIELD_LABEL[k]}</option>)}
                        </select>
                        <select value={c.op} disabled={disabled} className={field} onChange={e => setCond(i, { op: e.target.value as FlowCondition["op"] })}>
                            {FIELD_OPS[c.field].map(o => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
                        </select>
                        {choices ? (
                            <select value={c.value} disabled={disabled} className={cn(field, "min-w-0 flex-1")} onChange={e => setCond(i, { value: e.target.value })}>
                                {choices.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                            </select>
                        ) : (
                            <input value={c.value} disabled={disabled} inputMode={["total", "items"].includes(c.field) ? "numeric" : undefined}
                                placeholder={c.field === "sku" ? "K71، K72" : c.field === "governorate" ? "القاهرة" : c.field === "total" ? "1500" : c.field === "reply" ? "كلمة في رد العميل" : ""}
                                className={cn(field, "min-w-0 flex-1")} onChange={e => setCond(i, { value: e.target.value })} />
                        )}
                        <Button variant="ghost" size="icon" disabled={disabled} aria-label="شيل الشرط" onClick={() => onChange({ conditions: conditions.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                );
            })}
            <Button variant="outline" size="sm" disabled={disabled} className="gap-1"
                onClick={() => onChange({ conditions: [...conditions, { field: allowReply ? "reply" : "total", op: allowReply ? "contains" : "gt", value: "" }] })}>
                <Plus className="h-4 w-4" />شرط
            </Button>
        </div>
    );
}
