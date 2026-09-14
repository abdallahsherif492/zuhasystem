"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
    fetchRepeatCandidates, findRepeats, phoneKeys,
    type RepeatCandidate, type RepeatInfo, type RepeatSubject,
} from "@/lib/orders/repeat-orders";

/**
 * Related orders for whatever is on screen, keyed by order id.
 *
 * Refetches when the set of orders or their numbers change, not on every edit
 * to a card: the pages hand this a fresh array on each keystroke.
 */
export function useRepeatOrders(
    businessId: string | undefined,
    subjects: RepeatSubject[],
): Map<string, RepeatInfo> {
    const signature = useMemo(
        () => subjects.map(s => `${s.id}:${phoneKeys(s.customer_info).join("|")}`).sort().join(","),
        [subjects],
    );
    const [candidates, setCandidates] = useState<RepeatCandidate[]>([]);

    useEffect(() => {
        if (!businessId || !signature) return;
        let cancelled = false;
        fetchRepeatCandidates(supabase, businessId, subjects)
            .then(rows => { if (!cancelled) setCandidates(rows); })
            .catch(err => console.error("Repeat orders lookup failed:", err));
        return () => { cancelled = true; };
        // subjects is read through signature, which is what decides a refetch.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [businessId, signature]);

    return useMemo(() => findRepeats(subjects, candidates), [subjects, candidates]);
}
