import type { CSSProperties } from "react";

/**
 * Cairo, loaded from Google Fonts by a plain stylesheet.
 *
 * next/font/google stopped building it: Google now serves Cairo's files at
 * links like /l/font?kit=…&skey=…&v=…, which Next 16's Turbopack cannot read
 * («next/font/google queries have exactly one entry»), so the Netlify build
 * failed (21 Nov 2026) while a local build, with the font cached, passed.
 * React hoists the <link> into the page's head, once however many times it
 * is drawn.
 */
const HREF = "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap";

export function CairoFont() {
    return <link rel="stylesheet" href={HREF} precedence="default" />;
}

export const cairo: CSSProperties = { fontFamily: "'Cairo', 'Segoe UI', Tahoma, sans-serif" };
