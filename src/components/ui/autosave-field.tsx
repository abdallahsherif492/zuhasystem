"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type BaseProps = Omit<
    React.ComponentProps<"input"> & React.ComponentProps<"textarea">,
    "value" | "onChange" | "onBlur"
>;

interface AutosaveFieldProps extends BaseProps {
    /** The saved value. Adopted only while the field is idle — see below. */
    value: string;
    /** Called with the final text once typing pauses, or immediately on blur. */
    onCommit: (next: string) => void;
    multiline?: boolean;
    /** Quiet period before saving. */
    delay?: number;
}

/**
 * A text field that holds its own draft and saves itself after a pause.
 *
 * Written for the platform-orders review screen, where the address and notes
 * fields were effectively impossible to type in. Each field was bound straight
 * to the page's `orders` array, so a single keystroke rebuilt that array and
 * re-rendered every open order card — 53 of them on the busiest account, each
 * carrying four inputs, a 27-option governorate select and a product picker.
 * The same keystroke also fired its own PATCH to Supabase. On a phone the
 * character showed up long after it was typed, if it survived at all.
 *
 * Keeping the draft here means a keystroke re-renders one input and nothing
 * else, and the page state and the database are touched once per pause instead
 * of once per character.
 */
export function AutosaveField({
    value,
    onCommit,
    multiline = false,
    delay = 600,
    ...rest
}: AutosaveFieldProps) {
    const [draft, setDraft] = useState(value);
    // True between the first keystroke and the commit that follows it.
    const dirty = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Read inside the timeout so a stale closure can't call an old handler.
    const commitRef = useRef(onCommit);
    commitRef.current = onCommit;

    // Accept a new saved value only when the user is not mid-edit. Without this
    // guard, our own save coming back through props would rewrite the box under
    // the cursor and drop whatever was typed while it was in flight.
    useEffect(() => {
        if (!dirty.current) setDraft(value);
    }, [value]);

    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            const next = e.target.value;
            dirty.current = true;
            setDraft(next);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
                dirty.current = false;
                commitRef.current(next);
            }, delay);
        },
        [delay]
    );

    // Leaving the field saves at once. Blur fires before the click that caused
    // it, so moving an order on from here still carries the last edit.
    const handleBlur = useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        if (!dirty.current) return;
        dirty.current = false;
        commitRef.current(draft);
    }, [draft]);

    const Field = multiline ? Textarea : Input;

    return (
        <Field
            {...(rest as any)}
            value={draft}
            onChange={handleChange}
            onBlur={handleBlur}
        />
    );
}
