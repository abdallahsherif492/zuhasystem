"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last line of defence: a render error that escapes every other boundary.
 *
 * Next.js replaces the whole document here, so this cannot rely on the app's
 * providers, fonts or Tailwind layer — the styles are inline on purpose.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        Sentry.captureException(error);
    }, [error]);

    return (
        <html lang="ar" dir="rtl">
            <body
                style={{
                    margin: 0,
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#f8fafc",
                    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
                    padding: "24px",
                }}
            >
                <div
                    style={{
                        maxWidth: 460,
                        width: "100%",
                        background: "white",
                        borderRadius: 18,
                        padding: "32px 28px",
                        textAlign: "center",
                        boxShadow: "0 20px 45px rgba(15,23,42,0.10)",
                        border: "1px solid #e2e8f0",
                    }}
                >
                    <div style={{ fontSize: 44, lineHeight: 1, marginBottom: 16 }}>⚠️</div>
                    <h1 style={{ fontSize: 21, fontWeight: 800, color: "#0f172a", margin: "0 0 10px" }}>
                        حصل خطأ غير متوقع
                    </h1>
                    <p style={{ fontSize: 15, color: "#475569", lineHeight: 1.9, margin: "0 0 24px" }}>
                        وصلنا تقرير بالمشكلة وبنشتغل عليها. جرّب تحمّل الصفحة تاني.
                    </p>

                    <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                        <button
                            onClick={() => reset()}
                            style={{
                                background: "#6366f1",
                                color: "white",
                                border: "none",
                                borderRadius: 10,
                                padding: "11px 22px",
                                fontSize: 15,
                                fontWeight: 700,
                                cursor: "pointer",
                            }}
                        >
                            حاول تاني
                        </button>
                        <a
                            href="/dashboard"
                            style={{
                                background: "#f1f5f9",
                                color: "#0f172a",
                                borderRadius: 10,
                                padding: "11px 22px",
                                fontSize: 15,
                                fontWeight: 700,
                                textDecoration: "none",
                            }}
                        >
                            الرجوع للوحة التحكم
                        </a>
                    </div>

                    {/* The message as well as the digest. A digest exists only
                        for errors thrown while rendering on the server, so
                        printing it alone left this panel blank for every crash
                        that happened in the browser — which is most of them. */}
                    <pre
                        dir="ltr"
                        style={{
                            fontSize: 11, color: "#64748b", marginTop: 22,
                            fontFamily: "ui-monospace, monospace", textAlign: "left",
                            background: "#f8fafc", border: "1px solid #e2e8f0",
                            borderRadius: 8, padding: 10, whiteSpace: "pre-wrap",
                            wordBreak: "break-word", maxHeight: 160, overflow: "auto",
                        }}
                    >
                        {[error.message || "(no message)",
                          error.digest ? `digest: ${error.digest}` : null]
                            .filter(Boolean).join("\n")}
                    </pre>
                </div>
            </body>
        </html>
    );
}
