"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Store, CheckCircle2, LogOut, Package, BarChart3, Wallet, Link as LinkIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { safeLocal } from "@/lib/safe-storage";
import { motion } from "framer-motion";

const features = [
    { icon: Package, text: "إدارة الأوردرات والشحن" },
    { icon: Store, text: "متابعة المخزون والمنتجات" },
    { icon: LinkIcon, text: "ربط مع شركات الشحن ومنصات البيع" },
    { icon: BarChart3, text: "تقارير وتحليلات متقدمة" },
    { icon: Wallet, text: "إدارة الحسابات والمصروفات" }
];

/**
 * Turn a Supabase/Postgres failure into something a merchant can act on.
 *
 * This step used to render `err.message` directly, so when RLS was blocking
 * business creation every visitor saw "new row violates row-level security
 * policy for table businesses" — English, meaningless to them, and impossible
 * to report usefully. Nobody told us; they just left.
 */
function describeError(err: any): string {
    const raw = String(err?.message || "");
    const code = String(err?.code || "");

    // Quota, raised by create_business_with_owner()
    if (raw.includes("maximum of")) {
        return "وصلت للحد الأقصى لعدد المتاجر المسموح بها لحسابك. كلّمنا لو محتاج تزوّده.";
    }
    if (code === "28000" || raw.includes("signed in")) {
        return "جلستك انتهت. سجّل دخول تاني وجرّب من الأوسع.";
    }
    if (code === "42501" || raw.toLowerCase().includes("row-level security")) {
        return "معندناش صلاحية ننشئ المتجر دلوقتي. المشكلة عندنا إحنا مش عندك — كلّمنا وهنظبطها فوراً.";
    }
    if (code === "PGRST202" || raw.includes("Could not find the function")) {
        return "في خلل مؤقت عندنا في السيرفر. جرّب كمان شوية أو كلّمنا.";
    }
    if (raw.includes("Failed to fetch") || raw.includes("NetworkError") || raw.includes("Load failed")) {
        return "النت فصل. اتأكد من اتصالك وجرّب تاني.";
    }
    return "حصلت مشكلة وإحنا بننشئ المتجر. جرّب تاني، ولو فضلت كلّمنا وهنحلها معاك.";
}

export default function OnboardingPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [businessName, setBusinessName] = useState("");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const checkUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }
            setUserEmail(user.email ?? null);
            setInitializing(false);
        };
        checkUser();
    }, [router]);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
    };

    const handleCreateBusiness = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        if (!userEmail) {
            setError("مش لاقيين حسابك. سجّل دخول تاني من فضلك.");
            setLoading(false);
            return;
        }

        if (!businessName.trim()) {
            setError("اكتب اسم البراند أو المتجر الأول.");
            setLoading(false);
            return;
        }

        try {
            const planId = new URLSearchParams(window.location.search).get('plan');

            
            // Creating the business and linking the owner happen together in
            // create_business_with_owner(). Doing it from here as two inserts
            // could not work: RLS blocks the insert, RETURNING cannot see the
            // new row until the owner link exists, and a failure between the
            // two left a business with no members. The quota is checked inside
            // the function too, so it cannot be skipped via the REST API.
            const { data: newBusinessId, error: createError } = await supabase
                .rpc("create_business_with_owner", {
                    p_name: businessName,
                    p_plan_id: planId || null,
                });

            if (createError) throw createError;
            if (!newBusinessId) throw new Error("__generic__");

            safeLocal.set("activeBusinessId", newBusinessId as string);

            // Force a hard reload to the dashboard so Context picks it up
            window.location.href = "/";
            
        } catch (err: any) {
            console.error("Onboarding error:", err);
            setError(describeError(err));
            setLoading(false);
        }
    };

    if (initializing) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
                <Loader2 className="h-12 w-12 animate-spin text-indigo-600" />
            </div>
        );
    }

    return (
        <div className="flex min-h-screen bg-[#F8FAFC]" dir="rtl">
            {/* Left Panel - Branding & Features (Hidden on mobile) */}
            <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-gradient-to-br from-[#0F172A] to-[#6366F1] text-white relative overflow-hidden">
                <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))] opacity-20"></div>
                
                <div className="relative z-10 flex flex-col gap-12">
                    <div className="relative h-12 w-40">
                        <Image
                            src="/logo.png"
                            alt="eCommerx Logo"
                            fill
                            className="object-contain brightness-0 invert"
                        />
                    </div>
                    
                    <div className="space-y-6 mt-12">
                        <motion.h1 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                            className="text-4xl font-bold leading-tight"
                        >
                            كبّر تجارتك <br/>
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-200 to-white">مع eCommerx</span>
                        </motion.h1>
                        
                        <div className="space-y-4 mt-8">
                            {features.map((feature, idx) => (
                                <motion.div 
                                    key={idx}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.5, delay: idx * 0.1 + 0.3 }}
                                    className="flex items-center gap-4 bg-white/10 backdrop-blur-md px-6 py-4 rounded-xl border border-white/10 shadow-lg"
                                >
                                    <feature.icon className="h-6 w-6 text-indigo-300" />
                                    <span className="text-lg font-medium">{feature.text}</span>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </div>
                
                <div className="relative z-10 text-white/60 text-sm">
                    © {new Date().getFullYear()} eCommerx — جميع الحقوق محفوظة.
                </div>
            </div>

            {/* Right Panel - Form */}
            <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12 relative">
                {/* Mobile Logo */}
                <div className="absolute top-6 right-6 lg:hidden">
                    <div className="relative h-10 w-32">
                        <Image
                            src="/logo.png"
                            alt="eCommerx Logo"
                            fill
                            className="object-contain"
                        />
                    </div>
                </div>

                <div className="w-full max-w-md">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                    >
                        <Card className="border-0 shadow-2xl bg-white/70 backdrop-blur-xl">
                            <CardHeader className="text-center pb-2">
                                <div className="mx-auto bg-gradient-to-br from-indigo-50 to-indigo-100 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 shadow-sm border border-indigo-100">
                                    <Store className="h-8 w-8 text-indigo-600" />
                                </div>
                                <CardTitle className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700">
                                    خطوة واحدة وتبدأ 🚀
                                </CardTitle>
                                <CardDescription className="text-base mt-3 text-slate-500">
                                    اكتب اسم متجرك بس، وهنجهّزلك السيستم كامل في ثانية
                                </CardDescription>
                            </CardHeader>
                            
                            <form onSubmit={handleCreateBusiness}>
                                <CardContent className="space-y-6 pt-6">
                                    {error && (
                                        <Alert variant="destructive" className="bg-red-50 border-red-200 text-red-800">
                                            <AlertTitle className="font-bold">معلش، في مشكلة</AlertTitle>
                                            <AlertDescription>{error}</AlertDescription>
                                        </Alert>
                                    )}
                                    
                                    <div className="space-y-3">
                                        <Label htmlFor="businessName" className="text-sm font-semibold text-slate-700">اسم البراند أو المتجر</Label>
                                        <Input
                                            id="businessName"
                                            placeholder="مثال: زُهى ستور"
                                            value={businessName}
                                            onChange={(e) => setBusinessName(e.target.value)}
                                            required
                                            className="h-12 text-base bg-white border-slate-200 focus-visible:ring-indigo-500 rounded-xl"
                                        />
                                    </div>

                                    <div className="bg-indigo-50/50 border border-indigo-100 p-5 rounded-xl space-y-3">
                                        <h4 className="font-semibold text-sm text-indigo-900">هيحصل إيه بعد كده؟</h4>
                                        <ul className="space-y-2.5 text-sm text-slate-600">
                                            <li className="flex items-center gap-3">
                                                <CheckCircle2 className="h-5 w-5 text-indigo-600" />
                                                <span className="font-medium">شهر كامل مجاني — من غير كريديت كارد</span>
                                            </li>
                                            <li className="flex items-center gap-3">
                                                <CheckCircle2 className="h-5 w-5 text-indigo-600" />
                                                <span>كل مميزات السيستم مفتوحة من غير حدود</span>
                                            </li>
                                            <li className="flex items-center gap-3">
                                                <CheckCircle2 className="h-5 w-5 text-indigo-600" />
                                                <span>ضيف فريقك وحدد صلاحيات كل واحد</span>
                                            </li>
                                        </ul>
                                    </div>
                                </CardContent>
                                
                                <CardFooter className="flex flex-col gap-4 pb-8">
                                    <Button 
                                        type="submit" 
                                        className="w-full h-12 text-base font-semibold bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-700 hover:to-indigo-600 text-white rounded-xl shadow-md transition-all hover:shadow-lg" 
                                        disabled={loading}
                                    >
                                        {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                                        يلا نبدأ
                                    </Button>
                                    
                                    {/*
                                      No "skip" here on purpose. It used to send
                                      people to an empty dashboard and store a
                                      flag so they were never asked again —
                                      quietly stranding anyone who clicked it.
                                      The dashboard is unusable without a
                                      business, so there is nothing to skip to.
                                    */}
                                    <p className="text-xs text-center text-slate-400 mt-1">
                                        تقدر تغيّر اسم المتجر وكل الإعدادات في أي وقت بعدين
                                    </p>

                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-10 text-sm text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl"
                                        onClick={handleLogout}
                                        disabled={loading}
                                    >
                                        <LogOut className="h-4 w-4 ml-2" />
                                        تسجيل الخروج
                                    </Button>
                                </CardFooter>
                            </form>
                        </Card>
                    </motion.div>
                </div>
            </div>
        </div>
    );
}
