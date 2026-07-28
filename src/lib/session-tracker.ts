/**
 * Browser fingerprinting helpers for live session tracking.
 *
 * Everything here is derived from what the browser already exposes to the
 * page — no probing, no third-party calls.
 */

const SESSION_KEY = "ecommerx_session_id";

/**
 * A per-tab id. sessionStorage (not localStorage) is deliberate: two tabs are
 * two sessions, and closing the tab retires the id.
 */
export function getSessionId(): string {
    if (typeof window === "undefined") return "";

    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
        id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
}

export function getDeviceType(): "mobile" | "tablet" | "desktop" {
    if (typeof navigator === "undefined") return "desktop";
    const ua = navigator.userAgent;
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
    if (/Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return "mobile";
    return "desktop";
}

export function getBrowser(): string {
    if (typeof navigator === "undefined") return "Unknown";
    const ua = navigator.userAgent;

    // Order matters: several browsers embed "Chrome"/"Safari" in their UA.
    if (/Edg\//.test(ua)) return "Edge";
    if (/OPR\/|Opera/.test(ua)) return "Opera";
    if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Chrome\//.test(ua)) return "Chrome";
    if (/Safari\//.test(ua)) return "Safari";
    return "Unknown";
}

export function getOS(): string {
    if (typeof navigator === "undefined") return "Unknown";
    const ua = navigator.userAgent;

    if (/Windows NT/.test(ua)) return "Windows";
    if (/Android/.test(ua)) return "Android";
    if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
    if (/Mac OS X/.test(ua)) return "macOS";
    if (/Linux/.test(ua)) return "Linux";
    return "Unknown";
}

export function getScreenSize(): string {
    if (typeof window === "undefined") return "";
    return `${window.screen.width}x${window.screen.height}`;
}

export function getViewport(): string {
    if (typeof window === "undefined") return "";
    return `${window.innerWidth}x${window.innerHeight}`;
}

export function getTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
        return "";
    }
}

/** Referrer, but only when it came from outside the app. */
export function getExternalReferrer(): string {
    if (typeof document === "undefined") return "";
    const ref = document.referrer;
    if (!ref) return "";
    try {
        if (new URL(ref).host === window.location.host) return "";
    } catch {
        return "";
    }
    return ref;
}

/** A readable label for a route, used in the admin breakdown. */
export function describePath(path: string): string {
    if (!path) return "—";
    const map: Record<string, string> = {
        "/dashboard": "Dashboard",
        "/orders": "Orders",
        "/orders/new": "New Order",
        "/products": "Products",
        "/customers": "Customers",
        "/inventory": "Inventory",
        "/logistics": "Logistics",
        "/accounting": "Accounting",
        "/insights": "Insights",
        "/platform-orders": "Platform Orders",
        "/settings": "Settings",
        "/team": "Team",
        "/my-hr": "My HR",
        "/support": "Support",
        "/landing": "Landing Page",
        "/login": "Login",
        "/register": "Register",
        "/onboarding": "Onboarding",
    };
    if (map[path]) return map[path];

    // /orders/<uuid> -> "Order Detail"
    const segments = path.split("/").filter(Boolean);
    if (segments.length >= 2) {
        const base = `/${segments[0]}`;
        const label = map[base] || segments[0];
        return `${label} — detail`;
    }
    return path;
}
