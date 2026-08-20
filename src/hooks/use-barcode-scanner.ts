"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Listens for a keyboard-wedge barcode scanner.
 *
 * The Syble XB-5066R, like most 1D HID scanners, is not a camera or a device
 * we talk to — it pretends to be a keyboard. It types the barcode's characters
 * and finishes with Enter. Nothing identifies it as a scanner, so the only way
 * to tell a scan from someone typing is the speed: a scanner emits characters
 * a few milliseconds apart, a person cannot.
 *
 * Hence the two rules below:
 *
 *   * characters more than `gapMs` apart are treated as a fresh start, so a
 *     half-typed word never gets glued onto the front of a real scan;
 *   * anything shorter than `minLength` on Enter is ignored, so a stray Return
 *     does not fire a lookup for "".
 *
 * Keystrokes are ignored entirely while a text field has focus. Someone typing
 * in the search box should get their letters, not have them swallowed — and a
 * scanner user is not focused in a field, which is why enabling scanner mode
 * blurs whatever was.
 */
interface Options {
    enabled: boolean;
    onScan: (code: string) => void;
    /** Max ms between keystrokes for them to count as one scan. */
    gapMs?: number;
    minLength?: number;
}

export function useBarcodeScanner({ enabled, onScan, gapMs = 120, minLength = 4 }: Options) {
    const buffer = useRef("");
    const lastKey = useRef(0);
    // Read through a ref so the listener does not need rebinding on every
    // render — re-attaching mid-scan would drop the characters already buffered.
    const onScanRef = useRef(onScan);
    onScanRef.current = onScan;

    useEffect(() => {
        if (!enabled) {
            buffer.current = "";
            return;
        }

        const isTextField = (el: Element | null) => {
            if (!el) return false;
            const tag = el.tagName;
            return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
                || (el as HTMLElement).isContentEditable;
        };

        const handler = (e: KeyboardEvent) => {
            if (isTextField(document.activeElement)) return;

            const now = Date.now();

            if (e.key === "Enter") {
                const code = buffer.current.trim();
                buffer.current = "";
                if (code.length >= minLength) {
                    // Stop the Return reaching anything that might act on it.
                    e.preventDefault();
                    onScanRef.current(code);
                }
                return;
            }

            // Modifiers, arrows, F-keys: not part of a barcode.
            if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

            if (now - lastKey.current > gapMs) buffer.current = "";
            lastKey.current = now;
            buffer.current += e.key;
        };

        window.addEventListener("keydown", handler, true);
        return () => window.removeEventListener("keydown", handler, true);
    }, [enabled, gapMs, minLength]);
}

/**
 * A short tone, so the packing desk knows the scan landed without looking up.
 *
 * Generated rather than loaded: an audio file would be another asset to ship
 * and another request to fail. Wrapped because browsers refuse to build an
 * AudioContext until the page has been interacted with, and a failed beep must
 * never take the scan down with it.
 */
export function useScanFeedback() {
    const ctxRef = useRef<AudioContext | null>(null);

    return useCallback((ok: boolean) => {
        try {
            if (!ctxRef.current) {
                const Ctor = window.AudioContext || (window as any).webkitAudioContext;
                if (!Ctor) return;
                ctxRef.current = new Ctor();
            }
            const ctx = ctxRef.current;
            if (ctx.state === "suspended") ctx.resume();

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            // A clean high blip for a hit, a lower buzz for a miss — different
            // enough to tell apart across a noisy room.
            osc.frequency.value = ok ? 1180 : 320;
            osc.type = ok ? "sine" : "square";
            gain.gain.setValueAtTime(0.0001, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.12 : 0.28));

            osc.start();
            osc.stop(ctx.currentTime + (ok ? 0.13 : 0.3));
        } catch {
            /* audio is a nicety; never let it break scanning */
        }
    }, []);
}
