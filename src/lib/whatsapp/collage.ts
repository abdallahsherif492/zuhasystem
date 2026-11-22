/**
 * One picture of every product in an order, for a template's header (a
 * template carries a single picture): the products side by side on white,
 * each shown whole (never cropped), so a customer who ordered three things
 * sees the three of them, not one detail shot of the first.
 *
 *   2 products  ┌────┬────┐      3 products ┌──────┬───┐    4+ ┌───┬───┐
 *               │ 1  │ 2  │                 │  1   │ 2 │       │ 1 │ 2 │
 *               └────┴────┘                 │      ├───┤       ├───┼───┤
 *                                           │      │ 3 │       │ 3 │ 4 │
 *                                           └──────┴───┘       └───┴───┘
 *
 * The first four distinct pictures are used; the message's text lists every
 * product. Returns null when fewer than two pictures open, or when sharp
 * cannot run: the caller then sends the first product's picture alone.
 */

const GAP = 12;

type Tile = { x: number; y: number; size: number };

function layout(n: number): { width: number; height: number; tiles: Tile[] } {
    if (n === 2) {
        const s = 600;
        return { width: s * 2 + GAP * 3, height: s + GAP * 2, tiles: [{ x: GAP, y: GAP, size: s }, { x: s + GAP * 2, y: GAP, size: s }] };
    }
    if (n === 3) {
        const small = 400, big = small * 2 + GAP;
        return {
            width: big + small + GAP * 3, height: big + GAP * 2,
            tiles: [
                { x: GAP, y: GAP, size: big },
                { x: big + GAP * 2, y: GAP, size: small },
                { x: big + GAP * 2, y: small + GAP * 2, size: small },
            ],
        };
    }
    const s = 540;
    const at = (i: number) => GAP + i * (s + GAP);
    return { width: at(2), height: at(2), tiles: [0, 1, 2, 3].map(i => ({ x: at(i % 2), y: at(Math.floor(i / 2)), size: s })) };
}

async function download(url: string): Promise<Buffer | null> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
    } catch {
        return null;
    }
}

export async function productCollage(urls: string[]): Promise<Uint8Array | null> {
    const wanted = [...new Set(urls.filter(Boolean))].slice(0, 4);
    if (wanted.length < 2) return null;
    try {
        const sharp = (await import("sharp")).default;
        const white = { r: 255, g: 255, b: 255, alpha: 1 };
        // Each picture opened and squared first, so one that will not open leaves no empty box.
        const squared = await Promise.all((await Promise.all(wanted.map(download))).map(b => !b ? null
            : sharp(b).rotate().flatten({ background: white }).resize(1000, 1000, { fit: "contain", background: white }).png().toBuffer().catch(() => null)));
        const pictures = squared.filter((b): b is Buffer => !!b);
        if (pictures.length < 2) return null;
        const { width, height, tiles } = layout(pictures.length);
        const ok = await Promise.all(pictures.map(async (bytes, i) => {
            const t = tiles[i];
            // Whole product on white, a little inset so it does not touch its frame.
            const inner = Math.round(t.size * 0.94);
            const pad = Math.round((t.size - inner) / 2);
            return { input: await sharp(bytes).resize(inner, inner).toBuffer(), left: t.x + pad, top: t.y + pad };
        }));
        // Tiles share a soft grey frame so each product reads as its own box.
        const frames = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${
            tiles.slice(0, pictures.length).map(t => `<rect x="${t.x + 1}" y="${t.y + 1}" width="${t.size - 2}" height="${t.size - 2}" rx="18" fill="none" stroke="#e6e6e6" stroke-width="2"/>`).join("")
        }</svg>`);
        const out = await sharp({ create: { width, height, channels: 3, background: "#f5f5f5" } })
            .composite([
                ...tiles.slice(0, pictures.length).map(t => ({
                    input: Buffer.from(`<svg width="${t.size}" height="${t.size}" xmlns="http://www.w3.org/2000/svg"><rect width="${t.size}" height="${t.size}" rx="18" fill="#fff"/></svg>`),
                    left: t.x, top: t.y,
                })),
                ...ok,
                { input: frames, left: 0, top: 0 },
            ])
            .jpeg({ quality: 85, mozjpeg: true })
            .toBuffer();
        return new Uint8Array(out);
    } catch (e) {
        console.error("whatsapp collage", e);
        return null;
    }
}
