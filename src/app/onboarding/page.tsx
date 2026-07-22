"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Store, CheckCircle2, LogOut, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";

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
        localStorage.setItem('skipOnboarding', 'true');
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

            // 1. Create the business
            const insertData: any = {
                name: businessName,
                subscription_status: "trialing",
                trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
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
            localStorage.setItem("activeBusinessId", business.id);

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
            <div className="flex min-h-screen items-center justify-center bg-muted/40">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
            <div className="w-full max-w-lg">
                <div className="flex justify-center mb-8">
                    <div className="relative h-16 w-40">
                        <Image
                            src="/logo.png"
                            alt="eCommerx Logo"
                            fill
                            className="object-contain"
                        />
                    </div>
                </div>

                <Card className="border-2 shadow-lg">
                    <CardHeader className="text-center">
                        <div className="mx-auto bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mb-4">
                            <Store className="h-8 w-8 text-primary" />
                        </div>
                        <CardTitle className="text-2xl">Create your Business Profile</CardTitle>
                        <CardDescription className="text-base mt-2">
                            Welcome! Let's get your store set up so you can start managing orders and inventory.
                        </CardDescription>
                    </CardHeader>
                    
                    <form onSubmit={handleCreateBusiness}>
                        <CardContent className="space-y-4">
                            {error && (
                                <Alert variant="destructive">
                                    <AlertTitle>Error</AlertTitle>
                                    <AlertDescription>{error}</AlertDescription>
                                </Alert>
                            )}
                            
                            <div className="space-y-2">
                                <Label htmlFor="businessName" className="text-base">Business / Brand Name</Label>
                                <Input
                                    id="businessName"
                                    placeholder="e.g. Acme Corp or Fashion Store"
                                    value={businessName}
                                    onChange={(e) => setBusinessName(e.target.value)}
                                    required
                                    className="h-12 text-lg"
                                />
                            </div>

                            <div className="bg-muted/50 p-4 rounded-lg mt-6">
                                <h4 className="font-semibold text-sm mb-2">What happens next?</h4>
                                <ul className="space-y-2 text-sm text-muted-foreground">
                                    <li className="flex items-center gap-2">
                                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                                        14-Day Free Trial activated instantly
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                                        Full access to all modules and insights
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                                        Add unlimited team members
                                    </li>
                                </ul>
                            </div>
                        </CardContent>
                        
                        
                        <CardFooter className="flex flex-col gap-3">
                            <Button type="submit" className="w-full h-12 text-lg" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                                Launch My Business
                            </Button>
                            
                            <div className="flex gap-2 w-full mt-2">
                                <Button type="button" variant="outline" className="flex-1" onClick={handleSkip} disabled={loading}>
                                    Skip to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                                <Button type="button" variant="ghost" className="flex-none text-red-600 hover:text-red-700 hover:bg-red-50" onClick={handleLogout} disabled={loading}>
                                    <LogOut className="h-5 w-5" />
                                </Button>
                            </div>
                        </CardFooter>

                    </form>
                </Card>
            </div>
        </div>
    );
}
