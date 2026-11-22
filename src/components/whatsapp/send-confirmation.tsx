"use client";

import { useEffect, useState } from "react";
import { CheckCheck, Loader2, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type NamedItem } from "@/lib/orders/arabic-names";

/**
 * «ابعت التأكيد من رقم الشركة»: the confirmation template, sent from the
 * business's WhatsApp number through the system, tied to the order so the
 * customer's «تأكيد» or «إلغاء الطلب» acts on it. Shown only when the business
 * has a number connected.
 */

let connected: Record<string, Promise<boolean>> = {};
function isConnected(businessId: string) {
    connected[businessId] ??= fetch(`/api/whatsapp/templates?business_id=${businessId}`)
        .then(r => r.json()).then(b => !!b.connected).catch(() => false);
    return connected[businessId];
}
/** Whether the business sends from a connected WhatsApp number (null while checking). */
export function useWhatsAppConnected(businessId: string | undefined): boolean | null {
    const [state, setState] = useState<{ id: string; ok: boolean } | null>(null);
    useEffect(() => {
        if (!businessId) return;
        let gone = false;
        isConnected(businessId).then(ok => { if (!gone) setState({ id: businessId, ok }); });
        return () => { gone = true; };
    }, [businessId]);
    return businessId && state?.id === businessId ? state.ok : null;
}

/** For tests and after connecting a number. */
export const forgetWhatsAppConnection = () => { connected = {}; };

export interface ConfirmableOrder {
    id: string;
    total_amount: number | null;
    paid_amount?: number | null;
    customer_info: { name?: string; phone?: string } | null;
    order_items?: (NamedItem & { quantity: number | null })[] | null;
}

export function SendConfirmationButton({ order, businessId, className }: { order: ConfirmableOrder; businessId: string; className?: string }) {
    const [ok, setOk] = useState(false);
    const [sending, setSending] = useState(false);
    const [sentAt, setSentAt] = useState<number | null>(null);
    useEffect(() => {
        let gone = false;
        isConnected(businessId).then(v => { if (!gone) setOk(v); });
        return () => { gone = true; };
    }, [businessId]);
    if (!ok || !order.customer_info?.phone) return null;

    const send = async () => {
        setSending(true);
        const res = await fetch("/api/whatsapp/send-order", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ business_id: businessId, order_id: order.id }),
        });
        const body = await res.json().catch(() => ({}));
        setSending(false);
        if (!res.ok) { toast.error(body.error || "الرسالة ما اتبعتتش."); return; }
        setSentAt(Date.now());
        toast.success("رسالة التأكيد اتبعتت من رقم الشركة. لو العميل رد «تأكيد» الأوردر هيتأكد لوحده.");
    };

    return (
        <Button type="button" onClick={send} disabled={sending}
            className={cn("h-12 w-full gap-2 bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700 sm:w-auto", className)}>
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : sentAt ? <CheckCheck className="h-5 w-5" /> : <MessageSquareText className="h-5 w-5" />}
            {sentAt ? "اتبعتت رسالة التأكيد" : "ابعت رسالة التأكيد"}
        </Button>
    );
}
