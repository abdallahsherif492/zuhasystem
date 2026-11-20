"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * «ابعت للأوردرات اللي ماتبعتلهاش»: for orders from before the automatic
 * messages. Counts first, sends in small batches with progress, can be
 * stopped, and never sends an order the same message twice
 * (/api/whatsapp/bulk).
 */

type Kind = "confirm" | "shipping";
interface Counts { confirm: number; shipping: { hold: number; returning: number } }

/** Meta's daily cap for a number that is not verified: 250 customers. */
const DAILY_CAP = 250;

export function WhatsAppBulkSend({ businessId }: { businessId: string }) {
    const [days, setDays] = useState(3);
    const [counts, setCounts] = useState<Counts | null>(null);
    const [running, setRunning] = useState<Kind | null>(null);
    const [progress, setProgress] = useState<{ sent: number; failed: number; total: number } | null>(null);
    const stop = useRef(false);

    const load = useCallback(async () => {
        setCounts(null);
        const res = await fetch(`/api/whatsapp/bulk?business_id=${businessId}&days=${days}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { toast.error(body.error || "ماقدرتش أعد الأوردرات."); return; }
        setCounts(body);
    }, [businessId, days]);
    useEffect(() => {
        let gone = false;
        (async () => { if (!gone) await load(); })();
        return () => { gone = true; };
    }, [load]);

    const run = async (kind: Kind, total: number) => {
        const capped = Math.min(total, DAILY_CAP);
        if (!window.confirm(`هيتبعت ${capped} رسالة من رقم الشركة${total > capped ? ` (الباقي ${total - capped} بكرة، عشان حد Meta اليومي)` : ""}. كل رسالة قالب بتتحسب في فاتورة Meta (حوالي ٠٫٢ جنيه). نكمّل؟`)) return;
        stop.current = false;
        setRunning(kind);
        let sent = 0, failed = 0;
        const skip: string[] = [];
        setProgress({ sent, failed, total: capped });
        while (!stop.current && sent + failed < capped) {
            const res = await fetch("/api/whatsapp/bulk", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ business_id: businessId, kind, days, skip }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) { toast.error(body.error || "وقف الإرسال."); break; }
            sent += body.sent; failed += body.failed;
            skip.push(...(body.failedIds || []));
            setProgress({ sent, failed, total: capped });
            if (body.limitHit) { toast.error(body.errors?.[0] || "Meta وقفت الإرسال مؤقتاً."); break; }
            if (!body.remaining || (body.sent === 0 && body.failed === 0)) break;
        }
        setRunning(null);
        toast.success(`اتبعت ${sent} رسالة${failed ? `، و${failed} ما اتبعتش (غالباً الرقم غلط)` : ""}.`);
        load();
    };

    const hold = counts?.shipping.hold ?? 0, returning = counts?.shipping.returning ?? 0;
    return (
        <section className="space-y-4 rounded-2xl border bg-card p-5">
            <div>
                <h2 className="text-lg font-bold">ابعت للأوردرات اللي ماتبعتلهاش</h2>
                <p className="text-sm text-muted-foreground">للأوردرات اللي جت قبل الرسايل الأوتوماتيك. كل أوردر بتوصله الرسالة مرة واحدة بس، والإرسال بيقف لوحده لو Meta قالت كفاية النهارده.</p>
            </div>

            <div className="space-y-2 rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="font-semibold">رسالة التأكيد للأوردرات اللي لسه في الانتظار</p>
                        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                            من آخر
                            <select value={days} onChange={e => setDays(Number(e.target.value))} disabled={!!running}
                                className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">
                                {[1, 2, 3, 5, 7, 14].map(d => <option key={d} value={d}>{d === 1 ? "يوم" : d === 2 ? "يومين" : `${d} أيام`}</option>)}
                            </select>
                            : {counts ? <b className="text-foreground">{counts.confirm} أوردر</b> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        </p>
                    </div>
                    <Button onClick={() => run("confirm", counts?.confirm ?? 0)} disabled={!counts?.confirm || !!running} className="gap-2 bg-[#25d366] text-white hover:bg-[#1fb855]">
                        {running === "confirm" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 -scale-x-100" />}ابعت
                    </Button>
                </div>
            </div>

            <div className="space-y-2 rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="font-semibold">رسايل مشاكل الشحن</p>
                        <p className="text-sm text-muted-foreground">
                            {counts ? <><b className="text-foreground">{hold}</b> «المندوب ماقدرش يوصله» · <b className="text-foreground">{returning}</b> «الشحنة راجعة»</> : <Loader2 className="inline h-3.5 w-3.5 animate-spin" />}
                        </p>
                    </div>
                    <Button onClick={() => run("shipping", hold + returning)} disabled={!(hold + returning) || !!running} className="gap-2 bg-[#25d366] text-white hover:bg-[#1fb855]">
                        {running === "shipping" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 -scale-x-100" />}ابعت
                    </Button>
                </div>
            </div>

            {progress && (
                <div className="space-y-2">
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-[#25d366] transition-[width]" style={{ width: `${Math.round(((progress.sent + progress.failed) / Math.max(1, progress.total)) * 100)}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                        <span>اتبعت {progress.sent} من {progress.total}{progress.failed ? ` · ${progress.failed} ما اتبعتش` : ""}</span>
                        {running && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { stop.current = true; }}><Square className="h-3.5 w-3.5" />وقّف</Button>}
                    </div>
                </div>
            )}
        </section>
    );
}
