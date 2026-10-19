"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, ChevronsUpDown, Loader2, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    turboAreasAction, turboPrepareAction, turboSendAction,
    type TurboPreviewRow, type TurboSendResult,
} from "@/app/(dashboard)/logistics/turbo-actions";
import { normalizeArabic, type TurboPlace } from "@/lib/shipping/turbo";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Sends the selected orders to Turbo. Each order shows what will go: the
 * governorate and the area (guessed from the address; check it, Turbo
 * refuses an area it does not cover), and the amount the courier collects —
 * the total less any deposit. Orders already sent are listed but not sent
 * again.
 */
export function TurboSendDialog({ open, onOpenChange, businessId, orderIds, onSent }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    businessId: string;
    orderIds: string[];
    onSent: () => void;
}) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rows, setRows] = useState<TurboPreviewRow[]>([]);
    const [governments, setGovernments] = useState<TurboPlace[]>([]);
    const [areas, setAreas] = useState<Record<number, TurboPlace[]>>({});
    const [include, setInclude] = useState<Set<string>>(new Set());
    const [sending, setSending] = useState(false);
    const [results, setResults] = useState<Record<string, TurboSendResult>>({});

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        (async () => {
            setLoading(true); setError(null); setResults({});
            const res = await turboPrepareAction(businessId, orderIds);
            if (cancelled) return;
            setLoading(false);
            if (res.error) { setError(res.error); return; }
            setRows(res.rows);
            setGovernments(res.governments);
            setAreas(res.areas);
            setInclude(new Set(res.rows.filter(r => !r.alreadySent).map(r => r.orderId)));
        })();
        return () => { cancelled = true; };
    }, [open, businessId, orderIds]);

    const update = (orderId: string, patch: Partial<TurboPreviewRow>) =>
        setRows(rs => rs.map(r => (r.orderId === orderId ? { ...r, ...patch } : r)));

    async function changeGovernment(orderId: string, governmentId: number) {
        update(orderId, { governmentId, areaId: null, areaGuessed: false });
        if (!areas[governmentId]) {
            try {
                const list = await turboAreasAction(governmentId);
                setAreas(a => ({ ...a, [governmentId]: list }));
            } catch {
                toast.error("مقدرتش أجيب مناطق المحافظة دي من تربو");
            }
        }
    }

    const chosen = rows.filter(r => include.has(r.orderId) && !r.alreadySent && !results[r.orderId]?.ok);
    const missing = chosen.filter(r => !r.governmentId || !r.areaId);
    const total = useMemo(() => chosen.reduce((s, r) => s + r.amount, 0), [chosen]);

    async function send() {
        if (missing.length) { toast.error(`اختار المنطقة لـ ${missing.length} أوردر`); return; }
        setSending(true);
        const res = await turboSendAction(businessId, chosen.map(r => ({ orderId: r.orderId, governmentId: r.governmentId!, areaId: r.areaId! })));
        setSending(false);
        if (res.error) { toast.error(res.error); return; }
        setResults(prev => ({ ...prev, ...Object.fromEntries(res.results.map(r => [r.orderId, r])) }));
        const ok = res.results.filter(r => r.ok).length, failed = res.results.length - ok;
        if (ok) { toast.success(`اتبعت ${ok} أوردر لتربو`); onSent(); }
        if (failed) toast.error(`${failed} أوردر ماتبعتش، السبب مكتوب جنب كل واحد`);
    }

    return (
        <Dialog open={open} onOpenChange={o => !sending && onOpenChange(o)}>
            <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-hidden p-0 sm:max-w-5xl" dir="rtl">
                <DialogHeader className="border-b p-5 pr-12 text-start">
                    <DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-orange-500" />إرسال لتربو</DialogTitle>
                    <DialogDescription className="text-start">
                        راجع المحافظة والمنطقة لكل أوردر. المنطقة متخمّنة من العنوان، ولو مش موجودة اختارها. المبلغ اللي المندوب هيحصّله هو الإجمالي ناقص العربون.
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[60vh] overflow-auto">
                    {loading ? (
                        <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                    ) : error ? (
                        <p className="p-6 text-sm text-red-700">{error}</p>
                    ) : (
                        <table className="w-full min-w-[860px] text-sm">
                            <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
                                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                                    <th className="w-8" />
                                    <th>الأوردر</th>
                                    <th>العنوان</th>
                                    <th>المحافظة</th>
                                    <th>المنطقة</th>
                                    <th className="text-end">هيتحصّل</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {rows.map(r => {
                                    const result = results[r.orderId];
                                    const done = r.alreadySent || result?.ok;
                                    const list = r.governmentId ? areas[r.governmentId] || [] : [];
                                    return (
                                        <tr key={r.orderId} className={cn("align-top [&>td]:px-3 [&>td]:py-2.5", done && "bg-emerald-50/60 dark:bg-emerald-950/20")}>
                                            <td>
                                                <Checkbox checked={include.has(r.orderId) && !done} disabled={!!done || sending}
                                                          onCheckedChange={c => setInclude(s => { const n = new Set(s); if (c) n.add(r.orderId); else n.delete(r.orderId); return n; })} />
                                            </td>
                                            <td className="min-w-[9rem]">
                                                <div className="font-mono text-xs font-semibold" dir="ltr">#{r.reference}</div>
                                                <div className="font-medium">{r.customer || "—"}</div>
                                                <div className="text-xs text-muted-foreground" dir="ltr">{r.phone}</div>
                                                {r.alreadySent && <div className="mt-1 text-xs font-medium text-emerald-700">اتبعت قبل كده: {r.alreadySent}</div>}
                                                {result && (result.ok
                                                    ? <div className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />اتبعت: {result.code}{result.message ? ` (${result.message})` : ""}</div>
                                                    : <div className="mt-1 flex items-start gap-1 text-xs font-medium text-red-700"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{result.message}</div>)}
                                            </td>
                                            <td className="max-w-[16rem] text-xs text-muted-foreground">{r.address || "—"}</td>
                                            <td>
                                                <select value={r.governmentId ?? ""} disabled={!!done || sending}
                                                        onChange={e => changeGovernment(r.orderId, Number(e.target.value))}
                                                        className="h-9 w-36 rounded-md border bg-background px-2 text-sm">
                                                    <option value="" disabled>اختار</option>
                                                    {governments.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                                </select>
                                                <div className="mt-1 text-[11px] text-muted-foreground" dir="ltr">{r.governorate}</div>
                                            </td>
                                            <td>
                                                <AreaPicker areas={list} value={r.areaId} disabled={!!done || sending || !r.governmentId}
                                                            invalid={include.has(r.orderId) && !done && !r.areaId}
                                                            onChange={id => update(r.orderId, { areaId: id, areaGuessed: false })} />
                                                {r.areaGuessed && <div className="mt-1 text-[11px] text-amber-700">متخمّنة من العنوان، اتأكد</div>}
                                            </td>
                                            <td className="text-end">
                                                <div className="font-semibold tabular-nums" dir="ltr">{formatCurrency(r.amount)}</div>
                                                {r.deposit > 0 && <div className="text-[11px] text-muted-foreground">بعد عربون <span dir="ltr">{formatCurrency(r.deposit)}</span></div>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                <DialogFooter className="flex-row items-center justify-between gap-3 border-t p-4 sm:justify-between">
                    <div className="text-sm text-muted-foreground">
                        {chosen.length} أوردر، هيتحصّل <span className="font-semibold text-foreground" dir="ltr">{formatCurrency(total)}</span>
                        {missing.length > 0 && <span className="ms-2 text-red-700">{missing.length} من غير منطقة</span>}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>قفل</Button>
                        <Button onClick={send} disabled={sending || loading || !!error || chosen.length === 0} className="gap-2 bg-orange-500 hover:bg-orange-600">
                            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            ابعت {chosen.length} لتربو
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Turbo's areas for one governorate — a few hundred, street by street — as a
 * searchable list. The search ignores how Arabic happens to be typed (أ/ا,
 * ة/ه, ى/ي, diacritics), so "حدايق" finds "حدائق". Uncovered areas are shown
 * but cannot be picked.
 */
function AreaPicker({ areas, value, onChange, disabled, invalid }: {
    areas: TurboPlace[];
    value: number | null;
    onChange: (id: number) => void;
    disabled?: boolean;
    invalid?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const current = areas.find(a => a.id === value);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={open} disabled={disabled}
                        className={cn("h-9 w-52 justify-between gap-2 px-2 text-sm font-normal", invalid && "border-red-400 text-red-700")}>
                    <span className="truncate">{current?.name ?? "اختار المنطقة"}</span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start" dir="rtl">
                <Command filter={(itemValue, search) => (itemValue.includes(normalizeArabic(search)) ? 1 : 0)}>
                    <CommandInput placeholder="دوّر على المنطقة…" />
                    <CommandList>
                        <CommandEmpty>مفيش منطقة بالاسم ده</CommandEmpty>
                        <CommandGroup>
                            {areas.map(a => {
                                const uncovered = a.status === "غير مغطاة";
                                return (
                                    <CommandItem key={a.id} value={`${normalizeArabic(a.name)} ${a.id}`} disabled={uncovered}
                                                 onSelect={() => { onChange(a.id); setOpen(false); }}>
                                        <span className="truncate">{a.name}</span>
                                        {a.status && a.status !== "مغطاة" && <span className="ms-2 shrink-0 text-[11px] text-muted-foreground">{a.status}</span>}
                                        {value === a.id && <Check className="ms-auto h-4 w-4" />}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
