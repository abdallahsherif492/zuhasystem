"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Clock, Loader2, LogOut } from "lucide-react";

export function ShiftTracker() {
    const { activeBusiness, shiftStart, shiftEnd } = useBusiness();
    const [activeShift, setActiveShift] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [workingTime, setWorkingTime] = useState("");

    useEffect(() => {
        if (activeBusiness) {
            checkActiveShift();
        }
    }, [activeBusiness]);

    // Timer effect
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (activeShift) {
            interval = setInterval(() => {
                const start = new Date(activeShift.clock_in).getTime();
                const now = new Date().getTime();
                const diff = now - start;

                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                
                setWorkingTime(`${hours}h ${minutes}m`);
            }, 60000); // Update every minute

            // Initial calculation
            const start = new Date(activeShift.clock_in).getTime();
            const now = new Date().getTime();
            const diff = now - start;
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            setWorkingTime(`${hours}h ${minutes}m`);
        }
        return () => clearInterval(interval);
    }, [activeShift]);

    async function checkActiveShift() {
        if (!activeBusiness) return;
        setLoading(true);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setLoading(false);
            return;
        }

        const { data, error } = await supabase
            .from("user_shifts")
            .select("*")
            .eq("business_id", activeBusiness.id)
            .eq("user_email", user.email)
            .eq("status", "active")
            .single();

        if (data) {
            setActiveShift(data);
        } else {
            setActiveShift(null);
        }
        setLoading(false);
    }

    async function handleClockIn() {
        if (!activeBusiness) return;
        setLoading(true);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { error } = await supabase
            .from("user_shifts")
            .insert({
                business_id: activeBusiness.id,
                user_email: user.email,
                clock_in: new Date().toISOString(),
                status: "active"
            });

        if (error) {
            toast.error("Failed to clock in: " + error.message);
            setLoading(false);
        } else {
            toast.success("Clocked in successfully!");
            checkActiveShift();
        }
    }

    async function handleClockOut() {
        if (!activeShift) return;
        setLoading(true);

        const { error } = await supabase
            .from("user_shifts")
            .update({
                clock_out: new Date().toISOString(),
                status: "completed"
            })
            .eq("id", activeShift.id);

        if (error) {
            toast.error("Failed to clock out: " + error.message);
            setLoading(false);
        } else {
            toast.success("Clocked out successfully!");
            setActiveShift(null);
            setLoading(false);
        }
    }

    if (!activeBusiness) return null;

    if (loading) {
        return (
            <Button variant="outline" size="sm" disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
            </Button>
        );
    }

    return (
        <div className="flex flex-col md:flex-row items-end md:items-center gap-2">
            {shiftStart && shiftEnd && (
                <div className="text-xs text-muted-foreground mr-2 hidden lg:block">
                    Expected Shift: {shiftStart} - {shiftEnd}
                </div>
            )}
            
            {activeShift ? (
                <div className="flex items-center gap-2">
                    <div className="text-sm text-emerald-600 font-medium flex items-center bg-emerald-50 px-3 py-1.5 rounded-md dark:bg-emerald-950 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                        <Clock className="mr-2 h-4 w-4 animate-pulse" />
                        {workingTime || "Just started"}
                    </div>
                    <Button variant="destructive" size="sm" onClick={handleClockOut}>
                        <LogOut className="mr-2 h-4 w-4" /> Clock Out
                    </Button>
                </div>
            ) : (
                <Button variant="default" size="sm" onClick={handleClockIn} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Clock className="mr-2 h-4 w-4" /> Clock In
                </Button>
            )}
        </div>
    );
}
