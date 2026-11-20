"use client";

import { useRef, useState } from "react";
import { CornerUpLeft, ImageIcon, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TEMPLATES } from "@/lib/whatsapp/templates";
import { BUILTIN_PARAMS, FIELDS, fromMetaBody, type SavedTemplate } from "@/lib/whatsapp/template-fields";
import type { WhatsAppSettings } from "@/lib/whatsapp/settings";

/**
 * Settings → WhatsApp → القوالب: every template at Meta with its text as the
 * customer reads it and its review status; add, edit, delete. The editor
 * writes order details as {الاسم}, {المنتجات}…; the server turns them into
 * Meta's {{1}}, {{2}} and remembers which is which (/api/whatsapp/templates).
 */

export interface MetaTemplate {
    id: string; name: string; status: string; category: string; rejected_reason?: string;
    components?: { type: string; format?: string; text?: string; buttons?: { type: string; text: string }[] }[];
}

const STATUS: Record<string, { label: string; tone: string }> = {
    APPROVED: { label: "متوافق عليه", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
    PENDING: { label: "بيتراجع", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
    IN_APPEAL: { label: "بيتراجع", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
    REJECTED: { label: "مرفوض", tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
    PAUSED: { label: "متوقف", tone: "bg-zinc-200 text-zinc-700" },
    DISABLED: { label: "متوقف", tone: "bg-zinc-200 text-zinc-700" },
};
const PURPOSE = new Map(TEMPLATES.map(t => [t.name, t.purpose]));
const isBuiltin = (name: string) => PURPOSE.has(name) || name === "order_confirmation";

/** A Meta template's parts, with which detail each {{n}} is. */
function partsOf(t: MetaTemplate, saved: Record<string, SavedTemplate>) {
    const body = t.components?.find(c => c.type === "BODY")?.text || "";
    const image = t.components?.some(c => c.type === "HEADER" && c.format === "IMAGE") || false;
    const buttons = t.components?.find(c => c.type === "BUTTONS")?.buttons?.map(b => b.text) || [];
    const params = saved[t.name]?.params || BUILTIN_PARAMS[t.name];
    return { body, image, buttons, params, text: fromMetaBody(body, params) };
}

interface Draft { mode: "create" | "edit"; id?: string; name: string; category: "UTILITY" | "MARKETING"; image: boolean; text: string; buttons: string[] }

export function TemplatesManager({ businessId, manager, meta, setMeta, settings, set, missing, submitting, submitMissing }: {
    businessId: string; manager: boolean; meta: MetaTemplate[] | null; setMeta: (t: MetaTemplate[]) => void;
    settings: WhatsAppSettings; set: (patch: Partial<WhatsAppSettings>) => void;
    missing: number; submitting: boolean; submitMissing: () => void;
}) {
    const [draft, setDraftState] = useState<Draft | null>(null);
    const setDraft = (d: Draft | null) => { if (!d || d.mode !== draft?.mode || d.id !== draft?.id) caret.current = null; setDraftState(d); };
    const [busy, setBusy] = useState(false);
    const [deleting, setDeleting] = useState<MetaTemplate | null>(null);
    const textRef = useRef<HTMLTextAreaElement>(null);
    // Where the cursor was in the message when the field chips were tapped (none yet: the end).
    const caret = useRef<{ start: number; end: number } | null>(null);

    const call = async (action: "create" | "edit" | "delete", template: Record<string, unknown>) => {
        setBusy(true);
        const res = await fetch("/api/whatsapp/templates", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ business_id: businessId, action, template }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) { toast.error(body.error || "ما اتعملش."); return false; }
        setMeta(body.templates || []);
        // What the server now remembers, so a later «احفظ» keeps it.
        set({ templates: body.saved || settings.templates, case_templates: body.case_templates || settings.case_templates });
        return body;
    };

    const insertField = (label: string) => {
        if (!draft) return;
        const el = textRef.current;
        const token = `{${label}}`;
        const at = caret.current?.start ?? draft.text.length;
        const text = draft.text.slice(0, at) + token + draft.text.slice(caret.current?.end ?? at);
        caret.current = { start: at + token.length, end: at + token.length };
        setDraft({ ...draft, text });
        requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length); });
    };

    const submit = async () => {
        if (!draft) return;
        const r = await call(draft.mode, { id: draft.id, name: draft.name.trim(), category: draft.category, image: draft.image, text: draft.text, buttons: draft.buttons });
        if (!r) return;
        toast.success(draft.mode === "create" ? "القالب اتبعت لـ Meta تراجعه. بياخد من دقايق لكام ساعة." : "التعديل اتبعت لـ Meta تراجعه.");
        setDraft(null);
    };

    const preview = draft ? draft.text.replace(/\{([^{}]+)\}/g, (all, w) => FIELDS.find(f => f.label === w)?.example ?? all) : "";
    const list = (meta || []).filter(t => t.name !== "hello_world")
        .sort((a, b) => Number(isBuiltin(b.name)) - Number(isBuiltin(a.name)) || a.name.localeCompare(b.name));

    return (
        <section className="space-y-3 rounded-2xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold">القوالب</h2>
                <div className="flex flex-wrap gap-2">
                    {manager && missing > 0 && (
                        <Button variant="outline" onClick={submitMissing} disabled={submitting} className="gap-2">
                            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}ابعت {missing} قالب أساسي لـ Meta
                        </Button>
                    )}
                    {manager && (
                        <Button className="gap-1.5" onClick={() => setDraft({ mode: "create", name: "", category: "UTILITY", image: false, text: "أهلاً {الاسم} 🌸\n", buttons: [] })}>
                            <Plus className="h-4 w-4" />قالب جديد
                        </Button>
                    )}
                </div>
            </div>
            <p className="text-sm text-muted-foreground">أول رسالة لأي عميل لازم تكون قالب Meta وافقت عليه. أي قالب جديد أو تعديل بيتراجع من دقايق لكام ساعة.</p>

            {meta === null ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
                <ul className="space-y-2">
                    {list.map(t => {
                        const p = partsOf(t, settings.templates);
                        const st = STATUS[t.status] || { label: t.status, tone: "bg-muted" };
                        return (
                            <li key={t.id} className="rounded-xl border p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="font-semibold">{PURPOSE.get(t.name) || t.name}</p>
                                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                            <span className="font-mono" dir="ltr">{t.name}</span>
                                            {isBuiltin(t.name) && <span className="rounded bg-muted px-1.5">أساسي</span>}
                                            {t.category === "MARKETING" && <span className="rounded bg-amber-100 px-1.5 text-amber-800">تسويق (أغلى)</span>}
                                            {p.image && <span className="flex items-center gap-0.5 rounded bg-muted px-1.5"><ImageIcon className="h-3 w-3" />صورة المنتج</span>}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", st.tone)}>{st.label}</span>
                                        {manager && (
                                            <>
                                                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="عدّل" disabled={!p.params && /\{\{\d+\}\}/.test(p.body)}
                                                    title={!p.params && /\{\{\d+\}\}/.test(p.body) ? "قالب اتعمل برا السيستم، ومش معروف كل رقم فيه يعني إيه" : "عدّل"}
                                                    onClick={() => setDraft({ mode: "edit", id: t.id, name: t.name, category: t.category === "MARKETING" ? "MARKETING" : "UTILITY", image: p.image, text: p.text, buttons: p.buttons })}>
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="امسح" onClick={() => setDeleting(t)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <p className="mt-2 line-clamp-3 whitespace-pre-wrap rounded-lg bg-[#d9fdd3] p-2 text-sm text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]">{p.text}</p>
                                {p.buttons.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{p.buttons.map(b => <span key={b} className="rounded-md border px-2 py-0.5 text-xs text-[#027eb5]">{b}</span>)}</p>}
                                {t.rejected_reason && t.rejected_reason !== "NONE" && <p className="mt-1 text-xs text-red-700">سبب الرفض: {t.rejected_reason}</p>}
                            </li>
                        );
                    })}
                </ul>
            )}

            <Dialog open={!!draft} onOpenChange={o => { if (!o && !busy) setDraft(null); }}>
                {draft && (
                    <DialogContent dir="rtl" className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>{draft.mode === "create" ? "قالب جديد" : `تعديل ${PURPOSE.get(draft.name) || draft.name}`}</DialogTitle>
                            <DialogDescription>
                                {draft.mode === "create"
                                    ? "اكتب الرسالة، وحط معلومات الأوردر من الزراير. Meta بتراجعه قبل ما يتبعت."
                                    : "التعديل بيرجع لمراجعة Meta. Meta بتسمح بتعديل القالب مرة في اليوم بس."}
                            </DialogDescription>
                        </DialogHeader>

                        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
                            <div className="space-y-3">
                                {draft.mode === "create" && (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <label className="space-y-1">
                                            <span className="text-sm font-semibold">الاسم (إنجليزي)</span>
                                            <Input dir="ltr" placeholder="order_offer_1" value={draft.name}
                                                onChange={e => setDraft({ ...draft, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
                                        </label>
                                        <label className="space-y-1">
                                            <span className="text-sm font-semibold">النوع</span>
                                            <select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value as Draft["category"] })}
                                                className="flex h-9 w-full rounded-md border bg-background px-2 text-sm">
                                                <option value="UTILITY">خدمة (طلب، شحن، تأكيد)</option>
                                                <option value="MARKETING">تسويق (عروض، أغلى في السعر)</option>
                                            </select>
                                        </label>
                                    </div>
                                )}
                                {draft.mode === "create" && (
                                    <label className="flex items-center justify-between gap-3 rounded-lg border p-2.5">
                                        <span className="text-sm"><b>صورة المنتج فوق الرسالة</b><span className="block text-xs text-muted-foreground">بتتحط صورة أول منتج في الأوردر لوحدها.</span></span>
                                        <Switch checked={draft.image} onCheckedChange={v => setDraft({ ...draft, image: v })} />
                                    </label>
                                )}
                                <label className="block space-y-1">
                                    <span className="text-sm font-semibold">الرسالة</span>
                                    <textarea ref={textRef} value={draft.text} rows={7} dir="rtl" onChange={e => setDraft({ ...draft, text: e.target.value })}
                                        onSelect={e => { caret.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd }; }}
                                        className="w-full rounded-lg border bg-background p-2.5 text-[15px] leading-relaxed outline-none focus:ring-2 focus:ring-[#25d366]" />
                                </label>
                                <div className="space-y-1">
                                    <p className="text-xs font-semibold text-muted-foreground">حط من الأوردر:</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {FIELDS.map(f => (
                                            <button key={f.key} type="button" onClick={() => insertField(f.label)} className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted">
                                                + {f.label.replace(/_/g, " ")}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <p className="text-sm font-semibold">زراير رد (لحد 3)</p>
                                    {draft.buttons.map((b, i) => (
                                        <div key={i} className="flex gap-2">
                                            <Input value={b} maxLength={25} autoFocus={i === draft.buttons.length - 1 && !b} placeholder="كلام الزرار" onChange={e => setDraft({ ...draft, buttons: draft.buttons.map((x, j) => (j === i ? e.target.value : x)) })} />
                                            <Button variant="ghost" size="icon" aria-label="شيل الزرار" onClick={() => setDraft({ ...draft, buttons: draft.buttons.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                    ))}
                                    {draft.buttons.length < 3 && (
                                        <Button variant="outline" size="sm" className="gap-1" onClick={() => setDraft({ ...draft, buttons: [...draft.buttons, ""] })}><Plus className="h-4 w-4" />زرار</Button>
                                    )}
                                    {isBuiltin(draft.name) && draft.buttons.length > 0 && (
                                        <p className="text-xs text-amber-700">السيستم بيرد لوحده على زراير القوالب الأساسية بكلامها. لو غيرت كلام زرار، الرد الأوتوماتيك عليه مش هيشتغل.</p>
                                    )}
                                </div>
                            </div>

                            {/* What the customer will see, with example values. */}
                            <div className="rounded-xl bg-[#efeae2] p-3 dark:bg-[#0b141a]">
                                <p className="mb-2 text-center text-xs text-muted-foreground">العميل هيشوفها كده</p>
                                <div className="rounded-lg bg-white p-2 text-[14px] leading-relaxed text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
                                    {draft.image && <div className="mb-1.5 flex h-28 items-center justify-center rounded-md bg-muted text-muted-foreground"><ImageIcon className="h-8 w-8" /></div>}
                                    <p className="whitespace-pre-wrap break-words">{preview || " "}</p>
                                </div>
                                {draft.buttons.filter(Boolean).map((b, i) => (
                                    <span key={i} className="mt-0.5 flex items-center justify-center gap-1.5 rounded-lg bg-white py-1.5 text-sm text-[#027eb5] shadow-sm dark:bg-[#202c33]">
                                        <CornerUpLeft className="h-3.5 w-3.5" />{b}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <DialogFooter className="gap-2">
                            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy}>إلغاء</Button>
                            <Button onClick={submit} disabled={busy || !draft.text.trim() || (draft.mode === "create" && draft.name.length < 3)}>
                                {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{draft.mode === "create" ? "ابعته لـ Meta" : "ابعت التعديل"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                )}
            </Dialog>

            <Dialog open={!!deleting} onOpenChange={o => { if (!o && !busy) setDeleting(null); }}>
                {deleting && (
                    <DialogContent dir="rtl">
                        <DialogHeader>
                            <DialogTitle>تمسح «{PURPOSE.get(deleting.name) || deleting.name}»؟</DialogTitle>
                            <DialogDescription>
                                بيتمسح من Meta على طول، ومش هتقدر تعمل قالب بنفس الاسم قبل 30 يوم.
                                {isBuiltin(deleting.name) ? " ده قالب أساسي: الحالة اللي بتستخدمه هتستخدم اللي بعده لحد ما تبعته تاني." : ""}
                                {Object.values(settings.case_templates).includes(deleting.name) ? " وهيتشال من الحالات اللي كان متختار فيها." : ""}
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter className="gap-2">
                            <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>لأ</Button>
                            <Button variant="destructive" disabled={busy} onClick={async () => {
                                const r = await call("delete", { name: deleting.name, id: deleting.id });
                                if (r) { toast.success("اتمسح."); setDeleting(null); }
                            }}>{busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}امسح</Button>
                        </DialogFooter>
                    </DialogContent>
                )}
            </Dialog>
        </section>
    );
}
