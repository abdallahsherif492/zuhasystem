/**
 * The tutorial videos, and which page each one explains.
 *
 * The videos live in one YouTube playlist, in this order. Until a video's own
 * id is filled in below it is played from the playlist by its position, so
 * the order here must match the playlist's. Once the ids are known, set
 * `videoId` and the position no longer matters.
 *
 * `pages` are matched exactly, or as a prefix when they end in "/*".
 */
export const TUTORIAL_PLAYLIST_ID = "PLWA6QYSC2Hro";
export const TUTORIAL_PLAYLIST_URL = `https://www.youtube.com/playlist?list=${TUTORIAL_PLAYLIST_ID}`;

export interface Tutorial {
    /** Position in the playlist, starting at 1. */
    n: number;
    title: string;
    videoId?: string;
    pages: string[];
}

export const TUTORIALS: Tutorial[] = [
    { n: 1, title: "إنشاء الحساب والمتجر", pages: ["/getting-started"] },
    { n: 2, title: "إضافة المنتجات", pages: ["/products", "/products/*"] },
    { n: 3, title: "إضافة شركة الشحن", pages: ["/shipping"] },
    { n: 4, title: "إضافة أوردر يدوي", pages: ["/orders/new", "/orders", "/accounting"] },
    { n: 5, title: "رفع الأوردرات من Excel", pages: ["/orders/import", "/orders"] },
    { n: 6, title: "كشف الأوردرات المتكررة", pages: ["/orders", "/platform-orders"] },
    { n: 7, title: "الطباعة والتحضير والشحن", pages: ["/logistics"] },
    { n: 8, title: "ربط شركات الشحن", pages: ["/settings", "/shipping"] },
    { n: 9, title: "ربط EasyOrders و Shopify", pages: ["/settings", "/platform-orders"] },
    { n: 10, title: "الاشتراك والدفع", pages: ["/settings"] },
    { n: 11, title: "تأكيد طلبات المتاجر", pages: ["/platform-orders"] },
    { n: 12, title: "متابعة الشحن ومشاكله", pages: ["/logistics/issues", "/logistics"] },
];

const matches = (page: string, path: string) =>
    page.endsWith("/*") ? path.startsWith(page.slice(0, -1)) : path === page;

/**
 * Videos for a page, the one made for it first: exact matches before prefix
 * ones, and within those the video that lists this page earliest.
 */
export function tutorialsForPath(path: string): Tutorial[] {
    const clean = (path || "/").replace(/\/+$/, "") || "/";
    return TUTORIALS
        .map(t => {
            const i = t.pages.findIndex(p => matches(p, clean));
            return { t, rank: i < 0 ? -1 : (t.pages[i].endsWith("/*") ? 100 : 0) + i };
        })
        .filter(x => x.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.t.n - b.t.n)
        .map(x => x.t);
}

/** Embed URL: the video itself when its id is known, else its place in the playlist (0-based). */
export function tutorialEmbedUrl(t: Tutorial, autoplay = false): string {
    const params = new URLSearchParams({ rel: "0", modestbranding: "1", ...(autoplay ? { autoplay: "1" } : {}) });
    if (t.videoId) return `https://www.youtube-nocookie.com/embed/${t.videoId}?${params}`;
    params.set("list", TUTORIAL_PLAYLIST_ID);
    params.set("index", String(t.n - 1));
    return `https://www.youtube-nocookie.com/embed/videoseries?${params}`;
}
