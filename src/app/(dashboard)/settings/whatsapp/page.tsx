"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "@/contexts/BusinessContext";
import { Button } from "@/components/ui/button";
import { WHATSAPP_MIGRATION } from "@/lib/whatsapp/config";

/**
 * Settings → WhatsApp: connect the business's WhatsApp number to the system.
 * The number is on the WhatsApp Cloud API (moved off the phone and added in
 * WhatsApp Manager on XZino_Store); the server finds it from the permanent
 * token in Netlify, subscribes to its messages and keeps it
 * (/api/whatsapp/connect). Keeping the number on the phone too (Embedded
 * Signup, coexistence) is only open to Meta's verified partners.
 */

interface Account {
    waba_id: string; phone_number_id: string; display_phone: string | null; verified_name: string | null;
    mode: string; token_expires_at: string | null; connected_by: string | null; connected_at: string;
}

export default function WhatsAppSettingsPage() {
    const { activeBusiness, userRole } = useBusiness();
    const businessId = activeBusiness?.id;
    const [accounts, setAccounts] = useState<Account[] | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [reload, setReload] = useState(0);
    const load = useCallback(() => setReload(n => n + 1), []);
    const manager = ["owner", "admin", "super admin", "super_admin"].includes(String(userRole || "").toLowerCase());

    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        (async () => {
            const res = await fetch(`/api/whatsapp/connect?business_id=${businessId}`);
            const body = await res.json().catch(() => ({}));
            if (gone) return;
            if (!res.ok) { setProblem(body.error === "migration" ? `شغّل ملف ${WHATSAPP_MIGRATION} في Supabase الأول.` : body.error || "مش قادر أقرا حالة الواتساب."); setAccounts([]); return; }
            setProblem(!body.secretSet ? "WHATSAPP_APP_SECRET مش متحط في Netlify لسه." : !body.tokenSet ? "WHATSAPP_TOKEN مش متحط في Netlify لسه." : null);
            setAccounts(body.accounts);
        })();
        return () => { gone = true; };
    }, [businessId, reload]);

    const connect = async () => {
        if (!businessId) return;
        setConnecting(true);
        const res = await fetch("/api/whatsapp/connect", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ business_id: businessId, mode: "token" }),
        });
        const body = await res.json().catch(() => ({}));
        setConnecting(false);
        if (!res.ok) { toast.error(body.error || "الربط ما كملش."); return; }
        toast.success(`اتربط ${body.display_phone || "الرقم"} بالسيستم.`);
        load();
    };

    return (
        <div dir="rtl" className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
            <div className="space-y-1">
                <h1 className="flex items-center gap-2 text-2xl font-bold"><MessageCircle className="h-6 w-6 text-emerald-600" />واتساب السيستم</h1>
                <p className="text-muted-foreground">اربط رقم واتساب البيزنس بالسيستم عشان رسايل التأكيد والشحن تتبعت منه، والمودريتورز يردوا على العملاء من هنا.</p>
            </div>

            {problem && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{problem}</p>}

            {accounts === null ? (
                <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : accounts.length > 0 ? (
                <section className="space-y-3 rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-900 dark:bg-emerald-950/30">
                    {accounts.map(a => (
                        <div key={a.phone_number_id} className="space-y-1">
                            <p className="flex items-center gap-2 text-lg font-bold"><CheckCircle2 className="h-5 w-5 text-emerald-600" />{a.display_phone || a.phone_number_id} متربط</p>
                            <p className="text-sm text-muted-foreground">{a.verified_name || ""}</p>
                        </div>
                    ))}
                </section>
            ) : (
                <section className="space-y-4 rounded-2xl border bg-card p-5">
                    <h2 className="text-lg font-bold">قبل ما تربط</h2>
                    <ol className="list-decimal space-y-2 ps-5 text-[15px] leading-relaxed">
                        <li>الرقم يكون اتشال من تطبيق الواتساب على الموبايل، واتضاف في WhatsApp Manager على بيزنس XZino_Store.</li>
                        <li>التوكن الدائم متحط في Netlify باسم <span dir="ltr" className="font-mono">WHATSAPP_TOKEN</span>، والـ App Secret باسم <span dir="ltr" className="font-mono">WHATSAPP_APP_SECRET</span>.</li>
                    </ol>
                    <p className="text-sm text-muted-foreground">السيستم هيلاقي الرقم من التوكن ويربطه، ورسايل العملاء تبدأ توصل هنا.</p>
                    <Button onClick={connect} disabled={!manager || connecting} className="h-12 w-full gap-2 bg-emerald-600 text-base font-bold text-white hover:bg-emerald-700 sm:w-auto sm:px-8">
                        {connecting ? <Loader2 className="h-5 w-5 animate-spin" /> : <MessageCircle className="h-5 w-5" />}
                        اربط رقم الواتساب
                    </Button>
                    {!manager && <p className="text-sm text-destructive">الأونر أو الأدمن بس اللي يقدر يربط الرقم.</p>}
                </section>
            )}
        </div>
    );
}
