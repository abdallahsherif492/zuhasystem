/**
 * Storage that cannot take the app down.
 *
 * `localStorage` and `sessionStorage` are not always available even when the
 * objects exist: iOS Safari in Private Browsing, the in-app browsers used by
 * Facebook and Instagram, and any profile with site data blocked will throw
 * on access. A throw inside an async context or an effect propagates, and in
 * this app that left the dashboard spinning forever behind its loading guards.
 *
 * These helpers degrade to an in-memory map instead: the tab keeps working,
 * it just forgets things once it is closed.
 */

const memory = new Map<string, string>();

function pick(kind: "local" | "session"): Storage | null {
    if (typeof window === "undefined") return null;
    try {
        const store = kind === "local" ? window.localStorage : window.sessionStorage;
        // Touching the object is not enough — Safari only throws on use.
        const probe = "__storage_probe__";
        store.setItem(probe, "1");
        store.removeItem(probe);
        return store;
    } catch {
        return null;
    }
}

function read(kind: "local" | "session", key: string): string | null {
    const store = pick(kind);
    if (!store) return memory.get(`${kind}:${key}`) ?? null;
    try {
        return store.getItem(key);
    } catch {
        return memory.get(`${kind}:${key}`) ?? null;
    }
}

function write(kind: "local" | "session", key: string, value: string): void {
    const store = pick(kind);
    memory.set(`${kind}:${key}`, value);
    if (!store) return;
    try {
        store.setItem(key, value);
    } catch {
        /* quota or blocked — the memory copy above is the fallback */
    }
}

export const safeLocal = {
    get: (key: string) => read("local", key),
    set: (key: string, value: string) => write("local", key, value),
};

export const safeSession = {
    get: (key: string) => read("session", key),
    set: (key: string, value: string) => write("session", key, value),
};

/** True when the browser gives us real persistence. */
export const hasPersistentStorage = () => pick("local") !== null;
