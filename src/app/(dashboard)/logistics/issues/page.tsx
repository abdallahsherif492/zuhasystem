"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, cn, normalizeSearchText } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Loader2, LifeBuoy, Phone, MessageCircle, Search, RefreshCw,
    ChevronDown, ChevronRight, AlertTriangle, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { logBusinessAction } from "@/lib/logs/actions-logger";

interface Issue {
    order_id: string;
    reference: string;
    status: string;
    bucket: "returning" | "hold" | "stale";
    customer_name: string | null;
    customer_phone: string | null;
    governorate: string | null;
    total_amount: number;
    courier: string | null;
    closed_by: string | null;
    days_stuck: number;
    followup_count: number;
    last_followup: string | null;
    last_outcome: string | null;
    next_action_at: string | null;
}

interface Followup {
    id: string;
    outcome: string;
    note: string | null;
    next_action_at: string | null;
    created_by: string | null;
    created_at: string;
}

/** The outcomes a call can end in, in the order they actually happen. */
const OUTCOMES: { value: string; label: string; tone: "good" | "warn" | "bad" }[] = [
    { value: "reached_rescheduled", label: "رد واتفقنا على ميعاد جديد", tone: "good" },
    { value: "reached_confirmed", label: "رد ومتمسك بالأوردر", tone: "good" },
    { value: "courier_contacted", label: "اتكلمت مع شركة الشحن", tone: "warn" },
    { value: "no_answer", label: "محدش رد", tone: "warn" },
    { value: "phone_off", label: "الرقم مقفول", tone: "warn" },
    { value: "wrong_number", label: "رقم غلط", tone: "bad" },
    { value: "customer_refused", label: "العميل رفض الاستلام", tone: "bad" },
    { value: "other", label: "حاجة تانية", tone: "warn" },
];
const outcomeLabel = (v: string | null) => OUTCOMES.find(o => o.value === v)?.label || v || "—";

const BUCKETS = [
    { key: "all", label: "الكل" },
    { key: "returning", label: "قيد الإرجاع" },
    { key: "hold", label: "مؤجل للتسليم" },
    { key: "stale", label: "شحن متأخر" },
];

const todayStr = () => format(new Date(), "yyyy-MM-dd");

/**
 * Worklist for orders stuck with the courier.
 *
 * These are not lost orders. A parcel only becomes a return when it physically
 * reaches the warehouse, so until then a phone call still recovers it — and
 * recovering one is far cheaper than winning a new order, because the courier
 * fee and the ad spend have already been paid.
 *
 * Sorted by how long each order has been stuck rather than by when it was
 * created: an order placed three weeks ago that shipped yesterday is healthy,
 * and one that has been Returning since Tuesday is not.
 */
export default function ShippingIssuesPage() {
    const { activeBusiness, currentUser } = useBusiness();
    const { t } = useLanguage();

    const [rows, setRows] = useState<Issue[]>([]);
    const [loading, setLoading] = useState(true);
    const [unavailable, setUnavailable] = useState(false);
    const [bucket, setBucket] = useState("all");
    const [query, setQuery] = useState("");
    const [staleDays, setStaleDays] = useState(5);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [history, setHistory] = useState<Record<string, Followup[]>>({});

    const [dialog, setDialog] = useState<Issue | null>(null);
    const [form, setForm] = useState({ outcome: "", note: "", next: "", newStatus: "" });
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!activeBusiness) return;
        setLoading(true);
        const { data, error } = await supabase.rpc("get_shipping_issues", {
            p_business_id: activeBusiness.id,
            p_stale_days: staleDays,
        });
        if (error) {
            console.error("Shipping issues failed to load:", error);
            setUnavailable(true);
            setRows([]);
        } else {
            setUnavailable(false);
            setRows((data as Issue[]) || []);
        }
        setLoading(false);
    }, [activeBusiness, staleDays]);

    useEffect(() => { load(); }, [load]);

    async function loadHistory(orderId: string) {
        if (history[orderId] || !activeBusiness) return;
        const { data } = await supabase
            .from("shipping_followups")
            .select("id, outcome, note, next_action_at, created_by, created_at")
            .eq("business_id", activeBusiness.id)
            .eq("order_id", orderId)
            .order("created_at", { ascending: false });
        setHistory(prev => ({ ...prev, [orderId]: (data as Followup[]) || [] }));
    }

    const filtered = useMemo(() => {
        const q = normalizeSearchText(query);
        return rows.filter(r => {
            if (bucket !== "all" && r.bucket !== bucket) return false;
            if (!q) return true;
            const hay = normalizeSearchText(
                `${r.reference} ${r.customer_name || ""} ${r.customer_phone || ""} ${r.governorate || ""} ${r.courier || ""}`);
            return hay.includes(q);
        });
    }, [rows, bucket, query]);

    const totals = useMemo(() => {
        const val = filtered.reduce((s, r) => s + Number(r.total_amount || 0), 0);
        const overdue = filtered.filter(r => r.next_action_at && r.next_action_at < todayStr()).length;
        const untouched = filtered.filter(r => Number(r.followup_count) === 0).length;
        return { count: filtered.length, val, overdue, untouched };
    }, [filtered]);

    function openDialog(r: Issue) {
        setForm({ outcome: "", note: "", next: "", newStatus: "" });
        setDialog(r);
    }

    async function saveFollowup() {
        if (!activeBusiness || !dialog) return;
        if (!form.outcome) return toast.error(t("اختار نتيجة المكالمة"));
        setSaving(true);
        try {
            const { error } = await supabase.from("shipping_followups").insert({
                business_id: activeBusiness.id,
                order_id: dialog.order_id,
                outcome: form.outcome,
                note: form.note.trim() || null,
                next_action_at: form.next || null,
                created_by: currentUser?.email || "Staff",
            }).select("id");
            if (error) throw error;

            // Changing the status is optional — most follow-ups are just a note
            // that the customer was reached and a new date agreed.
            if (form.newStatus && form.newStatus !== dialog.status) {
                const { data, error: sErr } = await supabase
                    .from("orders")
                    .update({ status: form.newStatus })
                    .eq("id", dialog.order_id)
                    .eq("business_id", activeBusiness.id)
                    .select("id");
                if (sErr) throw sErr;
                if (!data || data.length === 0) {
                    throw new Error("لم يتم حفظ تغيير الحالة. حدّث الصفحة وجرّب تاني.");
                }
                logBusinessAction({
                    businessId: activeBusiness.id,
                    userEmail: currentUser?.email || "Staff",
                    actionType: "update_status",
                    entityType: "order",
                    entityId: dialog.order_id,
                    entityName: `Order #${dialog.reference} (${dialog.customer_name || "Customer"})`,
                    changes: [{ field: "Status", old_value: dialog.status, new_value: form.newStatus }],
                    metadata: { source: "shipping_issues", outcome: form.outcome },
                });
            }

            toast.success(t("تم تسجيل المتابعة"));
            setDialog(null);
            setHistory(prev => { const n = { ...prev }; delete n[dialog.order_id]; return n; });
            load();
        } catch (e: any) {
            toast.error(e.message || t("فشل حفظ المتابعة"));
        } finally {
            setSaving(false);
        }
    }

    const digits = (p: string | null) => (p || "").replace(/\D/g, "");
    const waLink = (p: string | null) => {
        const d = digits(p);
        if (!d) return null;
        // Egyptian mobiles are stored as 01XXXXXXXXX; WhatsApp wants 20XXXXXXXXXX.
        return `https://wa.me/${d.startsWith("0") ? "2" + d : d}`;
    };

    if (unavailable) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>{t("مشاكل الشحن")}</CardTitle>
                    <CardDescription>
                        شغّل supabase/migrations/20260825_shipping_issues.sql عشان الصفحة دي تشتغل.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <LifeBuoy className="h-7 w-7 text-primary" />
                        {t("مشاكل الشحن")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        أوردرات عالقة عند شركة الشحن ولسه ممكن تتنقذ. الأقدم أولاً — ده اللي على وشك يضيع.
                    </p>
                </div>
                <Button variant="outline" onClick={load} className="gap-2">
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    {t("تحديث")}
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">أوردرات عالقة</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold">{totals.count}</div></CardContent>
                </Card>
                <Card className="border-red-500/20 bg-gradient-to-br from-red-500/10 to-transparent">
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-300">قيمتها</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-black text-red-700 dark:text-red-300">{formatCurrency(totals.val)}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">محدش لمسها</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold text-amber-600">{totals.untouched}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">فات ميعاد متابعتها</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold text-red-600">{totals.overdue}</div></CardContent>
                </Card>
            </div>

            <div className="flex flex-wrap items-center gap-2 bg-muted/30 p-3 rounded-xl border">
                {BUCKETS.map(b => {
                    const c = b.key === "all" ? rows.length : rows.filter(r => r.bucket === b.key).length;
                    return (
                        <Button key={b.key} size="sm" variant={bucket === b.key ? "default" : "outline"}
                                onClick={() => setBucket(b.key)} className="gap-1.5">
                            {b.label}
                            <span className="text-[11px] opacity-70">({c})</span>
                        </Button>
                    );
                })}
                <div className="relative flex-1 min-w-[180px] max-w-sm ms-auto">
                    <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="رقم الأوردر أو العميل أو التليفون..." value={query}
                           onChange={e => setQuery(e.target.value)} className="ps-8 h-9 bg-background" />
                </div>
                <div className="flex items-center gap-1.5">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">شحن متأخر بعد</Label>
                    <Input type="number" min={1} max={60} value={staleDays}
                           onChange={e => setStaleDays(Math.max(1, Number(e.target.value) || 5))}
                           className="h-9 w-16 bg-background" />
                    <span className="text-xs text-muted-foreground">يوم</span>
                </div>
            </div>

            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center p-16"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
                    ) : filtered.length === 0 ? (
                        <div className="p-16 text-center text-sm text-muted-foreground">
                            مفيش أوردرات عالقة في الفلتر ده — شغل كويس.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[46px]" />
                                    <TableHead>الأوردر</TableHead>
                                    <TableHead className="hidden md:table-cell">المحافظة</TableHead>
                                    <TableHead>الحالة</TableHead>
                                    <TableHead className="text-center">عالق من</TableHead>
                                    <TableHead className="hidden lg:table-cell">آخر متابعة</TableHead>
                                    <TableHead className="text-right hidden sm:table-cell">القيمة</TableHead>
                                    <TableHead className="w-[130px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map(r => {
                                    const open = expanded === r.order_id;
                                    const overdue = r.next_action_at && r.next_action_at < todayStr();
                                    return (
                                        <>
                                            <TableRow key={r.order_id} className="cursor-pointer hover:bg-muted/30"
                                                      onClick={() => { setExpanded(open ? null : r.order_id); if (!open) loadHistory(r.order_id); }}>
                                                <TableCell>
                                                    {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                          : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-medium">{r.customer_name || "—"}</div>
                                                    <div className="text-xs text-muted-foreground font-mono">
                                                        #{r.reference}{r.courier ? ` · ${r.courier}` : ""}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell text-sm">{r.governorate || "—"}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={cn(
                                                        r.bucket === "returning" && "bg-red-500/10 text-red-600 border-red-500/20",
                                                        r.bucket === "hold" && "bg-amber-500/10 text-amber-600 border-amber-500/20",
                                                        r.bucket === "stale" && "bg-blue-500/10 text-blue-600 border-blue-500/20",
                                                    )}>
                                                        {r.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className={cn("font-bold tabular-nums",
                                                        r.days_stuck >= 14 ? "text-red-600"
                                                            : r.days_stuck >= 7 ? "text-amber-600" : "text-muted-foreground")}>
                                                        {r.days_stuck}
                                                    </span>
                                                    <span className="text-[11px] text-muted-foreground"> يوم</span>
                                                </TableCell>
                                                <TableCell className="hidden lg:table-cell text-xs">
                                                    {Number(r.followup_count) === 0 ? (
                                                        <span className="text-amber-600 font-medium">محدش لمسها</span>
                                                    ) : (
                                                        <>
                                                            <div>{outcomeLabel(r.last_outcome)}</div>
                                                            <div className="text-muted-foreground">
                                                                {r.followup_count} متابعة
                                                                {overdue && <span className="text-red-600 font-medium"> · فات الميعاد</span>}
                                                            </div>
                                                        </>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right hidden sm:table-cell tabular-nums">
                                                    {formatCurrency(Number(r.total_amount))}
                                                </TableCell>
                                                <TableCell onClick={e => e.stopPropagation()}>
                                                    <div className="flex items-center gap-1 justify-end">
                                                        {r.customer_phone && (
                                                            <>
                                                                <Button asChild size="icon" variant="ghost" className="h-8 w-8" title="اتصل">
                                                                    <a href={`tel:${digits(r.customer_phone)}`}><Phone className="h-3.5 w-3.5" /></a>
                                                                </Button>
                                                                <Button asChild size="icon" variant="ghost" className="h-8 w-8 text-emerald-600" title="واتساب">
                                                                    <a href={waLink(r.customer_phone) || "#"} target="_blank" rel="noopener noreferrer">
                                                                        <MessageCircle className="h-3.5 w-3.5" />
                                                                    </a>
                                                                </Button>
                                                            </>
                                                        )}
                                                        <Button size="sm" variant="outline" className="h-8"
                                                                onClick={() => openDialog(r)}>
                                                            متابعة
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>

                                            {open && (
                                                <TableRow key={`${r.order_id}-d`} className="bg-muted/20 hover:bg-muted/20">
                                                    <TableCell colSpan={8} className="p-4">
                                                        <div className="grid gap-4 md:grid-cols-3 text-xs mb-3">
                                                            <div><span className="text-muted-foreground">التليفون: </span><span className="font-mono">{r.customer_phone || "—"}</span></div>
                                                            <div><span className="text-muted-foreground">شركة الشحن: </span>{r.courier || "غير محددة"}</div>
                                                            <div><span className="text-muted-foreground">اللي أكد الأوردر: </span>{r.closed_by || "غير محدد"}</div>
                                                        </div>
                                                        <p className="font-bold uppercase tracking-wider text-[10px] text-muted-foreground mb-2">
                                                            سجل المتابعات
                                                        </p>
                                                        {!history[r.order_id] ? (
                                                            <div className="py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                                                        ) : history[r.order_id].length === 0 ? (
                                                            <p className="text-xs text-muted-foreground py-2">
                                                                لسه محدش تابع الأوردر ده. دي أول مكالمة.
                                                            </p>
                                                        ) : (
                                                            <div className="rounded-md border bg-background divide-y">
                                                                {history[r.order_id].map(f => (
                                                                    <div key={f.id} className="p-2.5 text-xs">
                                                                        <div className="flex flex-wrap items-center gap-2">
                                                                            <span className="font-semibold">{outcomeLabel(f.outcome)}</span>
                                                                            <span className="text-muted-foreground">
                                                                                {format(new Date(f.created_at), "dd/MM/yyyy hh:mm a")}
                                                                            </span>
                                                                            <span className="text-muted-foreground">· {f.created_by || "—"}</span>
                                                                            {f.next_action_at && (
                                                                                <Badge variant="outline" className="text-[10px] gap-1">
                                                                                    <Clock className="h-3 w-3" /> متابعة {f.next_action_at}
                                                                                </Badge>
                                                                            )}
                                                                        </div>
                                                                        {f.note && <p className="text-muted-foreground mt-1">{f.note}</p>}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={!!dialog} onOpenChange={o => !o && setDialog(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>متابعة أوردر #{dialog?.reference}</DialogTitle>
                        <DialogDescription>
                            {dialog?.customer_name} · {dialog?.governorate} · عالق من {dialog?.days_stuck} يوم
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>نتيجة المكالمة</Label>
                            <Select value={form.outcome} onValueChange={v => setForm({ ...form, outcome: v })}>
                                <SelectTrigger><SelectValue placeholder="اختار..." /></SelectTrigger>
                                <SelectContent>
                                    {OUTCOMES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>ملاحظات</Label>
                            <Textarea rows={2} value={form.note}
                                      onChange={e => setForm({ ...form, note: e.target.value })}
                                      placeholder="العميل قال إيه بالظبط، وإيه اللي اتفقتوا عليه" />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>متابعة تاني يوم</Label>
                                <Input type="date" value={form.next}
                                       onChange={e => setForm({ ...form, next: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>غيّر الحالة (اختياري)</Label>
                                <Select value={form.newStatus} onValueChange={v => setForm({ ...form, newStatus: v })}>
                                    <SelectTrigger><SelectValue placeholder="سيبها زي ما هي" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Shipped">رجّعها للشحن</SelectItem>
                                        <SelectItem value="Hold To redeliver">مؤجل للتسليم</SelectItem>
                                        <SelectItem value="Collected">اتسلمت</SelectItem>
                                        <SelectItem value="Returned">مرتجع نهائي</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {form.newStatus === "Returned" && (
                            <div className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                                <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                                <p className="text-xs text-red-700 dark:text-red-400">
                                    ده هيحسب مرتجع في نسبة التسليم. متعملهاش غير لما تتأكد إن العميل رفض
                                    فعلاً — الأوردر اللي لسه عند شركة الشحن مش مرتجع.
                                </p>
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialog(null)}>إلغاء</Button>
                        <Button onClick={saveFollowup} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            سجّل المتابعة
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
