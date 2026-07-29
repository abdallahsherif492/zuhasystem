"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Store, CheckCircle2, LogOut, ArrowRight, Package, Truck, BarChart3, Wallet, Link as LinkIcon } from "lucide-react";
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

    const handleSkip = () => {
        safeLocal.set('skipOnboarding', 'true');
        window.location.href = "/dashboard";
    };

    const handleCreateBusiness = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        if (!userEmail) {
            setError("User email not found. Please log in again.");
            setLoading(false);
            return;
        }

        try {
            const planId = new URLSearchParams(window.location.search).get('plan');

            
            // Check quota before creating
            const { data: userPerms } = await supabase
                .from('user_permissions')
                .select('max_businesses')
                .eq('email', userEmail)
                .single();

            const maxBusinesses = userPerms?.max_businesses || 1;

            // Check current owned businesses
            const { count: ownedCount } = await supabase
                .from('business_users')
                .select('*', { count: 'exact', head: true })
                .eq('user_email', userEmail)
                .eq('role', 'owner');

            if (ownedCount !== null && ownedCount >= maxBusinesses) {
                setError(`You have reached the maximum limit of ${maxBusinesses} business profile(s) allowed for your account. Please contact support or upgrade.`);
                setLoading(false);
                return;
            }

            // 1. Create the business (Trigger in DB handles 1-Month Free Trial automatically)
            const insertData: any = {
                name: businessName,
                subscription_status: "trial",
            };

            if (planId) {
                insertData.plan_id = planId;
            }

            const { data: business, error: businessError } = await supabase
                .from("businesses")
                .insert(insertData)
                .select("id")
                .single();

            if (businessError) throw businessError;

            // 2. Link user as owner
            const { error: linkError } = await supabase
                .from("business_users")
                .insert({
                    business_id: business.id,
                    user_email: userEmail,
                    role: "owner"
                });

            if (linkError) throw linkError;

            // 3. Set Active Business ID in localStorage
            safeLocal.set("activeBusinessId", business.id);

            // 4. Force a hard reload to the dashboard so Context picks it up
            window.location.href = "/";
            
        } catch (err: any) {
            console.error("Onboarding error:", err);
            setError(err.message || "Failed to create business profile.");
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
        <div className="flex min-h-screen bg-[#F8FAFC]">
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
                            Grow your business <br/>
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-200 to-white">with eCommerx</span>
                        </motion.h1>
                        
                        <div className="space-y-4 mt-8">
                            {features.map((feature, idx) => (
                                <motion.div 
                                    key={idx}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.5, delay: idx * 0.1 + 0.3 }}
                                    className="flex items-center gap-4 bg-white/10 backdrop-blur-md px-6 py-4 rounded-xl border border-white/10 shadow-lg"
                                    dir="rtl"
                                >
                                    <feature.icon className="h-6 w-6 text-indigo-300" />
                                    <span className="text-lg font-medium">{feature.text}</span>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </div>
                
                <div className="relative z-10 text-white/60 text-sm">
                    © {new Date().getFullYear()} eCommerx. All rights reserved.
                </div>
            </div>

            {/* Right Panel - Form */}
            <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12 relative">
                {/* Mobile Logo */}
                <div className="absolute top-6 left-6 lg:hidden">
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
                                    Welcome to eCommerx
                                </CardTitle>
                                <CardDescription className="text-base mt-3 text-slate-500">
                                    Set up your store profile to start managing orders and inventory
                                </CardDescription>
                            </CardHeader>
                            
                            <form onSubmit={handleCreateBusiness}>
                                <CardContent className="space-y-6 pt-6">
                                    {error && (
                                        <Alert variant="destructive" className="bg-red-50 border-red-200 text-red-800">
                                            <AlertTitle>Error</AlertTitle>
                                            <AlertDescription>{error}</AlertDescription>
                                        </Alert>
                                    )}
                                    
                                    <div className="space-y-3">
                                        <Label htmlFor="businessName" className="text-sm font-semibold text-slate-700">Business / Brand Name</Label>
                                        <Input
                                            id="businessName"
                                            placeholder="e.g. Acme Corp or Fashion Store"
                                            value={businessName}
                                            onChange={(e) => setBusinessName(e.target.value)}
                                            required
                                            className="h-12 text-base bg-white border-slate-200 focus-visible:ring-indigo-500 rounded-xl"
                                        />
                                    </div>

                                    <div className="bg-indigo-50/50 border border-indigo-100 p-5 rounded-xl space-y-3">
                                        <h4 className="font-semibold text-sm text-indigo-900">What happens next?</h4>
                                        <ul className="space-y-2.5 text-sm text-slate-600">
                                            <li className="flex items-center gap-3">
                                                <CheckCircle2 className="h-5 w-5 text-indigo-600" />
                                                <span className="font-medium">شهر كامل مجاناً - 1 Month Free Trial</span>
                                            </li>
                                            <li className="flex items-center gap-3">
                                                <CheckCircle2 className="h-5 w-5 text-indigo-600" />
                                                <span>Full access to all modules and insights</span>
                                            </li>
                                            <li className="flex items-center gap-3">
                                                <CheckCircle2 className="h-5 w-5 text-indigo-600" />
                                                <span>Add unlimited team members</span>
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
                                        Launch My Business
                                    </Button>
                                    
                                    <div className="flex gap-3 w-full mt-2">
                                        <Button 
                                            type="button" 
                                            variant="outline" 
                                            className="flex-1 h-11 border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 rounded-xl" 
                                            onClick={handleSkip} 
                                            disabled={loading}
                                        >
                                            Skip to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
                                        </Button>
                                        <Button 
                                            type="button" 
                                            variant="ghost" 
                                            className="flex-none h-11 w-11 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl" 
                                            onClick={handleLogout} 
                                            disabled={loading}
                                            title="Logout"
                                        >
                                            <LogOut className="h-5 w-5" />
                                        </Button>
                                    </div>
                                </CardFooter>
                            </form>
                        </Card>
                    </motion.div>
                </div>
            </div>
        </div>
    );
}
