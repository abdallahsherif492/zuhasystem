"use client";

import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { supportMessages, supportWhatsappLink, SUPPORT_WHATSAPP } from "@/lib/support";

const WhatsappGlyph = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.86 9.86 0 0 0 4.73 1.2h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.83 9.83 0 0 0 12.04 2Zm5.8 14.13c-.25.69-1.44 1.32-1.99 1.37-.51.05-1.15.07-1.85-.12-.43-.13-.98-.31-1.68-.61-2.95-1.27-4.88-4.24-5.03-4.44-.15-.2-1.2-1.6-1.2-3.05 0-1.45.76-2.16 1.03-2.46.27-.3.59-.37.79-.37h.57c.18 0 .43-.07.67.51.25.59.84 2.04.91 2.19.07.15.12.32.02.52-.1.2-.15.32-.3.49-.15.17-.31.39-.45.52-.15.15-.3.31-.13.61.17.3.77 1.27 1.65 2.06 1.13 1.01 2.09 1.32 2.39 1.47.3.15.47.12.64-.07.17-.2.74-.86.94-1.16.2-.3.39-.25.66-.15.27.1 1.72.81 2.01.96.3.15.49.22.57.34.07.12.07.71-.18 1.4Z" />
    </svg>
);

/** A button that opens WhatsApp to us with the message already typed. */
export function WhatsappHelpButton({
    message, label = "كلّمنا واتساب", className, variant = "solid",
}: {
    message: string;
    label?: string;
    className?: string;
    variant?: "solid" | "outline";
}) {
    return (
        <a
            href={supportWhatsappLink(message)}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
                "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors",
                variant === "solid"
                    ? "bg-[#1DA851] text-white hover:bg-[#178A43]"
                    : "border border-[#1DA851]/50 text-[#157A3B] hover:bg-[#1DA851]/10 dark:text-emerald-400",
                className,
            )}
        >
            <WhatsappGlyph className="h-5 w-5 shrink-0" />
            <span>{label}</span>
        </a>
    );
}

/**
 * The same, pinned to the bottom-left corner of every screen for merchants who
 * are still setting up. Bottom-left because the support chat already owns the
 * bottom-right, and on a phone two buttons stacked in one corner get mis-tapped.
 */
export function WhatsappHelpFloating({ message }: { message: string }) {
    return (
        <a
            href={supportWhatsappLink(message)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`واتساب ${SUPPORT_WHATSAPP}`}
            className="fixed bottom-6 left-6 z-50 inline-flex h-14 items-center gap-2 rounded-full bg-[#1DA851] px-5 text-sm font-bold text-white shadow-xl shadow-emerald-900/20 transition-transform hover:scale-105 print:hidden"
        >
            <WhatsappGlyph className="h-6 w-6" />
            <span className="hidden sm:inline">محتاج مساعدة؟</span>
        </a>
    );
}

/** A short card: we will set it up for you, just message us. */
export function SetupForYouCard({ storeName, className }: { storeName?: string | null; className?: string }) {
    return (
        <div
            dir="rtl"
            className={cn(
                "flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 sm:flex-row sm:items-center sm:justify-between dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100",
                className,
            )}
        >
            <div className="flex items-start gap-3">
                <MessageCircle className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
                <div>
                    <p className="font-bold">مش فاضي تجهّز السيستم؟ إحنا نجهّزهولك ببلاش</p>
                    <p className="text-sm opacity-80">
                        ابعتلنا على واتساب وهنربط متجرك ونضيف منتجاتك وشركة الشحن معاك في دقايق.
                    </p>
                </div>
            </div>
            <WhatsappHelpButton message={supportMessages.setup(storeName)} label="جهّزوهولي" className="shrink-0" />
        </div>
    );
}

