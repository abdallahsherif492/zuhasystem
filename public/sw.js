/*
 * Service worker for the installed app.
 *
 * Deliberately close to useless, and that is the design. This is an order
 * management system: a moderator shown a cached order list would act on
 * yesterday's data, mark the wrong parcel, or confirm an order that was
 * cancelled an hour ago. Serving stale business data would be worse than
 * having no offline support at all.
 *
 * So it caches exactly two things:
 *   - Next's hashed build output, whose filenames change on every deploy and
 *     therefore can never go stale.
 *   - One offline page, shown only when a navigation fails outright.
 *
 * Everything else — every Supabase call, every API route, every non-GET —
 * goes straight to the network with no interception at all.
 */

const VERSION = "v1";
const SHELL = `ecommerx-shell-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(SHELL)
            .then(c => c.add(new Request(OFFLINE_URL, { cache: "reload" })))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== SHELL).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const { request } = event;

    // Anything that changes state is none of this worker's business.
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Only this origin. Supabase, Sentry and the fonts CDN are left alone.
    if (url.origin !== self.location.origin) return;

    // Live data must never be answered from a cache.
    if (url.pathname.startsWith("/api") || url.pathname.startsWith("/auth")) return;

    // Hashed build output: the filename is the version, so a hit is always
    // the right answer and a miss is a normal fetch that gets stored.
    if (url.pathname.startsWith("/_next/static/")) {
        event.respondWith(
            caches.match(request).then(hit => hit || fetch(request).then(res => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(SHELL).then(c => c.put(request, copy));
                }
                return res;
            }))
        );
        return;
    }

    // Pages: always the network. The cached page is a fallback for a failed
    // navigation, not a first choice — an installed app that opens to a stale
    // dashboard looks broken in a way a plain error never does.
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request).catch(() => caches.match(OFFLINE_URL))
        );
    }
});
