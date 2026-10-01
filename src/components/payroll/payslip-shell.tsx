"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Page around a payslip: a print button on screen, and on paper nothing but
 * the payslip (the sidebar, header and widgets of the dashboard are hidden by
 * the [data-print-root] rule in globals.css).
 */
export function PayslipShell({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
    return (
        <div className="space-y-4">
            <div className="flex justify-center gap-2 print:hidden">
                {onBack && <Button variant="outline" onClick={onBack}>رجوع</Button>}
                <Button onClick={() => window.print()}><Printer className="me-2 h-4 w-4" />طباعة / حفظ PDF</Button>
            </div>
            <div data-print-root className="overflow-x-auto rounded-lg border bg-white shadow-sm print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
                {children}
            </div>
        </div>
    );
}
