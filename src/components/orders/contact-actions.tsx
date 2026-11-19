"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Phone, MessageCircle, Copy, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
    phoneNumbers, whatsappLink, telLink, confirmationMessage, type ConfirmationOrder,
} from "@/lib/orders/contact";
import { arabicItemLabels } from "@/lib/orders/arabic-names";

/**
 * Call and message buttons for one order.
 *
 * The message opens in a dialog before it is sent rather than going straight to
 * WhatsApp. A confirmation is the last thing a customer reads before the parcel
 * arrives, and a template that got the address wrong is worse than no message —
 * so it is shown, editable, and only then handed to WhatsApp.
 */
export function ContactActions({
    order, storeName, size = "sm", big = false, inverse = false, onContact,
}: {
    order: ConfirmationOrder;
    storeName: string;
    size?: "sm" | "default";
    /** Full-width, thumb-sized buttons for the confirmation queue. */
    big?: boolean;
    /** Inside the confirmation card's instruction: the call is the panel's main button. */
    inverse?: boolean;
    /** Called as a number is dialled or the WhatsApp composer opens. */
    onContact?: () => void;
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
    // Built on every render rather than on click, because the button is a real
    // link. window.open with a features string is treated as a popup and gets
    // blocked, which is silent: the dialog closes and no chat ever opens.
    const sendHref = target ? whatsappLink(target, text) : null;

    const [preparing, setPreparing] = useState(false);

    // The products' Arabic names may need translating first: the dialog opens
    // at once and the message appears when they are ready (a few seconds at
    // most; the English name is used if translating fails).
    async function openComposer() {
        onContact?.();
        setTarget(waNumber || null);
        setText("");
        setPreparing(true);
        setOpen(true);
        const labels = await arabicItemLabels(order.order_items || []).catch(() => undefined);
        setText(confirmationMessage(order, storeName, labels));
        setPreparing(false);
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
            <span className={cn("text-xs", inverse ? "text-indigo-700 dark:text-indigo-300" : "text-muted-foreground")}>مفيش رقم موبايل على الأوردر</span>
        );
    }

    return (
        <>
            <div className={big ? "grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" : "flex flex-wrap items-center gap-2"}>
                {numbers.map(n => (
                    <Button
                        key={n}
                        asChild
                        size={size}
                        variant="outline"
                        className={cn("gap-1.5 font-mono tabular-nums", big && "h-12 text-base sm:min-w-44 [&_svg]:size-5",
                            inverse && "border-0 bg-indigo-600 text-white shadow-none hover:bg-indigo-700 hover:text-white")}
                    >
                        {/* One button per number: a single tel: built from
                            "0882232065 / 01159244278" dials neither.

                            The label is wrapped rather than left as a bare text
                            node. Anything that rewrites the DOM — a translator,
                            an extension — re-parents loose text, and React then
                            cannot remove it when this card goes. An element it
                            created itself is one it can always find again. */}
                        <a href={telLink(n)} onClick={() => onContact?.()}>
                            <Phone className="h-3.5 w-3.5" />
                            <span>{n}</span>
                        </a>
                    </Button>
                ))}

                <Button
                    size={size}
                    variant="outline"
                    onClick={openComposer}
                    disabled={!waNumber}
                    title={waNumber ? undefined : "مفيش رقم موبايل مصري يقبل واتساب"}
                    className={cn("gap-1.5 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400",
                        big && "h-12 text-base sm:min-w-36 [&_svg]:size-5", big && numbers.length % 2 === 0 && "col-span-2",
                        inverse && "border-indigo-300 bg-white text-indigo-700 shadow-none hover:bg-indigo-50 hover:text-indigo-800 dark:border-indigo-700 dark:bg-transparent dark:text-indigo-200 dark:hover:bg-indigo-900/40")}
                >
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>{big ? "واتساب" : "رسالة تأكيد"}</span>
                </Button>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>رسالة التأكيد</DialogTitle>
                        <DialogDescription>
                            العميل بيرد عليها بـ «تأكيد». راجع المنتجات والمبلغ، وتقدر تعدّل أي حاجة قبل ما تبعت.
                        </DialogDescription>
                    </DialogHeader>

                    <Textarea
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder={preparing ? "بجهّز الرسالة وأسماء المنتجات بالعربي…" : ""}
                        disabled={preparing}
                        rows={11}
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
                            <span>نسخ</span>
                        </Button>
                        {sendHref && !preparing ? (
                            <Button asChild className="gap-1.5" onClick={() => setOpen(false)}>
                                {/* wa.me/<full international number> opens that
                                    contact's chat directly — creating it when the
                                    number is not saved — with the text waiting in
                                    the input. An anchor, so nothing can block it. */}
                                <a href={sendHref} target="_blank" rel="noopener noreferrer">
                                    <Send className="h-4 w-4" />
                                    <span>افتح المحادثة</span>
                                </a>
                            </Button>
                        ) : (
                            <Button disabled className="gap-1.5">
                                <Send className="h-4 w-4" />
                                <span>افتح المحادثة</span>
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
