"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const UNASSIGNED = "__none__";

interface ClosedBySelectProps {
    businessId: string | undefined;
    value: string | null | undefined;
    onChange: (email: string | null) => void;
    label?: string;
    className?: string;
    /** Hide the label when the caller lays out its own. */
    bare?: boolean;
}

/**
 * Picks the moderator who confirmed and closed an order with the customer.
 *
 * Used from three places — creating an order, editing one, and reviewing a
 * platform order — because an order can be closed on any of those paths and
 * the league is only as honest as its least-covered entry point.
 *
 * Stores an email, matching orders.closed_by. Anyone in the business can be
 * chosen rather than only staff: owners take orders too, and a role filter
 * here would quietly drop their work from the standings.
 */
export function ClosedBySelect({
    businessId,
    value,
    onChange,
    label = "Closed by",
    className,
    bare = false,
}: ClosedBySelectProps) {
    const [members, setMembers] = useState<{ user_email: string; role: string }[]>([]);

    useEffect(() => {
        if (!businessId) return;
        let cancelled = false;
        (async () => {
            const { data } = await supabase
                .from("business_users")
                .select("user_email, role")
                .eq("business_id", businessId)
                .order("user_email");
            if (!cancelled && data) setMembers(data);
        })();
        return () => { cancelled = true; };
    }, [businessId]);

    // A previously-recorded moderator who has since left the team would
    // otherwise vanish from the dropdown and read as unassigned, so keep them
    // listed while their orders still reference them.
    const options = value && !members.some(m => m.user_email === value)
        ? [{ user_email: value, role: "former" }, ...members]
        : members;

    const control = (
        <Select
            value={value || UNASSIGNED}
            onValueChange={v => onChange(v === UNASSIGNED ? null : v)}
        >
            <SelectTrigger className={cn("w-full", className)}>
                <SelectValue placeholder="Not assigned" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={UNASSIGNED}>Not assigned</SelectItem>
                {options.map(m => (
                    <SelectItem key={m.user_email} value={m.user_email}>
                        {m.user_email}
                        {m.role === "former" && " (removed)"}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );

    if (bare) return control;

    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            {control}
        </div>
    );
}
