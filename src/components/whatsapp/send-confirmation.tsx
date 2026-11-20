"use client";

import { useEffect, useState } from "react";
import { CheckCheck, Loader2, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { arabicItemLabels, type NamedItem } from "@/lib/orders/arabic-names";
import { CONFIRM_TEMPLATE } from "@/lib/whatsapp/settings";

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
        const items = order.order_items || [];
        const labels = await arabicItemLabels(items).catch(() => undefined);
        const line = items.map((it, i) => `${labels?.[i] || it.variants?.products?.name || it.unmapped_name || "منتج"} (عدد ${it.quantity || 1})`).join("، ");
        const due = Math.max(0, (Number(order.total_amount) || 0) - (Number(order.paid_amount) || 0));
        const first = String(order.customer_info?.name || "").trim().split(/\s+/)[0] || "عميلنا";
        const res = await fetch("/api/whatsapp/send", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                business_id: businessId, phone: order.customer_info!.phone, order_id: order.id,
                template: { name: CONFIRM_TEMPLATE, language: "ar", params: [first, line, String(Math.round(due))] },
                preview: `رسالة التأكيد: ${line} · ${Math.round(due)} جنيه`,
            }),
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
            {sentAt ? "اتبعتت رسالة التأكيد · ابعت تاني" : "ابعت التأكيد من رقم الشركة"}
        </Button>
    );
}
