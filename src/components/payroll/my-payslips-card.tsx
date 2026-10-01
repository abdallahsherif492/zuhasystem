"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { monthLabel, type Payslip } from "@/lib/payroll";

/** The signed-in employee's own payslips. Shows nothing until one has been settled. */
export function MyPayslipsCard({ businessId }: { businessId: string }) {
    const [slips, setSlips] = useState<Payslip[]>([]);

    useEffect(() => {
        supabase.rpc("get_my_payslips", { p_business_id: businessId }).then(({ data, error }) => {
            if (!error) setSlips((data || []) as Payslip[]);
        });
    }, [businessId]);

    if (!slips.length) return null;
    return (
        <Card dir="rtl">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />قسايم المرتب</CardTitle>
                <CardDescription>كل شهر اتصرف، بتفاصيله: البونص والخصومات والسلف.</CardDescription>
            </CardHeader>
            <CardContent className="divide-y p-0">
                {slips.map(s => (
                    <Link key={s.id} href={`/my-hr/payslip?id=${s.id}`} className="flex items-center justify-between px-6 py-3 text-sm hover:bg-muted/40">
                        <span className="font-medium">{monthLabel(s.period, true)}</span>
                        <span className="flex items-center gap-3">
                            <span className="font-semibold">{formatCurrency(Number(s.net_pay))}</span>
                            <span className="text-xs text-primary">عرض</span>
                        </span>
                    </Link>
                ))}
            </CardContent>
        </Card>
    );
}
