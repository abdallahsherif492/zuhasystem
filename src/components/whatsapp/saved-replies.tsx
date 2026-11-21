"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { teamName } from "@/lib/team-names";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QUICK_REPLIES } from "@/lib/whatsapp/chats";

/**
 * «الردود المحفوظة»: the replies the team sends again and again, shared by
 * the whole business — anyone can add, edit or delete one
 * (whatsapp_saved_replies, 20261128). One tap in the chat, or «/» and a word.
 * {الاسم} in a reply becomes the customer's first name.
 * Until the migration runs, the built-in replies are shown, read-only.
 */

export interface SavedReply { id: string; title: string; body: string; sort: number; updated_by: string | null }

export function useSavedReplies(businessId: string | undefined) {
    const [replies, setReplies] = useState<SavedReply[] | null>(null);
    const [ready, setReady] = useState(true);
    const load = useCallback(async () => {
        if (!businessId) return;
        const { data, error } = await supabase.from("whatsapp_saved_replies").select("id, title, body, sort, updated_by")
            .eq("business_id", businessId).order("sort").order("created_at");
        if (error) {
            setReady(false);
            setReplies(QUICK_REPLIES.map((q, i) => ({ id: `builtin-${i}`, title: q.slice(0, 24), body: q, sort: i, updated_by: null })));
            return;
        }
        setReady(true);
        setReplies((data || []) as SavedReply[]);
    }, [businessId]);
    useEffect(() => {
        let gone = false;
        (async () => { if (!gone) await load(); })();
        return () => { gone = true; };
    }, [load]);
    return { replies, ready, reload: load };
}

/** The reply's words for this customer: {الاسم} → their first name. */
export const fillReply = (body: string, name: string | null) =>
    body.replace(/\{الاسم\}/g, (name || "").trim().split(/\s+/)[0] || "");

export function SavedRepliesManager({ open, onOpenChange, businessId, replies, ready, reload }: {
    open: boolean; onOpenChange: (o: boolean) => void; businessId: string;
    replies: SavedReply[] | null; ready: boolean; reload: () => Promise<void>;
}) {
    const [draft, setDraft] = useState<{ id?: string; title: string; body: string } | null>(null);
    const [busy, setBusy] = useState(false);

    const save = async () => {
        if (!draft || !draft.body.trim()) return;
        setBusy(true);
        const row = { title: draft.title.trim() || draft.body.trim().slice(0, 24), body: draft.body.trim() };
        const { error } = draft.id
            ? await supabase.from("whatsapp_saved_replies").update(row).eq("id", draft.id).eq("business_id", businessId)
            : await supabase.from("whatsapp_saved_replies").insert({ ...row, business_id: businessId, sort: (replies?.length || 0) + 1 });
        setBusy(false);
        if (error) { toast.error("ما اتحفظش، جرّب تاني."); return; }
        setDraft(null);
        await reload();
        toast.success("اتحفظ.");
    };
    const remove = async (r: SavedReply) => {
        if (!window.confirm(`تمسح «${r.title}»؟`)) return;
        const { error } = await supabase.from("whatsapp_saved_replies").delete().eq("id", r.id).eq("business_id", businessId);
        if (error) { toast.error("ما اتمسحش."); return; }
        await reload();
    };

    return (
        <Dialog open={open} onOpenChange={o => { if (!busy) { onOpenChange(o); if (!o) setDraft(null); } }}>
            <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
                <DialogHeader className="ps-8 text-start">
                    <DialogTitle>الردود المحفوظة</DialogTitle>
                    <DialogDescription>لكل الفريق: أي حد يقدر يضيف أو يعدّل أو يمسح. في الشات دوس على الرد، أو اكتب «/» وكلمة منه. «{"{الاسم}"}» بيتكتب مكانها اسم العميل.</DialogDescription>
                </DialogHeader>
                {!ready && <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">لسه محتاج تشغيل ملف 20261128_whatsapp_saved_replies.sql في Supabase عشان تقدروا تضيفوا وتعدّلوا. لحد ساعتها دي الردود الأساسية.</p>}

                {draft ? (
                    <div className="space-y-2 rounded-xl border p-3">
                        <Input placeholder="اسم قصير (اختياري) — مثلاً: الديبوزت" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
                        <textarea value={draft.body} rows={5} dir="rtl" autoFocus placeholder="نص الرد…"
                            onChange={e => setDraft({ ...draft, body: e.target.value })}
                            className="w-full rounded-lg border bg-background p-2.5 text-[15px] outline-none focus:ring-2 focus:ring-[#25d366]" />
                        <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => setDraft({ ...draft, body: `${draft.body}{الاسم}` })} className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted">+ اسم العميل</button>
                            <span className="flex-1" />
                            <Button variant="outline" size="sm" onClick={() => setDraft(null)} disabled={busy}>إلغاء</Button>
                            <Button size="sm" onClick={save} disabled={busy || !draft.body.trim()}>{busy && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}احفظ</Button>
                        </div>
                    </div>
                ) : ready && (
                    <Button variant="outline" className="w-full gap-1.5" onClick={() => setDraft({ title: "", body: "" })}><Plus className="h-4 w-4" />رد جديد</Button>
                )}

                {replies === null ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /> : replies.length === 0
                    ? <p className="py-4 text-center text-sm text-muted-foreground">مفيش ردود لسه. ضيف أول رد.</p>
                    : (
                        <ul className="divide-y">
                            {replies.map(r => (
                                <li key={r.id} className="flex items-start gap-2 py-2.5">
                                    <div className="min-w-0 flex-1">
                                        <p className="font-semibold">{r.title}</p>
                                        <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{r.body}</p>
                                        {r.updated_by && <p className="text-[11px] text-muted-foreground">آخر تعديل: {teamName(r.updated_by) || r.updated_by}</p>}
                                    </div>
                                    {ready && (
                                        <>
                                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="عدّل" onClick={() => setDraft({ id: r.id, title: r.title, body: r.body })}><Pencil className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="امسح" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button>
                                        </>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
            </DialogContent>
        </Dialog>
    );
}
