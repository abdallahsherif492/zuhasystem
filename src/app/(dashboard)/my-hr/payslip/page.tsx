"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { PayslipDocument } from "@/components/payroll/payslip-document";
import { PayslipShell } from "@/components/payroll/payslip-shell";
import { payslipTotals, type Payslip } from "@/lib/payroll";

/** An employee's own settled payslip, read through get_my_payslips(): staff cannot read the payslips table. */
function MyPayslip() {
    const id = useSearchParams().get("id");
    const router = useRouter();
    const { activeBusiness } = useBusiness();
    const [slip, setSlip] = useState<Payslip | null | undefined>(undefined);

    useEffect(() => {
        if (!activeBusiness || !id) return;
        supabase.rpc("get_my_payslips", { p_business_id: activeBusiness.id }).then(({ data }) => {
            setSlip(((data || []) as Payslip[]).find(p => p.id === id) ?? null);
        });
    }, [activeBusiness, id]);

    if (slip === null) return <p className="p-8 text-center text-muted-foreground">القسيمة دي مش موجودة.</p>;
    if (!slip || !activeBusiness) return <div className="flex h-60 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    return (
        <PayslipShell onBack={() => router.push("/my-hr")}>
            <PayslipDocument
                business={{ name: activeBusiness.name, logo_url: activeBusiness.logo_url }}
                employee={{ name: slip.employee_name || slip.user_email.split("@")[0], email: slip.user_email, title: slip.job_title }}
                period={slip.period}
                totals={payslipTotals(slip)}
                items={slip.items}
                settled={{ paid_on: slip.paid_on, account_name: slip.account_name }}
                notes={slip.notes}
            />
        </PayslipShell>
    );
}

export default function Page() {
    return <Suspense><MyPayslip /></Suspense>;
}
