"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { normalizeEgyptianMobile } from "@/lib/support";

interface Signup {
    user_id: string;
    user_email: string;
    full_name: string | null;
    phone: string | null;
    signed_up_at: string;
    email_confirmed: boolean;
    last_sign_in_at: string | null;
    business_id: string | null;
    business_name: string | null;
    product_count: number;
    order_count: number;
    courier_count: number;
    platform_connected: boolean;
}

/** How far a signup got, as the one next thing to help them with. */
function stageOf(s: Signup): { label: string; tone: string; rank: number } {
    if (!s.email_confirmed) return { label: "ماأكدش الإيميل", tone: "bg-red-100 text-red-800", rank: 0 };
    if (!s.business_id) return { label: "ماعملش متجر", tone: "bg-red-100 text-red-800", rank: 1 };
    if (!s.platform_connected && !s.product_count) return { label: "متجر فاضي", tone: "bg-amber-100 text-amber-900", rank: 2 };
    if (!s.order_count) return { label: "مفيش أوردرات لسه", tone: "bg-amber-100 text-amber-900", rank: 3 };
    return { label: "شغال", tone: "bg-emerald-100 text-emerald-800", rank: 4 };
}

function welcomeMessage(s: Signup): string {
    const name = (s.full_name || "").trim().split(/\s+/)[0];
    const store = s.business_name ? ` لمتجر "${s.business_name}"` : "";
    return [
        `أهلاً${name ? ` ${name}` : ""} 👋`,
        `معاك فريق eCommerx. شفنا إنك عملت حساب${store}.`,
        "تحب نجهّزلك السيستم ببلاش؟ نربط متجرك على EasyOrders ونضيف منتجاتك وشركة الشحن في مكالمة 10 دقايق.",
    ].join("\n");
}

/**
 * Everyone who signed up recently, newest first, with how far setup went and a
 * one-tap WhatsApp to them. Signups used to be invisible here: the list lived
 * in auth, and none of the merchants who stalled was ever contacted.
 */
export default function NewSignupsPage() {
    const [rows, setRows] = useState<Signup[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [days, setDays] = useState(30);
    const [loading, setLoading] = useState(false);

    async function load() {
        setLoading(true);
        setError(null);
        const { data, error } = await supabase.rpc("admin_new_signups", { p_days: days });
        if (error) {
            setError(error.message.includes("Could not find the function")
                ? "شغّل مايجريشن 20260923_admin_new_signups.sql الأول."
                : error.message);
            setRows([]);
        } else {
            setRows((data as Signup[]) || []);
        }
        setLoading(false);
    }

    useEffect(() => { load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

    const funnel = useMemo(() => {
        const r = rows || [];
        return [
            { label: "سجّلوا", n: r.length },
            { label: "أكدوا الإيميل", n: r.filter(s => s.email_confirmed).length },
            { label: "عملوا متجر", n: r.filter(s => s.business_id).length },
            { label: "ضافوا منتج أو ربطوا", n: r.filter(s => s.product_count || s.platform_connected).length },
            { label: "عندهم أوردرات", n: r.filter(s => s.order_count).length },
        ];
    }, [rows]);

    return (
        <div className="space-y-6" dir="rtl">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold">التسجيلات الجديدة</h1>
                    <p className="text-sm text-muted-foreground">كلّم كل واحد في نفس اليوم — ده أكتر حاجة بتفرق في إنه يكمّل.</p>
                </div>
                <div className="flex gap-2">
                    {[7, 30, 90].map(d => (
                        <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
                            آخر {d} يوم
                        </Button>
                    ))}
                    <Button size="sm" variant="outline" onClick={load} disabled={loading}>
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {funnel.map(f => (
                    <Card key={f.label}>
                        <CardContent className="p-4">
                            <p className="text-xs text-muted-foreground">{f.label}</p>
                            <p className="text-2xl font-bold tabular-nums">{f.n}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {error && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            {rows === null && <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>}

            <div className="grid gap-3">
                {(rows || []).map(s => {
                    const stage = stageOf(s);
                    const mobile = s.phone ? normalizeEgyptianMobile(s.phone) : null;
                    const wa = mobile ? `https://wa.me/2${mobile}?text=${encodeURIComponent(welcomeMessage(s))}` : null;
                    return (
                        <Card key={s.user_id}>
                            <CardHeader className="pb-2">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <CardTitle className="text-base">{s.full_name || s.user_email}</CardTitle>
                                        <CardDescription className="break-all">
                                            {s.user_email}{s.phone ? ` · ${s.phone}` : " · مفيش رقم"}
                                        </CardDescription>
                                    </div>
                                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", stage.tone)}>{stage.label}</span>
                                </div>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex flex-wrap gap-1.5 text-xs">
                                    <Badge variant="outline">سجّل {format(new Date(s.signed_up_at), "dd/MM HH:mm")}</Badge>
                                    {s.last_sign_in_at && <Badge variant="outline">آخر دخول {format(new Date(s.last_sign_in_at), "dd/MM")}</Badge>}
                                    {s.business_name && <Badge variant="secondary">{s.business_name}</Badge>}
                                    <Badge variant="outline">{s.product_count} منتج</Badge>
                                    <Badge variant="outline">{s.courier_count} شركة شحن</Badge>
                                    <Badge variant="outline">{s.order_count} أوردر</Badge>
                                    {s.platform_connected && <Badge className="bg-emerald-600">مربوط بمنصة</Badge>}
                                </div>
                                {wa ? (
                                    <Button asChild className="min-h-11 shrink-0 bg-[#1DA851] hover:bg-[#178A43]">
                                        <a href={wa} target="_blank" rel="noopener noreferrer">كلّمه واتساب</a>
                                    </Button>
                                ) : (
                                    <span className="text-xs text-muted-foreground">سجّل قبل ما الرقم يبقى إجباري</span>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
                {rows && !rows.length && !error && <p className="text-sm text-muted-foreground">مفيش تسجيلات في الفترة دي.</p>}
            </div>
        </div>
    );
}
