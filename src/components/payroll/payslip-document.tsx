"use client";

import Image from "next/image";
import { Cairo } from "next/font/google";
import { kindInfo, monthLabel, type Adjustment, type PayTotals } from "@/lib/payroll";

const font = Cairo({ subsets: ["arabic", "latin"], weight: ["400", "600", "700", "800"], display: "swap" });

const egp = (v: number) => `${v.toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ج.م`;
const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export interface PayslipDocumentProps {
    business: { name?: string | null; logo_url?: string | null };
    employee: { name: string; email: string; title?: string | null };
    period: string;          // "2026-09" or "2026-09-01"
    totals: PayTotals;
    items: Adjustment[];
    /** Settled: when and from which account it was paid. A draft prints with a "draft" stamp. */
    settled: { paid_on: string; account_name: string | null } | null;
    notes?: string | null;
}

/**
 * One A4 payslip, Arabic, black on white so it survives any printer. Earnings
 * on one side, what came off on the other, the net in a box, and two
 * signature lines — the copy the employee signs and the business keeps.
 */
export function PayslipDocument({ business, employee, period, totals, items, settled, notes }: PayslipDocumentProps) {
    // "سلفة — سلفة" says nothing twice: the reason only when it adds something.
    const label = (i: Adjustment) => {
        const k = kindInfo(i.kind).ar;
        const r = i.reason?.trim();
        return r && r !== k && !k.startsWith(r) ? `${k} — ${r}` : k;
    };
    const earnings = [
        { label: "المرتب الأساسي", amount: totals.base, date: null as string | null },
        ...items.filter(i => i.kind === "bonus").map(i => ({ label: label(i), amount: Number(i.amount), date: i.entry_date })),
    ];
    const takeoffs = items
        .filter(i => i.kind !== "bonus")
        .map(i => ({ label: label(i), amount: Number(i.amount), date: i.entry_date }));
    const negative = totals.net < 0;

    return (
        <div dir="rtl" className={`${font.className} relative mx-auto w-full max-w-[800px] bg-white p-8 text-[13px] text-black print:max-w-none print:p-6`}>
            {!settled && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
                    <span className="-rotate-[25deg] select-none text-[110px] font-extrabold text-black/[0.06]">مسودة</span>
                </div>
            )}

            {/* Header */}
            <div className="flex items-start justify-between border-b-2 border-black pb-4">
                <div className="flex items-center gap-3">
                    {business.logo_url && (
                        <div className="relative h-14 w-14 grayscale">
                            <Image src={business.logo_url} alt="" fill sizes="56px" className="object-contain" />
                        </div>
                    )}
                    <div>
                        <div className="text-xl font-extrabold">{business.name}</div>
                        <div className="text-xs">قسيمة مرتب · Payslip</div>
                    </div>
                </div>
                <div className="text-left">
                    <div className="text-lg font-bold">{monthLabel(period, true)}</div>
                    <div className="text-xs">{settled ? `اتصرف ${shortDate(settled.paid_on)}` : "لم يُصرف بعد"}</div>
                </div>
            </div>

            {/* Employee */}
            <div className="mt-4 grid grid-cols-2 gap-4 rounded-md border border-black/40 p-3">
                <div>
                    <div className="text-[11px] font-semibold">الموظف</div>
                    <div className="text-base font-bold">{employee.name}</div>
                    {employee.title && <div className="text-xs">{employee.title}</div>}
                </div>
                <div>
                    <div className="text-[11px] font-semibold">البريد</div>
                    <div className="font-mono text-xs" dir="ltr">{employee.email}</div>
                    {settled?.account_name && <><div className="mt-1 text-[11px] font-semibold">اتصرف من</div><div className="text-xs">{settled.account_name}</div></>}
                </div>
            </div>

            {/* Lines */}
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2">
                <Column title="المستحقات" rows={earnings} total={totals.base + totals.bonuses} />
                <Column title="الخصومات والسلف" rows={takeoffs} total={totals.deductions + totals.advances} empty="لا يوجد" />
            </div>

            {/* Net */}
            <div className="mt-5 flex items-center justify-between rounded-md border-2 border-black p-4">
                <div>
                    <div className="text-sm font-bold">{negative ? "المتبقي على الموظف" : "صافي المرتب"}</div>
                    {negative && <div className="text-xs">يتخصم من مرتب الشهر الجاي</div>}
                </div>
                <div className="text-2xl font-extrabold">{egp(Math.abs(totals.net))}</div>
            </div>

            {notes && <div className="mt-3 text-xs"><span className="font-semibold">ملاحظات: </span>{notes}</div>}

            {/* Signatures */}
            <div className="mt-14 grid grid-cols-2 gap-10 text-center text-xs">
                <div><div className="border-t border-black pt-1">توقيع الموظف</div></div>
                <div><div className="border-t border-black pt-1">توقيع الإدارة</div></div>
            </div>
        </div>
    );
}

function Column({ title, rows, total, empty }: { title: string; rows: { label: string; amount: number; date: string | null }[]; total: number; empty?: string }) {
    return (
        <div className="rounded-md border border-black/40">
            <div className="border-b border-black/40 bg-black/[0.04] px-3 py-1.5 font-bold">{title}</div>
            <table className="w-full">
                <tbody>
                    {rows.length === 0 && <tr><td className="px-3 py-2 text-xs">{empty}</td></tr>}
                    {rows.map((r, i) => (
                        <tr key={i} className="border-b border-black/10 last:border-0">
                            <td className="px-3 py-1.5">
                                <div>{r.label}</div>
                                {r.date && <div className="text-[10px]">{shortDate(r.date)}</div>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-left font-semibold">{egp(r.amount)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="flex justify-between border-t border-black/40 px-3 py-1.5 font-bold">
                <span>الإجمالي</span><span>{egp(total)}</span>
            </div>
        </div>
    );
}
