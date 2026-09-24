"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, ArrowRight, BookOpen, RefreshCw, PlayCircle } from "lucide-react";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/lib/supabase";
import { canOpenPage } from "@/lib/navigation-access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SetupForYouCard } from "@/components/support/whatsapp-help";
import { EasyOrdersImportButton } from "@/components/onboarding/easyorders-import-button";
import { TutorialPlaylist } from "@/components/onboarding/tutorials";

export function StartHereLink() {
    const { language } = useLanguage();
    return <Button asChild variant="ghost" className="min-h-11 shrink-0"><Link href="/getting-started"><BookOpen className="me-2 h-4 w-4" />{language === "ar" ? "ابدأ هنا" : "Start here"}</Link></Button>;
}

export function GettingStarted({ compact = false }: { compact?: boolean }) {
    const { activeBusiness, userRole, allowedPages, isSystemAdmin } = useBusiness();
    const { language } = useLanguage();
    const ar = language === "ar";
    const copy = (arabic: string, english: string) => ar ? arabic : english;
    const can = (path: string) => canOpenPage(path, userRole, allowedPages, isSystemAdmin);
    const isManager = isSystemAdmin || ["owner", "admin", "platform admin", "super admin"]
        .includes((userRole || "").toLowerCase().trim().replace(/_/g, " "));
    const businessId = activeBusiness?.id;
    const [revision, setRevision] = useState(0);
    const [snapshot, setSnapshot] = useState<{ businessId: string; done: boolean[]; error: boolean } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!businessId || !isManager) return;
        let cancelled = false;
        async function load() {
            setLoading(true);
            try {
                // Existence checks across all dates: a quiet day is not an empty store.
                const results = await Promise.all([
                    supabase.from("products").select("id").eq("business_id", businessId!).limit(1),
                    supabase.from("shipping_companies").select("id").eq("business_id", businessId!).limit(1),
                    supabase.from("orders").select("id").eq("business_id", businessId!).limit(1),
                ]);
                if (!cancelled) setSnapshot({ businessId: businessId!, done: results.map(r => !!r.data?.length), error: results.some(r => !!r.error) });
            } catch {
                if (!cancelled) setSnapshot({ businessId: businessId!, done: [], error: true });
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void load();
        const refresh = () => { if (document.visibilityState === "visible") void load(); };
        window.addEventListener("focus", refresh);
        return () => { cancelled = true; window.removeEventListener("focus", refresh); };
    }, [businessId, isManager, revision]);

    if (!activeBusiness) return null;
    const current = snapshot?.businessId === businessId ? snapshot : null;
    const ready = !!current && !loading && !current.error;
    const steps = [
        { title: copy("ضيف منتجاتك", "Add your products"), href: "/products", action: copy("افتح المنتجات", "Open products"), description: copy("ضيف اسم المنتج، سعره وتكلفته. لو عندك ألوان أو مقاسات، ضيفها كاختيارات للمنتج.", "Add a product, its price and cost. Add colours or sizes as variants."), done: current?.done[0] },
        { title: copy("جهّز شركة الشحن", "Set up your courier"), href: "/shipping", action: copy("افتح شركات الشحن", "Open couriers"), description: copy("ضيف الشركة اللي بتشحن معاها، وبعدها راجع أسعار المحافظات عشان حساب الربح يبقى مفيد.", "Add the courier you use, then review governorate rates so profit estimates are useful."), done: current?.done[1] },
        { title: copy("دخّل أول أوردر", "Bring in your first order"), href: "/orders/new", action: copy("ضيف أوردر يدوي", "Add an order manually"), description: copy("سجّل أوردر حقيقي ببيانات العميل والمنتجات، أو ارفع شيت Excel فيه أوردراتك من صفحة الأوردرات. أو اربط متجرك من الاختيار اللي تحت عشان الطلبات توصلك تلقائي.", "Enter a real order with customer details and products, or connect your store below to receive orders automatically."), done: current?.done[2] },
    ];
    const tc = activeBusiness.theme_config || {};
    const hasEasyOrdersKey = !!(tc.integrations?.platforms?.easyorders?.apiKey || tc.easyorders_api_key);
    const complete = ready ? steps.filter(s => s.done).length : 0;
    const next = steps.find(s => !s.done);
    const tasks = [
        { href: "/platform-orders", title: copy("أكّد طلبات الموقع", "Confirm store orders"), description: copy("راجع العميل والمنتجات، تواصل معاه وبعد التأكيد انقل الطلب للتجهيز.", "Review the customer and items, contact them and confirm the order for fulfilment.") },
        { href: "/logistics", title: copy("جهّز الطلبات واشحنها", "Prepare and ship orders"), description: copy("تابع الطلبات المؤكدة، جهّز الشحنات وابعثها لشركة الشحن.", "Find confirmed orders, prepare parcels and hand them to the courier.") },
        { href: "/logistics/issues", title: copy("تابع مشاكل الشحن", "Resolve shipping issues"), description: copy("شوف الطلبات اللي محتاجة متابعة مع العميل أو شركة الشحن.", "Find orders needing a follow-up with the customer or courier.") },
        { href: "/accounting", title: copy("سجّل التحصيل والمصروفات", "Record money in and out"), description: copy("سجّل الفلوس اللي وصلت والمصروفات في الخزنة الصح.", "Record payments received and expenses in the correct account.") },
    ].filter(task => can(task.href));

    if (compact) return (
        <Card className="border-primary/20 bg-primary/5" dir={ar ? "rtl" : "ltr"}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <p className="font-semibold">{copy("مش عارف تبدأ منين؟", "Not sure where to start?")}</p>
                    <p className="text-sm text-muted-foreground">{isManager && ready && next ? copy(`الخطوة الجاية: ${next.title} — ${complete} من ${steps.length} خطوات تمت.`, `Next: ${next.title} — ${complete} of ${steps.length} steps done.`) : copy("اختار المهمة اللي محتاج تعملها، وهنوصلك لمكانها.", "Choose a task and find exactly where to do it.")}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                    <Button asChild variant="outline" className="min-h-11"><Link href="/getting-started#tutorials"><PlayCircle className="me-2 h-4 w-4" />{copy("فيديوهات الشرح", "Tutorial videos")}</Link></Button>
                    <Button asChild className="min-h-11"><Link href="/getting-started">{copy("ابدأ هنا", "Start here")}<ArrowRight className="ms-2 h-4 w-4 rtl:rotate-180" /></Link></Button>
                </div>
            </CardContent>
        </Card>
    );

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6 pb-20" dir={ar ? "rtl" : "ltr"}>
            <header className="space-y-2">
                <p className="text-sm text-muted-foreground">{activeBusiness.name}</p>
                <h1 className="text-2xl font-bold sm:text-3xl">{copy("من أول أوردر لحد التحصيل", "From your first order to getting paid")}</h1>
                <p className="text-muted-foreground">{copy("ابدأ بخطوة واحدة. تقدر ترجع هنا في أي وقت من القايمة.", "Start with one step. Return here anytime from the menu.")}</p>
            </header>
            {/* The first thing a new store sees after signing up. */}
            <TutorialPlaylist />
            {/* The landing page promises free setup; this is where a new
                merchant who is stuck can take us up on it. */}
            {isManager && ready && complete < steps.length && <SetupForYouCard storeName={activeBusiness.name} />}
            {isManager && <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <CardTitle>{copy("جهّز متجرك لأول أوردر", "Get ready for your first order")}</CardTitle>
                        <Button variant="outline" size="sm" className="min-h-11" disabled={loading} onClick={() => setRevision(r => r + 1)}><RefreshCw className="me-2 h-4 w-4" />{copy("راجع التقدم", "Refresh progress")}</Button>
                    </div>
                    <CardDescription>{copy("العلامة بتظهر لما نلاقي منتج أو شركة شحن أو أوردر متسجّل فعلاً، مش لمجرد فتح الصفحة.", "Steps reflect products, couriers and orders actually saved, not pages visited.")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!ready ? <p role="status" className="text-sm text-muted-foreground">{current?.error ? copy("مش قادرين نراجع التقدم دلوقتي. تقدر تفتح الخطوات أو تحاول تاني.", "Could not check progress. You can still open the steps or retry.") : copy("بنراجع إعدادات متجرك…", "Checking your store…")}</p> : <>
                        <p className="text-sm font-medium" aria-live="polite">{complete} / {steps.length} {copy("خطوات تمت", "steps done")}</p>
                        <Progress value={complete / steps.length * 100} aria-label={copy("تقدم تجهيز المتجر", "Store setup progress")} />
                        {next && <Button asChild className="min-h-11"><Link href={next.href}>{copy(`الخطوة الجاية: ${next.title}`, `Next: ${next.title}`)}</Link></Button>}
                        {complete === steps.length && <p className="text-sm text-emerald-600">{copy("أول أوردر موجود! كمل من مهام الشغل اليومي تحت.", "Your first order is here! Continue with the daily tasks below.")}</p>}
                    </>}
                    <ol className="grid gap-3 md:grid-cols-3">
                        {steps.map((step, index) => <li key={step.href} className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
                            <div className="flex items-center gap-2">{ready && step.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}<h2 className="font-semibold">{index + 1}. {step.title}</h2></div>
                            <p className="text-sm leading-6 text-muted-foreground">{step.description}</p>
                            <Button asChild variant="outline" className="mt-auto min-h-11"><Link href={step.href}>{step.action}</Link></Button>
                        </li>)}
                    </ol>
                    <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div><p className="font-medium">{copy("عندك متجر على EasyOrders أو Shopify؟", "Already selling on EasyOrders or Shopify?")}</p><p className="text-sm text-muted-foreground">{copy("اربطه عشان تستقبل طلباته هنا. تقدر تبدأ يدوي وتربطه بعدين.", "Connect it to receive orders here. You can also start manually and connect later.")}</p></div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                            {/* With the API key saved, the catalogue can come straight
                                over instead of being typed product by product. */}
                            {hasEasyOrdersKey && complete < steps.length && <EasyOrdersImportButton businessId={activeBusiness.id} className="min-h-11" onDone={() => setRevision(r => r + 1)} />}
                            <Button asChild variant="outline" className="min-h-11"><Link href="/settings?tab=platforms">{copy("اربط متجرك", "Connect your store")}</Link></Button>
                        </div>
                    </div>
                </CardContent>
            </Card>}
            <section className="space-y-3" aria-labelledby="daily-tasks-title">
                <h2 id="daily-tasks-title" className="text-xl font-semibold">{copy("عايز تعمل إيه دلوقتي؟", "What do you need to do?")}</h2>
                <div className="grid gap-3 sm:grid-cols-2">{tasks.map(task => <Link key={task.href} href={task.href} className="rounded-xl border bg-card p-5 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"><h3 className="font-semibold">{task.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{task.description}</p><span className="mt-3 inline-flex items-center text-sm font-medium text-primary">{copy("افتح المهمة", "Open task")}<ArrowRight className="ms-2 h-4 w-4 rtl:rotate-180" /></span></Link>)}</div>
                {tasks.length === 0 && <p className="text-sm text-muted-foreground">{copy("اطلب من صاحب المتجر يحدد الصفحات المتاحة ليك من إعدادات الفريق.", "Ask your store owner to assign your pages in Team settings.")}</p>}
            </section>
            <Button asChild variant="outline" className="min-h-11"><Link href="/guide"><BookOpen className="me-2 h-4 w-4" />{copy("افتح دليل الاستخدام", "Open the user guide")}</Link></Button>
        </div>
    );
}
