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
import { Loader2, ArrowRight } from "lucide-react";

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
            window.location.href = "/"; // Force hard redirect to re-evaluate context
        } catch (err: any) {
            console.error("Login error:", err);
            setError(err.message === "Invalid login credentials" ? "Invalid email or password." : err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen bg-background">
            {/* Left Side - Form */}
            <div className="flex flex-1 flex-col justify-center px-4 sm:px-6 lg:flex-none lg:w-[480px] lg:px-20 xl:px-24">
                <div className="mx-auto w-full max-w-sm lg:w-96">
                    <div>
                        <div className="relative h-12 w-32 mb-8">
                            <Image
                                src="/logo.png"
                                alt="Zuha Logo"
                                fill
                                className="object-contain object-left"
                            />
                        </div>
                        <h2 className="text-3xl font-bold tracking-tight text-foreground">
                            Welcome back
                        </h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Sign in to your account to manage your business.
                        </p>
                    </div>

                    <div className="mt-8">
                        <form onSubmit={handleLogin} className="space-y-6">
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

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="password">Password</Label>
                                    <div className="text-sm">
                                        <Link href="/forgot-password" className="font-semibold text-primary hover:text-primary/80">
                                            Forgot password?
                                        </Link>
                                    </div>
                                </div>
                                <Input
                                    id="password"
                                    name="password"
                                    type="password"
                                    autoComplete="current-password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="h-11"
                                />
                            </div>

                            <Button type="submit" className="w-full h-11 text-base font-medium" disabled={loading}>
                                {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Sign in"}
                                {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                            </Button>
                        </form>
                    </div>

                    <p className="mt-10 text-center text-sm text-muted-foreground">
                        Don't have an account?{" "}
                        <Link href="/register" className="font-semibold leading-6 text-primary hover:text-primary/80">
                            Create your account
                        </Link>
                    </p>
                </div>
            </div>

            {/* Right Side - Image/Gradient */}
            <div className="relative hidden w-0 flex-1 lg:block">
                <div className="absolute inset-0 h-full w-full bg-gradient-to-br from-indigo-600 via-purple-700 to-blue-900 object-cover">
                    <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
                    <div className="flex flex-col items-center justify-center h-full p-12 text-white text-center">
                        <h1 className="text-5xl font-extrabold tracking-tight mb-4">
                            The Ultimate Operations Hub
                        </h1>
                        <p className="text-lg text-white/80 max-w-lg">
                            Manage logistics, insights, inventory, and accounting across all your e-commerce brands from one powerful platform.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
