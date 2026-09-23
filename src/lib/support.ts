/**
 * How a merchant reaches us.
 *
 * Signups were leaving on day one without a word: the landing page promises
 * free setup and step-by-step help, and after registering there was nothing on
 * screen to ask for it. One number, used everywhere a new merchant might be
 * stuck, with the message already written so all they have to do is send it.
 */
export const SUPPORT_WHATSAPP = "01011690491";

/** wa.me link to our support number, with the message waiting in the chat. */
export function supportWhatsappLink(message: string): string {
    return `https://wa.me/2${SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}`;
}

export const supportMessages = {
    signup: "أهلاً، أنا لسه بسجّل على eCommerx ومحتاج مساعدة.",
    setup: (store?: string | null) =>
        `أهلاً، أنا عملت حساب على eCommerx${store ? ` باسم "${store}"` : ""} وعايز تجهّزولي السيستم وتربطوا متجري.`,
    help: (store?: string | null) =>
        `أهلاً، محتاج مساعدة في eCommerx${store ? ` (متجر "${store}")` : ""}.`,
    easyorders: (store?: string | null) =>
        `أهلاً، عايز أربط متجري على EasyOrders بـ eCommerx${store ? ` (متجر "${store}")` : ""}. ممكن تساعدوني؟`,
};

/**
 * An Egyptian mobile in 01xxxxxxxxx form, or null.
 * Accepts Arabic-Indic digits, spaces, dashes and a +20 / 0020 prefix, because
 * that is how people type their number on a phone keyboard.
 */
export function normalizeEgyptianMobile(raw: string): string | null {
    const ascii = (raw || "")
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
        .replace(/\D/g, "");
    const local = ascii.replace(/^(?:0020|20)(?=1\d{9}$)/, "0").replace(/^(?=1\d{9}$)/, "0");
    return /^01[0125]\d{8}$/.test(local) ? local : null;
}
