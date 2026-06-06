"use client";

import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";


export function LogoutButton({ className, variant = "ghost", size }: { className?: string, variant?: any, size?: any }) {
    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
    };

    return (
        <Button variant={variant} size={size} onClick={handleLogout} className={className || "text-red-600 hover:text-red-700 hover:bg-red-50"}>
            <LogOut className="mr-2 h-4 w-4" /> Log Out
        </Button>
    );
}
