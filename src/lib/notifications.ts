/**
 * Audio and Desktop Notification Utilities for eCommerx Support Chat
 */

// Play a pleasant dual-tone audio chime using Web Audio API (Zero external file dependency)
export function playNotificationSound() {
    if (typeof window === 'undefined') return;
    try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;

        const ctx = new AudioContextClass();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc2.type = 'sine';

        // E5 (659.25Hz) -> B5 (987.77Hz) chime
        osc1.frequency.setValueAtTime(659.25, ctx.currentTime);
        osc2.frequency.setValueAtTime(987.77, ctx.currentTime + 0.08);

        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(ctx.currentTime);
        osc1.stop(ctx.currentTime + 0.2);
        osc2.start(ctx.currentTime + 0.08);
        osc2.stop(ctx.currentTime + 0.4);
    } catch (e) {
        // Silently handle browser audio policy restrictions
    }
}

// Request Browser Push Notification Permission
export function requestNotificationPermission() {
    if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }
}

// Trigger Desktop Browser Notification
export function showBrowserNotification(title: string, body: string, icon: string = '/logo.png') {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
            const notif = new Notification(title, {
                body,
                icon,
                tag: 'ecommerx-support-chat'
            });

            notif.onclick = () => {
                window.focus();
            };
        } catch (e) {
            // Silently handle permission errors
        }
    }
}
