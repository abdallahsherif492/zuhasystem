"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Copy, RotateCw } from "lucide-react";

/**
 * A crash inside the dashboard, caught before it reaches the root.
 *
 * Without this file any render error in a page blows past to global-error,
 * which replaces the entire document — the sidebar, the header and every
 * provider disappear and the only way back is a full reload. Here the shell
 * survives and the failure is confined to the page that caused it.
 *
 * It also shows the message. The previous screen printed only error.digest,
 * and a digest exists only for errors thrown while rendering on the server; a
 * crash in the browser has none, so the panel was blank exactly when there was
 * something to say. Whoever hits this can now copy the text and send it on,
 * which is the difference between a report of "it broke" and a fix.
 */
export default function DashboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        Sentry.captureException(error);
        console.error("Dashboard error boundary:", error);
    }, [error]);

    const detail = [
        error.message || "(no message)",
        error.digest ? `digest: ${error.digest}` : null,
        error.stack?.split("\n").slice(0, 6).join("\n"),
    ].filter(Boolean).join("\n");

    async function copy() {
        try {
            await navigator.clipboard.writeText(detail);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            /* Clipboard can be blocked; the text is on screen to select. */
        }
    }

    return (
        <div className="flex items-center justify-center py-16 px-4">
            <div className="w-full max-w-xl rounded-2xl border bg-card p-6 sm:p-8 text-center space-y-5">
                <div className="flex justify-center">
                    <div className="rounded-full bg-amber-500/10 p-3">
                        <AlertTriangle className="h-7 w-7 text-amber-600" />
                    </div>
                </div>

                <div className="space-y-2">
                    <h1 className="text-xl font-bold">حصل خطأ في الصفحة دي</h1>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        باقي السيستم شغال عادي. جرّب تاني، ولو اتكرر ابعت النص اللي تحت.
                    </p>
                </div>

                {/* Shown, not hidden: the person in front of the screen is the
                    only one who can say what they were doing when it happened. */}
                <pre
                    dir="ltr"
                    className="text-start text-[11px] leading-5 bg-muted/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto"
                >
                    {detail}
                </pre>

                <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => reset()} className="gap-1.5">
                        <RotateCw className="h-4 w-4" />
                        حاول تاني
                    </Button>
                    <Button variant="outline" onClick={copy} className="gap-1.5">
                        <Copy className="h-4 w-4" />
                        {copied ? "اتنسخ" : "انسخ تفاصيل الخطأ"}
                    </Button>
                    <Button variant="ghost" asChild>
                        <a href="/dashboard">الرجوع للوحة التحكم</a>
                    </Button>
                </div>
            </div>
        </div>
    );
}
