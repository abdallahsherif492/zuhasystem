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

export default function RegisterPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    
    // Form State
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [dob, setDob] = useState("");
    const [password, setPassword] = useState("");
    
    const [error, setError] = useState<string | null>(null);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName,
                        phone: phone,
                        date_of_birth: dob,
                    }
                }
            });
            
            if (error) throw error;
            
            // Redirect to onboarding after successful registration
            window.location.href = "/onboarding";
        } catch (err: any) {
            console.error("Registration error:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen bg-background">
            {/* Left Side - Form */}
            <div className="flex flex-1 flex-col justify-center px-4 sm:px-6 lg:flex-none lg:w-[480px] lg:px-20 xl:px-24 py-12 overflow-y-auto">
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
                            Create your account
                        </h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Start your 14-day free trial. No credit card required.
                        </p>
                    </div>

                    <div className="mt-8">
                        <form onSubmit={handleRegister} className="space-y-5">
                            {error && (
                                <Alert variant="destructive">
                                    <AlertTitle>Error</AlertTitle>
                                    <AlertDescription>{error}</AlertDescription>
                                </Alert>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="fullName">Full Name</Label>
                                <Input
                                    id="fullName"
                                    name="fullName"
                                    type="text"
                                    required
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    className="h-11"
                                    placeholder="John Doe"
                                />
                            </div>

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
                                    placeholder="john@example.com"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="phone">Phone Number</Label>
                                    <Input
                                        id="phone"
                                        name="phone"
                                        type="tel"
                                        required
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        className="h-11"
                                        placeholder="010..."
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="dob">Date of Birth</Label>
                                    <Input
                                        id="dob"
                                        name="dob"
                                        type="date"
                                        required
                                        value={dob}
                                        onChange={(e) => setDob(e.target.value)}
                                        className="h-11"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password">Password</Label>
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
                                {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Create Account"}
                                {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                            </Button>
                        </form>
                    </div>

                    <p className="mt-10 text-center text-sm text-muted-foreground pb-8">
                        Already have an account?{" "}
                        <Link href="/login" className="font-semibold leading-6 text-primary hover:text-primary/80">
                            Sign in here
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
                            Grow Your Business
                        </h1>
                        <p className="text-lg text-white/80 max-w-lg">
                            Join hundreds of e-commerce brands automating their daily operations, tracking inventory, and increasing profitability.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
