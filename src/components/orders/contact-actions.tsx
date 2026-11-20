"use client";

import { Button } from "@/components/ui/button";
import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { phoneNumbers, telLink, type ConfirmationOrder } from "@/lib/orders/contact";

/**
 * Call buttons for one order, one per number on it. The WhatsApp
 * confirmation goes out from the company number on its own
 * (lib/whatsapp/outbox.ts), so there is no message to send from here.
 */
export function ContactActions({
    order, size = "sm", big = false, inverse = false, onContact,
}: {
    order: ConfirmationOrder;
    /** Kept for callers; the message now goes from the company number. */
    storeName?: string;
    size?: "sm" | "default";
    /** Full-width, thumb-sized buttons for the confirmation queue. */
    big?: boolean;
    /** Inside the confirmation card's instruction: the call is the panel's main button. */
    inverse?: boolean;
    /** Called as a number is dialled. */
    onContact?: () => void;
}) {
    const info = order.customer_info || {};
    const numbers = [
        ...phoneNumbers(info.phone),
        ...phoneNumbers(info.phone2),
    ].filter((n, i, a) => a.indexOf(n) === i);

    if (numbers.length === 0) {
        return (
            <span className={cn("text-xs", inverse ? "text-indigo-700 dark:text-indigo-300" : "text-muted-foreground")}>مفيش رقم موبايل على الأوردر</span>
        );
    }

    return (
        <div className={big ? "grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" : "flex flex-wrap items-center gap-2"}>
            {numbers.map((n, i) => (
                <Button
                    key={n}
                    asChild
                    size={size}
                    variant="outline"
                    className={cn("gap-1.5 font-mono tabular-nums", big && "h-12 text-base sm:min-w-44 [&_svg]:size-5",
                        big && numbers.length % 2 === 1 && i === numbers.length - 1 && "col-span-2",
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
        </div>
    );
}
