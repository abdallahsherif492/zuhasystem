"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelect } from "@/components/ui/multi-select";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { governorateArabic } from "@/lib/governorates";
import { deliveryRateOf } from "@/lib/easyorders-delivery-rate";
import { FIELDS, type FieldKey } from "@/lib/whatsapp/template-fields";
import type { WhatsAppSettings } from "@/lib/whatsapp/settings";
import type { MetaTemplate } from "@/components/whatsapp/templates-manager";

/**
 * Settings → WhatsApp → «ابعت لأوردرات»: find orders by anything (when,
 * status, products, governorate, channel, amount, how well the customer
 * takes their parcels, a tag or coupon, a name or number), pick them, and send
 * them one approved template, each {{n}} filled from the order or with the same
 * text for all (api/whatsapp/campaign). One message per number unless asked.
 */

interface Row {
    id: string; created_at: string; status: string; channel: string | null; total_amount: number | null; tags: string[] | null;
    customer_info: { name?: string; phone?: string; governorate?: string; delivery_rate?: string } | null;
    order_items: { unmapped_name: string | null; variants: { products: { id: string; name: string } | null } | null }[] | null;
}
type Param = { field?: FieldKey; text?: string };

const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
const RATE_LABEL: Record<string, string> = { high: "بيستلم كويس", moderate: "متوسط", low: "استلامه ضعيف", unknown: "مش معروف" };
// What Meta charges per message in Egypt, roughly (per-message pricing): shown as an estimate only.
const PRICE_EGP: Record<string, number> = { UTILITY: 0.2, AUTHENTICATION: 0.2, MARKETING: 3.7 };
const PAGE = 150;
const last10 = (p?: string) => (p || "").replace(/\D/g, "").slice(-10);

export function OrderCampaign({ businessId, settings }: { businessId: string; settings: WhatsAppSettings }) {
    const [from, setFrom] = useState(() => day(new Date(Date.now() - 30 * 86_400_000)));
    const [to, setTo] = useState(() => day(new Date()));
    const [rows, setRows] = useState<Row[] | null>(null);
    const [templates, setTemplates] = useState<MetaTemplate[] | null>(null);

    // Filters
    const [statuses, setStatuses] = useState<string[]>([]);
    const [products, setProducts] = useState<string[]>([]);
    const [govs, setGovs] = useState<string[]>([]);
    const [channels, setChannels] = useState<string[]>([]);
    const [rates, setRates] = useState<string[]>([]);
    const [minTotal, setMinTotal] = useState("");
    const [maxTotal, setMaxTotal] = useState("");
    const [tag, setTag] = useState("");
    const [q, setQ] = useState("");
    const [onePerNumber, setOnePerNumber] = useState(true);

    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [shown, setShown] = useState(PAGE);
    const [tplName, setTplName] = useState("");
    const [params, setParams] = useState<Param[]>([]);
    const [ask, setAsk] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

    // The orders of the period (up to 5,000).
    useEffect(() => {
        let gone = false;
        setRows(null);
        (async () => {
            const out: Row[] = [];
            for (let a = 0; a < 5000; a += 1000) {
                const { data, error } = await supabase.from("orders")
                    .select("id, created_at, status, channel, total_amount, tags, customer_info, order_items(unmapped_name, variants(products(id, name)))")
                    .eq("business_id", businessId).gte("created_at", `${from}T00:00:00+02:00`).lte("created_at", `${to}T23:59:59+02:00`)
                    .order("created_at", { ascending: false }).range(a, a + 999);
                if (error) break;
                out.push(...((data || []) as unknown as Row[]));
                if (!data || data.length < 1000) break;
            }
            if (!gone) { setRows(out); setPicked(new Set()); }
        })();
        return () => { gone = true; };
    }, [businessId, from, to]);

    useEffect(() => {
        fetch(`/api/whatsapp/templates?business_id=${businessId}`).then(r => r.json())
            .then(b => setTemplates(((b.templates || []) as MetaTemplate[]).filter(t => t.status === "APPROVED" && t.name !== "hello_world")))
            .catch(() => setTemplates([]));
    }, [businessId]);

    const govOf = (r: Row) => governorateArabic(r.customer_info?.governorate) || r.customer_info?.governorate || "";
    const productsOf = (r: Row) => (r.order_items || []).map(i => i.variants?.products?.name || i.unmapped_name || "").filter(Boolean);

    // The choices, from the orders of the period, most common first.
    const choices = useMemo(() => {
        const count = (vals: string[]) => {
            const m = new Map<string, number>();
            for (const v of vals) if (v) m.set(v, (m.get(v) || 0) + 1);
            return [...m].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ value: v, label: `${v} (${n})` }));
        };
        const rs = rows || [];
        return {
            statuses: count(rs.map(r => r.status)),
            products: count(rs.flatMap(r => [...new Set(productsOf(r))])),
            govs: count(rs.map(govOf)),
            channels: count(rs.map(r => r.channel || "")),
            rates: count(rs.map(r => deliveryRateOf(r.customer_info) || "unknown")).map(o => ({ ...o, label: o.label.replace(o.value, RATE_LABEL[o.value] || o.value) })),
        };
         
    }, [rows]);

    const filtered = useMemo(() => {
        const min = Number(minTotal) || 0, max = Number(maxTotal) || Infinity;
        const t = tag.trim().toLowerCase(), s = q.trim().toLowerCase();
        const list = (rows || []).filter(r => (!statuses.length || statuses.includes(r.status))
            && (!products.length || productsOf(r).some(p => products.includes(p)))
            && (!govs.length || govs.includes(govOf(r)))
            && (!channels.length || channels.includes(r.channel || ""))
            && (!rates.length || rates.includes(deliveryRateOf(r.customer_info) || "unknown"))
            && (Number(r.total_amount) || 0) >= min && (Number(r.total_amount) || 0) <= max
            && (!t || (r.tags || []).some(x => String(x).toLowerCase().includes(t)))
            && (!s || `${r.customer_info?.name || ""} ${r.customer_info?.phone || ""} ${r.id}`.toLowerCase().includes(s)));
        if (!onePerNumber) return list;
        // One per number: its latest order.
        const seen = new Set<string>();
        return list.filter(r => { const p = last10(r.customer_info?.phone); if (!p || seen.has(p)) return false; seen.add(p); return true; });
         
    }, [rows, statuses, products, govs, channels, rates, minTotal, maxTotal, tag, q, onePerNumber]);
    useEffect(() => { setShown(PAGE); }, [filtered]);

    const pickedRows = filtered.filter(r => picked.has(r.id));
    const allPicked = filtered.length > 0 && pickedRows.length === filtered.length;
    const anyFilter = statuses.length + products.length + govs.length + channels.length + rates.length > 0 || !!(minTotal || maxTotal || tag || q);
    const clear = () => { setStatuses([]); setProducts([]); setGovs([]); setChannels([]); setRates([]); setMinTotal(""); setMaxTotal(""); setTag(""); setQ(""); };

    // The template: its text with each {{n}}, prefilled from what the system knows about it.
    const tpl = templates?.find(t => t.name === tplName) || null;
    const body = tpl?.components?.find(c => c.type === "BODY")?.text || "";
    const slots = (body.match(/\{\{\d+\}\}/g) || []).length;
    const image = !!tpl?.components?.some(c => c.type === "HEADER" && c.format === "IMAGE");
    const pickTemplate = (name: string) => {
        setTplName(name);
        const known = settings.templates[name]?.params || [];
        const t = templates?.find(x => x.name === name);
        const n = ((t?.components?.find(c => c.type === "BODY")?.text || "").match(/\{\{\d+\}\}/g) || []).length;
        setParams(Array.from({ length: n }, (_, i) => (known[i] ? { field: known[i] } : { field: i === 0 ? "first_name" : undefined })));
    };
    const ready = !!tpl && params.length === slots && params.every(p => p.field || (p.text || "").trim());
    const preview = body.replace(/\{\{(\d+)\}\}/g, (_, n) => {
        const p = params[Number(n) - 1];
        return p?.field ? `[${FIELDS.find(f => f.key === p.field)?.label.replace(/_/g, " ")}]` : p?.text?.trim() || `{{${n}}}`;
    });
    const price = tpl ? PRICE_EGP[tpl.category] ?? 0.2 : 0;

    const send = async () => {
        const ids = pickedRows.map(r => r.id);
        const tally: Record<string, number> = {};
        const errors = new Set<string>();
        setProgress({ done: 0, total: ids.length });
        const queue = ids.slice();
        let done = 0, stop = false;
        const worker = async () => {
            for (let id = queue.shift(); id && !stop; id = queue.shift()) {
                const res = await fetch("/api/whatsapp/campaign", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ business_id: businessId, order_ids: [id], template: tplName, params }),
                }).catch(() => null);
                const b = await res?.json().catch(() => null) as { results?: { outcome: string; error?: string }[]; error?: string } | null;
                if (!res?.ok || !b?.results) { tally.failed = (tally.failed || 0) + 1; errors.add(b?.error || "واحد ماوصلش رد عليه من السيرفر، ممكن يكون اتبعت."); if (res && res.status < 500) stop = true; }
                else for (const r of b.results) { tally[r.outcome] = (tally[r.outcome] || 0) + 1; if (r.error) { errors.add(r.error); if (/الحد المسموح|وقفت الإرسال|API access|توكن/.test(r.error)) stop = true; } }
                setProgress({ done: ++done, total: ids.length });
            }
        };
        await Promise.all([worker(), worker(), worker()]);
        setProgress(null);
        setPicked(new Set());
        const said = [
            tally.sent && `اتبعت لـ ${tally.sent}`,
            tally.recent && `${tally.recent} اتبعتلهم نفس القالب في آخر 24 ساعة`,
            tally.no_image && `${tally.no_image} من غير صورة منتج`,
            tally.no_phone && `${tally.no_phone} من غير رقم`,
            tally.failed && `${tally.failed} ماتبعتوش`,
        ].filter(Boolean).join("، ");
        if (tally.sent) toast.success(said); else toast.info(said || "ماتبعتش حاجة.");
        if (errors.size) toast.error([...errors].slice(0, 2).join(" — "));
    };

    const field = "space-y-1.5";
    const label = "text-sm font-semibold";
    return (
        <section className="space-y-5 rounded-2xl border bg-card p-5" dir="rtl">
            <div>
                <h2 className="text-lg font-bold">ابعت قالب لأوردرات</h2>
                <p className="mt-1 text-sm text-muted-foreground">فلتر الأوردرات بأي حاجة، اختار اللي عايزهم، واختار قالب متوافق عليه من Meta تبعتهولهم من رقم الشركة. كل خانة في القالب بتتملا من الأوردر نفسه أو بنص ثابت للكل.</p>
            </div>

            {/* Filters */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className={field}><span className={label}>من يوم</span><Input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
                <label className={field}><span className={label}>لحد يوم</span><Input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} /></label>
                <div className={field}><span className={label}>الحالة</span><MultiSelect options={choices.statuses} selected={statuses} onChange={setStatuses} placeholder="كل الحالات" /></div>
                <div className={field}><span className={label}>المنتج</span><MultiSelect options={choices.products} selected={products} onChange={setProducts} placeholder="كل المنتجات" /></div>
                <div className={field}><span className={label}>المحافظة</span><MultiSelect options={choices.govs} selected={govs} onChange={setGovs} placeholder="كل المحافظات" /></div>
                <div className={field}><span className={label}>القناة</span><MultiSelect options={choices.channels} selected={channels} onChange={setChannels} placeholder="كل القنوات" /></div>
                <div className={field}><span className={label}>استلام العميل</span><MultiSelect options={choices.rates} selected={rates} onChange={setRates} placeholder="الكل" /></div>
                <div className={field}>
                    <span className={label}>الإجمالي (جنيه)</span>
                    <div className="flex gap-2"><Input type="number" min={0} placeholder="من" value={minTotal} onChange={e => setMinTotal(e.target.value)} /><Input type="number" min={0} placeholder="لحد" value={maxTotal} onChange={e => setMaxTotal(e.target.value)} /></div>
                </div>
                <label className={field}><span className={label}>تاج أو كوبون</span><Input placeholder="مثلاً coupon:zuha10" value={tag} onChange={e => setTag(e.target.value)} dir="ltr" /></label>
                <label className={field}><span className={label}>اسم أو رقم أو كود أوردر</span><Input value={q} onChange={e => setQ(e.target.value)} /></label>
                <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
                    <Checkbox checked={onePerNumber} onCheckedChange={v => setOnePerNumber(!!v)} />رسالة واحدة لكل رقم (آخر أوردر)
                </label>
                {anyFilter && <Button variant="ghost" className="gap-1 self-end" onClick={clear}><X className="h-4 w-4" />شيل الفلاتر</Button>}
            </div>

            {/* The orders */}
            <div className="overflow-hidden rounded-xl border">
                <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-3 py-2.5">
                    <label className="flex items-center gap-2 text-sm font-semibold">
                        <Checkbox checked={allPicked ? true : pickedRows.length ? "indeterminate" : false} disabled={!filtered.length}
                            onCheckedChange={() => setPicked(allPicked ? new Set() : new Set(filtered.map(r => r.id)))} />
                        {rows === null ? "بيحمّل…" : pickedRows.length ? `اخترت ${pickedRows.length} من ${filtered.length}` : `اختار الكل (${filtered.length})`}
                    </label>
                    {pickedRows.length > 0 && <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>إلغاء الاختيار</Button>}
                </div>
                {rows === null ? (
                    <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : filtered.length === 0 ? (
                    <p className="p-8 text-center text-sm text-muted-foreground">مفيش أوردرات بالفلاتر دي.</p>
                ) : (
                    <div className="max-h-[460px] overflow-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
                                <tr className="border-b text-start">
                                    <th className="w-10 p-2" /><th className="p-2 text-start">العميل</th><th className="p-2 text-start">المنتجات</th>
                                    <th className="p-2 text-start">المحافظة</th><th className="p-2 text-start">الحالة</th><th className="p-2 text-start">الإجمالي</th><th className="p-2 text-start">التاريخ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.slice(0, shown).map(r => (
                                    <tr key={r.id} className={cn("border-b last:border-0", picked.has(r.id) && "bg-primary/5")}>
                                        <td className="p-2"><Checkbox checked={picked.has(r.id)} onCheckedChange={() => setPicked(prev => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                                        <td className="p-2"><div className="font-medium">{r.customer_info?.name || "—"}</div><div className="text-xs text-muted-foreground" dir="ltr">{r.customer_info?.phone}</div></td>
                                        <td className="max-w-64 truncate p-2" title={productsOf(r).join("، ")}>{productsOf(r).join("، ") || "—"}</td>
                                        <td className="p-2">{govOf(r) || "—"}</td>
                                        <td className="p-2">{r.status}</td>
                                        <td className="p-2 tabular-nums">{Math.round(Number(r.total_amount) || 0)}</td>
                                        <td className="p-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("ar-EG", { day: "numeric", month: "numeric" })}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {filtered.length > shown && (
                            <div className="p-2 text-center"><Button variant="ghost" size="sm" onClick={() => setShown(n => n + PAGE)}>اعرض كمان ({filtered.length - shown})</Button></div>
                        )}
                    </div>
                )}
            </div>

            {/* The template */}
            <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                    <label className={field}>
                        <span className={label}>القالب</span>
                        <select value={tplName} onChange={e => pickTemplate(e.target.value)} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm">
                            <option value="">{templates === null ? "بيحمّل…" : "اختار قالب متوافق عليه"}</option>
                            {(templates || []).map(t => <option key={t.id} value={t.name}>{t.name} · {t.category === "MARKETING" ? "تسويق" : "خدمة"}</option>)}
                        </select>
                    </label>
                    {tpl && params.map((p, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                            <span className="w-14 font-mono text-sm text-muted-foreground" dir="ltr">{`{{${i + 1}}}`}</span>
                            <select value={p.field || "__text"} className="h-10 rounded-md border bg-background px-2 text-sm"
                                onChange={e => setParams(ps => ps.map((x, j) => j === i ? (e.target.value === "__text" ? { text: x.text || "" } : { field: e.target.value as FieldKey }) : x))}>
                                {FIELDS.map(f => <option key={f.key} value={f.key}>{f.label.replace(/_/g, " ")} من الأوردر</option>)}
                                <option value="__text">نص ثابت للكل</option>
                            </select>
                            {!p.field && <Input className="min-w-40 flex-1" placeholder="النص" value={p.text || ""} onChange={e => setParams(ps => ps.map((x, j) => j === i ? { text: e.target.value } : x))} />}
                        </div>
                    ))}
                    {image && <p className="text-xs text-muted-foreground">القالب ده فوقه صورة: هتتبعت صور منتجات كل أوردر (صورة واحدة، أو المنتجات جنب بعض). الأوردر اللي مالوش صورة بيتعدّى.</p>}
                </div>
                <div className="space-y-2">
                    <span className={label}>شكل الرسالة</span>
                    <div className="min-h-32 whitespace-pre-wrap rounded-xl bg-[#d9fdd3] p-4 text-sm leading-relaxed text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]">
                        {tpl ? preview : <span className="text-muted-foreground">اختار قالب</span>}
                    </div>
                    {tpl && (tpl.components?.find(c => c.type === "BUTTONS")?.buttons || []).length > 0 && (
                        <div className="flex flex-wrap gap-2">{tpl.components!.find(c => c.type === "BUTTONS")!.buttons!.map(b => <span key={b.text} className="rounded-full border px-3 py-1 text-xs">{b.text}</span>)}</div>
                    )}
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-sm text-muted-foreground">
                    {pickedRows.length > 0 && tpl ? <>التكلفة التقريبية: <b className="text-foreground">{Math.round(pickedRows.length * price * 10) / 10} جنيه</b> ({tpl.category === "MARKETING" ? "قالب تسويق" : "قالب خدمة"})</> : "اختار أوردرات وقالب."}
                    {pickedRows.length > 250 && <span className="block text-amber-700">Meta بتسمح بحوالي 250 رقم جديد في اليوم للحساب غير الموثّق: الزيادة ممكن ماتوصلش.</span>}
                </p>
                <Button disabled={!ready || !pickedRows.length || !!progress} onClick={() => setAsk(true)} className="gap-2">
                    {progress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {progress ? `بيتبعت ${progress.done} من ${progress.total}` : `ابعت لـ ${pickedRows.length}`}
                </Button>
            </div>

            <AlertDialog open={ask} onOpenChange={setAsk}>
                <AlertDialogContent dir="rtl">
                    <AlertDialogHeader className="text-start sm:text-start">
                        <AlertDialogTitle>تبعت «{tplName}» لـ {pickedRows.length} عميل؟</AlertDialogTitle>
                        <AlertDialogDescription>
                            هتتبعت من رقم الشركة، وتكلفتها حوالي {Math.round(pickedRows.length * price * 10) / 10} جنيه. اللي اتبعتله نفس القالب في آخر 24 ساعة مش هيتبعتله تاني.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2">
                        <AlertDialogCancel>رجوع</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { setAsk(false); send(); }}>ابعت</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    );
}
