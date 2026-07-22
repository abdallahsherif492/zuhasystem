"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ArrowRight, CheckCircle2 } from "lucide-react";

export default function ForgotPasswordPage() {
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            // Need to provide the redirect URL to where they can update the password
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/update-password`,
            });
            
            if (error) throw error;
            setSuccess(true);
        } catch (err: any) {
            console.error("Reset password error:", err);
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
                            Reset Password
                        </h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Enter your email address and we'll send you a link to reset your password.
                        </p>
                    </div>

                    <div className="mt-8">
                        {success ? (
                            <div className="bg-green-50 dark:bg-green-900/20 p-6 rounded-lg text-center border border-green-200 dark:border-green-800">
                                <CheckCircle2 className="mx-auto h-12 w-12 text-green-500 mb-4" />
                                <h3 className="text-lg font-medium text-green-800 dark:text-green-300">Check your email</h3>
                                <p className="mt-2 text-sm text-green-700 dark:text-green-400">
                                    We've sent a password reset link to {email}.
                                </p>
                                <Button className="mt-6 w-full" variant="outline" asChild>
                                    <Link href="/login">Return to login</Link>
                                </Button>
                            </div>
                        ) : (
                            <form onSubmit={handleReset} className="space-y-6">
                                {error && (
                                    <Alert variant="destructive">
                                        <AlertTitle>Error</AlertTitle>
                                        <AlertDescription>{error}</AlertDescription>
                                    </Alert>
                                )}

                                <div className="space-y-2">
                                    <Label htmlFor="email">Email address</Label>
                                    <Input
                                        id="email"
                                        name="email"
                                        type="email"
                                        autoComplete="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="h-11"
                                    />
                                </div>

                                <Button type="submit" className="w-full h-11 text-base font-medium" disabled={loading}>
                                    {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Send Reset Link"}
                                    {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                                </Button>
                            </form>
                        )}
                    </div>

                    {!success && (
                        <p className="mt-10 text-center text-sm text-muted-foreground">
                            Remember your password?{" "}
                            <Link href="/login" className="font-semibold leading-6 text-primary hover:text-primary/80">
                                Sign in here
                            </Link>
                        </p>
                    )}
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
