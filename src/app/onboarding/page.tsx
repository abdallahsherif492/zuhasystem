"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Store, CheckCircle2 } from "lucide-react";
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
            // 1. Create the business
            const { data: business, error: businessError } = await supabase
                .from("businesses")
                .insert({
                    name: businessName,
                    subscription_status: "trialing",
                    trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                })
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
                            alt="Zuha Logo"
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
                        
                        <CardFooter>
                            <Button type="submit" className="w-full h-12 text-lg" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                                Launch My Business
                            </Button>
                        </CardFooter>
                    </form>
                </Card>
            </div>
        </div>
    );
}
