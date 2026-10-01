"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { PayslipDocument, type PayslipDocumentProps } from "@/components/payroll/payslip-document";
import { PayslipShell } from "@/components/payroll/payslip-shell";
import { applies, payTotals, payslipTotals, periodDate, type Adjustment, type Payslip } from "@/lib/payroll";

/** A manager's payslip for any member and month: the settled one, or a draft from this month's entries so far. */
function ManagerPayslip() {
    const params = useSearchParams();
    const member = params.get("member");
    const period = params.get("period") || "";
    const { activeBusiness } = useBusiness();
    const [doc, setDoc] = useState<Omit<PayslipDocumentProps, "business"> | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!activeBusiness || !member || !/^\d{4}-\d{2}$/.test(period)) return;
        (async () => {
            const b = activeBusiness.id;
            const [m, sal, slip, adj] = await Promise.all([
                supabase.from("business_users").select("user_email").eq("business_id", b).eq("id", member).maybeSingle(),
                supabase.from("employee_salaries").select("monthly_salary, employee_name, job_title").eq("business_user_id", member).maybeSingle(),
                supabase.from("payslips").select("*").eq("business_id", b).eq("business_user_id", member).eq("period", periodDate(period)).maybeSingle(),
                supabase.from("payroll_adjustments").select("kind, amount, reason, entry_date, apply_to_salary").eq("business_id", b).eq("business_user_id", member).eq("period", periodDate(period)).order("entry_date"),
            ]);
            if (!m.data) { setError("الموظف ده مش موجود."); return; }
            const p = slip.data as Payslip | null;
            if (p) {
                setDoc({
                    employee: { name: p.employee_name || p.user_email.split("@")[0], email: p.user_email, title: p.job_title },
                    period, totals: payslipTotals(p), items: p.items,
                    settled: { paid_on: p.paid_on, account_name: p.account_name }, notes: p.notes,
                });
            } else {
                // Entries switched off for this month are on record but not on the payslip.
                const items = ((adj.data || []) as Adjustment[]).filter(applies).map(a => ({ ...a, amount: Number(a.amount) }));
                setDoc({
                    employee: { name: sal.data?.employee_name || m.data.user_email.split("@")[0], email: m.data.user_email, title: sal.data?.job_title },
                    period, totals: payTotals(Number(sal.data?.monthly_salary || 0), items), items, settled: null,
                });
            }
        })().catch(e => { console.error(e); setError("مش قادر أحمّل القسيمة."); });
    }, [activeBusiness, member, period]);

    if (error) return <p className="p-8 text-center text-muted-foreground">{error}</p>;
    if (!doc || !activeBusiness) return <div className="flex h-60 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    return (
        <PayslipShell>
            <PayslipDocument business={{ name: activeBusiness.name, logo_url: activeBusiness.logo_url }} {...doc} />
        </PayslipShell>
    );
}

export default function Page() {
    return <Suspense><ManagerPayslip /></Suspense>;
}
