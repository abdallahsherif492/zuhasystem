"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ArrowLeft, Mail, Lock } from "lucide-react";
import { motion } from "framer-motion";

export default function LoginPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            if (error) throw error;
            window.location.href = "/dashboard"; // Redirect to dashboard explicitly after login
        } catch (err: any) {
            console.error("Login error:", err);
            setError(err.message === "Invalid login credentials" ? "البريد الإلكتروني أو كلمة المرور غير صحيحة." : err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen bg-slate-50 font-sans" dir="rtl">
            {/* Right Side - Form (appears on right in RTL) */}
            <div className="flex flex-1 flex-col justify-center px-8 sm:px-12 lg:flex-none lg:w-[550px] xl:w-[600px] lg:px-24 bg-white relative z-10 shadow-2xl border-l border-slate-100">
                <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5 }}
                    className="mx-auto w-full max-w-sm lg:max-w-md"
                >
                    <div className="text-right">
                        <Link href="/landing" className="inline-block relative h-12 w-40 mb-10 transition-transform hover:scale-105">
                            <Image
                                src="/logo.png"
                                alt="eCommerx Logo"
                                fill
                                className="object-contain object-right"
                            />
                        </Link>
                        <h2 className="text-3xl font-black tracking-tight text-slate-900">
                            أهلاً بيك من جديد! 👋
                        </h2>
                        <p className="mt-3 text-base text-slate-500 font-medium">
                            سجل دخول لحسابك وتابع أرقامك وشغلك بكل سهولة.
                        </p>
                    </div>

                    <div className="mt-10">
                        <form onSubmit={handleLogin} className="space-y-6">
                            {error && (
                                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
                                    <Alert variant="destructive" className="bg-red-50 border-red-200 text-red-800">
                                        <AlertTitle className="text-right font-bold">خطأ في الدخول</AlertTitle>
                                        <AlertDescription className="text-right mt-1">{error}</AlertDescription>
                                    </Alert>
                                </motion.div>
                            )}

                            <div className="space-y-3">
                                <Label htmlFor="email" className="text-slate-700 font-bold text-sm block text-right">البريد الإلكتروني</Label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                        <Mail className="h-5 w-5 text-slate-400" />
                                    </div>
                                    <Input
                                        id="email"
                                        name="email"
                                        type="email"
                                        autoComplete="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="h-12 pr-10 pl-4 bg-slate-50 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 rounded-xl text-right transition-all"
                                        placeholder="name@company.com"
                                        dir="ltr"
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between flex-row-reverse">
                                    <Label htmlFor="password" className="text-slate-700 font-bold text-sm">كلمة المرور</Label>
                                    <div className="text-sm">
                                        <Link href="/forgot-password" className="font-semibold text-indigo-600 hover:text-indigo-500 transition-colors">
                                            نسيت كلمة المرور؟
                                        </Link>
                                    </div>
                                </div>
                                <div className="relative">
                                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                        <Lock className="h-5 w-5 text-slate-400" />
                                    </div>
                                    <Input
                                        id="password"
                                        name="password"
                                        type="password"
                                        autoComplete="current-password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="h-12 pr-10 pl-4 bg-slate-50 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 rounded-xl text-right transition-all"
                                        placeholder="••••••••"
                                        dir="ltr"
                                    />
                                </div>
                            </div>

                            <Button 
                                type="submit" 
                                className="w-full h-12 text-lg font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-200 transition-all hover:scale-[1.02] mt-4" 
                                disabled={loading}
                            >
                                {loading ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : "تسجيل الدخول"}
                                {!loading && <ArrowLeft className="mr-2 h-5 w-5" />}
                            </Button>
                        </form>
                    </div>

                    <p className="mt-10 text-center text-sm text-slate-500 font-medium">
                        معندكش حساب؟{" "}
                        <Link href="/register" className="font-bold leading-6 text-indigo-600 hover:text-indigo-500 transition-colors">
                            أنشئ حسابك دلوقتي
                        </Link>
                    </p>
                </motion.div>
            </div>

            {/* Left Side - Image/Gradient (appears on left in RTL) */}
            <div className="relative hidden w-0 flex-1 lg:block overflow-hidden bg-slate-900">
                {/* Dynamic animated background */}
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 object-cover">
                    <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-30 mix-blend-overlay"></div>
                    
                    {/* Glowing Orbs */}
                    <motion.div 
                        animate={{ 
                            scale: [1, 1.2, 1],
                            opacity: [0.3, 0.5, 0.3],
                        }}
                        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute top-1/4 -right-20 w-96 h-96 bg-indigo-600 rounded-full mix-blend-multiply filter blur-3xl opacity-30" 
                    />
                    <motion.div 
                        animate={{ 
                            scale: [1, 1.3, 1],
                            opacity: [0.2, 0.4, 0.2],
                        }}
                        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
                        className="absolute bottom-1/4 -left-20 w-[500px] h-[500px] bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20" 
                    />

                    <div className="flex flex-col items-center justify-center h-full p-12 text-white text-center relative z-10">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.7, delay: 0.2 }}
                            className="max-w-2xl"
                        >
                            <div className="inline-flex items-center justify-center p-3 bg-white/10 rounded-2xl backdrop-blur-md border border-white/10 mb-8 shadow-2xl">
                                <Image
                                    src="/logo.png"
                                    alt="Icon"
                                    width={40}
                                    height={40}
                                    className="opacity-90 drop-shadow-md brightness-0 invert"
                                />
                            </div>
                            <h1 className="text-5xl lg:text-6xl font-black tracking-tight mb-6 leading-tight drop-shadow-lg" style={{ lineHeight: "1.3" }}>
                                الحل الجذري لإدارة تجارتك
                            </h1>
                            <p className="text-xl text-indigo-100 max-w-xl mx-auto leading-relaxed font-medium">
                                دير كل عملياتك، الشحن، المخزون، الحسابات، وتحليلات مبيعاتك لكل برانداتك من مكان واحد بكل سهولة.
                            </p>
                        </motion.div>
                        
                        {/* Interactive abstract elements */}
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 1, delay: 0.5 }}
                            className="absolute bottom-10 left-10 right-10 flex justify-between items-end opacity-50 pointer-events-none"
                        >
                            <div className="space-y-2">
                                <div className="h-1 w-24 bg-white/20 rounded-full"></div>
                                <div className="h-1 w-16 bg-white/20 rounded-full"></div>
                            </div>
                            <div className="space-y-2 flex flex-col items-end">
                                <div className="h-1 w-32 bg-indigo-400/30 rounded-full"></div>
                                <div className="h-1 w-20 bg-indigo-400/30 rounded-full"></div>
                            </div>
                        </motion.div>
                    </div>
                </div>
            </div>
        </div>
    );
}
