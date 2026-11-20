"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { CheckCircle2, Loader2, MessageCircle, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "@/contexts/BusinessContext";
import { Button } from "@/components/ui/button";
import { GRAPH_VERSION, WHATSAPP_APP_ID, WHATSAPP_CONFIG_ID, WHATSAPP_MIGRATION } from "@/lib/whatsapp/config";

/**
 * Settings → WhatsApp: connect the business's WhatsApp number to the system
 * with Meta's Embedded Signup, keeping it on the WhatsApp Business app on the
 * phone as well (coexistence). The popup is Meta's; the phone confirms with a
 * QR code from the app. The server finishes the connection (/api/whatsapp/connect).
 */

interface Account {
    waba_id: string; phone_number_id: string; display_phone: string | null; verified_name: string | null;
    mode: string; token_expires_at: string | null; connected_by: string | null; connected_at: string;
}

declare global {
    interface Window {
        FB?: {
            init: (o: Record<string, unknown>) => void;
            login: (cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void, o: Record<string, unknown>) => void;
        };
        fbAsyncInit?: () => void;
    }
}

export default function WhatsAppSettingsPage() {
    const { activeBusiness, userRole } = useBusiness();
    const businessId = activeBusiness?.id;
    const [accounts, setAccounts] = useState<Account[] | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [sdkReady, setSdkReady] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const session = useRef<{ waba_id?: string; phone_number_id?: string; code?: string }>({});
    const manager = ["owner", "admin", "super admin", "super_admin"].includes(String(userRole || "").toLowerCase());

    const [reload, setReload] = useState(0);
    const load = useCallback(() => setReload(n => n + 1), []);
    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        (async () => {
            const res = await fetch(`/api/whatsapp/connect?business_id=${businessId}`);
            const body = await res.json().catch(() => ({}));
            if (gone) return;
            if (!res.ok) { setProblem(body.error === "migration" ? `شغّل ملف ${WHATSAPP_MIGRATION} في Supabase الأول.` : body.error || "مش قادر أقرا حالة الواتساب."); setAccounts([]); return; }
            setProblem(body.secretSet ? null : "WHATSAPP_APP_SECRET مش متحط في Netlify لسه.");
            setAccounts(body.accounts);
        })();
        return () => { gone = true; };
    }, [businessId, reload]);

    // Facebook's SDK, set up once it has loaded (and again on a later visit).
    const sdkLoaded = () => {
        window.FB?.init({ appId: WHATSAPP_APP_ID, autoLogAppEvents: true, xfbml: true, version: GRAPH_VERSION });
        setSdkReady(!!window.FB);
    };

    const finish = useCallback(async () => {
        const s = session.current;
        if (!s.code || !businessId) return;
        const res = await fetch("/api/whatsapp/connect", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ business_id: businessId, code: s.code, waba_id: s.waba_id, phone_number_id: s.phone_number_id }),
        });
        const body = await res.json().catch(() => ({}));
        session.current = {};
        setConnecting(false);
        if (!res.ok) { toast.error(body.error || "الربط ما كملش."); return; }
        toast.success(`اتربط ${body.display_phone || "الرقم"} بالسيستم.`);
        load();
    }, [businessId, load]);

    // Meta tells the page which account and number were chosen.
    useEffect(() => {
        const onMessage = (ev: MessageEvent) => {
            if (!/facebook\.com$/.test(new URL(ev.origin).hostname)) return;
            try {
                const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
                if (d?.type !== "WA_EMBEDDED_SIGNUP") return;
                if (String(d.event || "").startsWith("FINISH")) {
                    session.current.waba_id = d.data?.waba_id;
                    session.current.phone_number_id = d.data?.phone_number_id;
                } else if (d.event === "CANCEL") {
                    toast.info(d.data?.current_step ? `الربط اتلغى عند خطوة: ${d.data.current_step}` : "الربط اتلغى.");
                } else if (d.event === "ERROR") {
                    toast.error(d.data?.error_message || "Meta رجعت خطأ.");
                }
            } catch { /* not ours */ }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);

    const connect = () => {
        if (!window.FB) { toast.error("صفحة فيسبوك لسه بتحمّل، جرّب كمان ثانية."); return; }
        setConnecting(true);
        session.current = {};
        window.FB.login(response => {
            const code = response.authResponse?.code;
            if (!code) { setConnecting(false); return; }
            session.current.code = code;
            // The message with the account and number can land just after.
            setTimeout(() => { finish(); }, 1500);
        }, {
            config_id: WHATSAPP_CONFIG_ID,
            response_type: "code",
            override_default_response_type: true,
            extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
        });
    };

    const connected = accounts && accounts.length > 0;

    return (
        <div dir="rtl" className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
            <Script src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive" crossOrigin="anonymous" onReady={sdkLoaded} />
            <div className="space-y-1">
                <h1 className="flex items-center gap-2 text-2xl font-bold"><MessageCircle className="h-6 w-6 text-emerald-600" />واتساب السيستم</h1>
                <p className="text-muted-foreground">اربط رقم واتساب البيزنس بالسيستم عشان رسايل التأكيد والشحن تتبعت منه، والمودريتورز يردوا على العملاء من هنا.</p>
            </div>

            {problem && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{problem}</p>}

            {accounts === null ? (
                <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : connected ? (
                <section className="space-y-3 rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-900 dark:bg-emerald-950/30">
                    {accounts!.map(a => (
                        <div key={a.phone_number_id} className="space-y-1">
                            <p className="flex items-center gap-2 text-lg font-bold"><CheckCircle2 className="h-5 w-5 text-emerald-600" />{a.display_phone || a.phone_number_id} متربط</p>
                            <p className="text-sm text-muted-foreground">
                                {a.verified_name ? `${a.verified_name} · ` : ""}{a.mode === "coexistence" ? "شغال على تطبيق الموبايل والسيستم مع بعض" : "شغال على السيستم"}
                                {a.token_expires_at ? ` · الربط محتاج يتجدد قبل ${new Date(a.token_expires_at).toLocaleDateString("ar-EG")}` : ""}
                            </p>
                        </div>
                    ))}
                </section>
            ) : (
                <section className="space-y-4 rounded-2xl border bg-card p-5">
                    <h2 className="text-lg font-bold">إزاي الربط بيتم</h2>
                    <ol className="list-decimal space-y-2 ps-5 text-[15px] leading-relaxed">
                        <li>دوس «اربط رقم الواتساب»، هتفتح نافذة من فيسبوك.</li>
                        <li>اختار البيزنس <b>XZino_Store</b>.</li>
                        <li>لما يسألك عن الرقم، اختار إنك توصل رقم <b>WhatsApp Business app</b> موجود، واكتب الرقم.</li>
                        <li className="flex items-start gap-1.5"><span>افتح تطبيق WhatsApp Business على الموبايل، وامسح الـ QR اللي هيظهر، ووافق على مشاركة المحادثات.</span><Smartphone className="mt-1 h-4 w-4 shrink-0" /></li>
                    </ol>
                    <p className="text-sm text-muted-foreground">الرقم هيفضل شغال على الموبايل زي ما هو. لو Meta ما سمحتش بالطريقة دي من غير توثيق، هتقولك في النافذة، ومفيش حاجة هتتغير في الرقم.</p>
                    <Button onClick={connect} disabled={!manager || connecting || !sdkReady} className="h-12 w-full gap-2 bg-emerald-600 text-base font-bold text-white hover:bg-emerald-700 sm:w-auto sm:px-8">
                        {connecting || !sdkReady ? <Loader2 className="h-5 w-5 animate-spin" /> : <MessageCircle className="h-5 w-5" />}
                        اربط رقم الواتساب
                    </Button>
                    {!manager && <p className="text-sm text-destructive">الأونر أو الأدمن بس اللي يقدر يربط الرقم.</p>}
                </section>
            )}
        </div>
    );
}
