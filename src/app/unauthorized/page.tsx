"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Loader2, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function UnauthorizedPage() {
    const [debugInfo, setDebugInfo] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
    };

    useEffect(() => {
        async function fetchDebugInfo() {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data, error } = await supabase
                    .from('user_permissions')
                    .select('*')
                    .eq('id', user.id)
                    .single();

                setDebugInfo({
                    email: user.email,
                    permissions_row: data || "Not Found",
                    error: error?.message || null
                });
            }
            setLoading(false);
        }
        fetchDebugInfo();
    }, []);

    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] space-y-6 text-center">
            <div className="bg-red-100 p-6 rounded-full">
                <ShieldAlert className="h-16 w-16 text-red-600" />
            </div>

            <div className="space-y-4 max-w-xl">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Access Denied</h1>
                <p className="text-muted-foreground text-lg">
                    You do not have permission to view this page. If you believe this is a mistake, your account might not be configured as a Super Admin yet.
                </p>

                {loading ? (
                    <div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : (
                    <div className="bg-muted p-4 rounded-lg text-left overflow-auto text-sm font-mono mt-4 text-red-800 border border-red-200">
                        {debugInfo?.error ? (
                            <p>Error checking permissions: {debugInfo.error}</p>
                        ) : (
                            <p>You do not have the required permissions assigned to your profile in this business.</p>
                        )}
                    </div>
                )}
            </div>

            <div className="flex gap-4 mt-4">
                <Link href="/">
                    <Button size="lg" variant="default">
                        Return to Dashboard
                    </Button>
                </Link>
                <Button size="lg" variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={handleLogout}>
                    <LogOut className="mr-2 h-5 w-5" /> Log Out
                </Button>
            </div>
        </div>
    );
}
