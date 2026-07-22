"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ArrowRight } from "lucide-react";

export default function UpdatePasswordPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);

    // After password reset email is clicked, Supabase auto-logs the user in (sets session in URL hash)
    // and we just need to call updateUser with the new password.
    
    useEffect(() => {
        // Optional: Check if we actually have a session or if we are in a recovery mode
        supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                console.log("Password recovery mode active");
            }
        });
    }, []);

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { error } = await supabase.auth.updateUser({
                password: password
            });
            
            if (error) throw error;
            
            // Password updated successfully, redirect to dashboard
            window.location.href = "/";
        } catch (err: any) {
            console.error("Update password error:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen bg-background">
            <div className="flex flex-1 flex-col justify-center px-4 sm:px-6 lg:flex-none lg:w-[480px] lg:px-20 xl:px-24">
                <div className="mx-auto w-full max-w-sm lg:w-96">
                    <div>
                        <div className="relative h-12 w-32 mb-8">
                            <Image src="/logo.png" alt="Zuha Logo" fill className="object-contain object-left" />
                        </div>
                        <h2 className="text-3xl font-bold tracking-tight text-foreground">
                            Update Password
                        </h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Please enter your new password below.
                        </p>
                    </div>

                    <div className="mt-8">
                        <form onSubmit={handleUpdate} className="space-y-6">
                            {error && (
                                <Alert variant="destructive">
                                    <AlertTitle>Error</AlertTitle>
                                    <AlertDescription>{error}</AlertDescription>
                                </Alert>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="password">New Password</Label>
                                <Input
                                    id="password"
                                    name="password"
                                    type="password"
                                    autoComplete="new-password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="h-11"
                                />
                            </div>

                            <Button type="submit" className="w-full h-11 text-base font-medium" disabled={loading}>
                                {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Update Password"}
                                {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                            </Button>
                        </form>
                    </div>
                </div>
            </div>

            <div className="relative hidden w-0 flex-1 lg:block">
                <div className="absolute inset-0 h-full w-full bg-gradient-to-br from-primary via-primary/80 to-primary/50 object-cover">
                    <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
                </div>
            </div>
        </div>
    );
}
