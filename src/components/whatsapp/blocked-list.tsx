"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Settings → WhatsApp → «المتبلّكين» (owners): who is blocked on the company number, to unblock. */
export function BlockedList({ businessId }: { businessId: string }) {
    const [list, setList] = useState<string[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const load = useCallback(async () => {
        const res = await fetch(`/api/whatsapp/block?business_id=${businessId}`).catch(() => null);
        const body = res ? await res.json().catch(() => ({})) : {};
        if (!res?.ok) { toast.error(body.error || "ماقدرتش أجيب القايمة."); setList([]); return; }
        setList(body.blocked || []);
    }, [businessId]);
    useEffect(() => {
        let gone = false;
        (async () => { if (!gone) await load(); })();
        return () => { gone = true; };
    }, [load]);
    const unblock = async (phone: string) => {
        setBusy(phone);
        const res = await fetch("/api/whatsapp/block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ business_id: businessId, phone, action: "unblock" }) });
        const body = await res.json().catch(() => ({}));
        setBusy(null);
        if (!res.ok) { toast.error(body.error || "ما اتفكش."); return; }
        toast.success("البلوك اتفك.");
        setList(prev => prev?.filter(p => p !== phone) ?? prev);
    };
    return (
        <section className="space-y-3 rounded-2xl border bg-card p-5">
            <div>
                <h2 className="text-lg font-bold">المتبلّكين</h2>
                <p className="text-sm text-muted-foreground">العملاء اللي اتعملهم بلوك على رقم الشركة: مش بيقدروا يبعتوا، ومش بيعرفوا إنهم متبلّكين. البلوك بيتعمل من الشات (⋮ ← بلوك).</p>
            </div>
            {list === null ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : list.length === 0
                ? <p className="text-sm text-muted-foreground">مفيش حد متبلّك.</p>
                : (
                    <ul className="divide-y">
                        {list.map(p => (
                            <li key={p} className="flex items-center justify-between gap-3 py-2.5">
                                <Link href={`/whatsapp?phone=${encodeURIComponent(p)}`} className="font-mono text-sm hover:underline" dir="ltr">{p}</Link>
                                <Button size="sm" variant="outline" disabled={busy === p} onClick={() => unblock(p)}>
                                    {busy === p && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}فك البلوك
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
        </section>
    );
}
