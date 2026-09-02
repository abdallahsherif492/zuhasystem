"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Phone, MessageCircle, Copy, Send } from "lucide-react";
import { toast } from "sonner";
import {
    phoneNumbers, whatsappLink, telLink, confirmationMessage, type ConfirmationOrder,
} from "@/lib/orders/contact";

/**
 * Call and message buttons for one order.
 *
 * The message opens in a dialog before it is sent rather than going straight to
 * WhatsApp. A confirmation is the last thing a customer reads before the parcel
 * arrives, and a template that got the address wrong is worse than no message —
 * so it is shown, editable, and only then handed to WhatsApp.
 */
export function ContactActions({
    order, storeName, size = "sm",
}: {
    order: ConfirmationOrder;
    storeName: string;
    size?: "sm" | "default";
}) {
    const info = order.customer_info || {};
    const numbers = [
        ...phoneNumbers(info.phone),
        ...phoneNumbers(info.phone2),
    ].filter((n, i, a) => a.indexOf(n) === i);

    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    const [target, setTarget] = useState<string | null>(null);

    // Whichever number can actually take a WhatsApp message; a landline cannot.
    const waNumber = numbers.find(n => whatsappLink(n));

    function openComposer() {
        setText(confirmationMessage(order, storeName));
        setTarget(waNumber || null);
        setOpen(true);
    }

    function send() {
        const link = target ? whatsappLink(target, text) : null;
        if (!link) return;
        window.open(link, "_blank", "noopener,noreferrer");
        setOpen(false);
    }

    async function copy() {
        try {
            await navigator.clipboard.writeText(text);
            toast.success("اتنسخت");
        } catch {
            toast.error("مش قادر أنسخ. اعمل تحديد ونسخ يدوي.");
        }
    }

    if (numbers.length === 0) {
        return (
            <span className="text-xs text-muted-foreground">مفيش رقم موبايل على الأوردر</span>
        );
    }

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                {numbers.map(n => (
                    <Button
                        key={n}
                        asChild
                        size={size}
                        variant="outline"
                        className="gap-1.5 font-mono tabular-nums"
                    >
                        {/* One button per number: a single tel: built from
                            "0882232065 / 01159244278" dials neither. */}
                        <a href={telLink(n)}>
                            <Phone className="h-3.5 w-3.5" />
                            {n}
                        </a>
                    </Button>
                ))}

                <Button
                    size={size}
                    variant="outline"
                    onClick={openComposer}
                    disabled={!waNumber}
                    title={waNumber ? undefined : "مفيش رقم موبايل مصري يقبل واتساب"}
                    className="gap-1.5 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                >
                    <MessageCircle className="h-3.5 w-3.5" />
                    رسالة تأكيد
                </Button>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>رسالة التأكيد</DialogTitle>
                        <DialogDescription>
                            راجعها قبل ما تبعتها — العميل بيقرا العنوان والمنتجات منها ويأكد.
                            تقدر تعدّل أي حاجة.
                        </DialogDescription>
                    </DialogHeader>

                    <Textarea
                        value={text}
                        onChange={e => setText(e.target.value)}
                        rows={14}
                        className="text-sm leading-6"
                        dir="rtl"
                    />

                    {numbers.filter(n => whatsappLink(n)).length > 1 && (
                        <div className="flex flex-wrap gap-2">
                            {numbers.filter(n => whatsappLink(n)).map(n => (
                                <Button
                                    key={n} size="sm"
                                    variant={target === n ? "default" : "outline"}
                                    className="font-mono tabular-nums"
                                    onClick={() => setTarget(n)}
                                >
                                    {n}
                                </Button>
                            ))}
                        </div>
                    )}

                    <DialogFooter className="gap-2 sm:gap-2">
                        <Button variant="outline" onClick={copy} className="gap-1.5">
                            <Copy className="h-4 w-4" />
                            نسخ
                        </Button>
                        <Button onClick={send} disabled={!target} className="gap-1.5">
                            <Send className="h-4 w-4" />
                            افتح واتساب
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
