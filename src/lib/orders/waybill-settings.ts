/**
 * What a business prints on its waybills, kept in theme_config.waybill and
 * edited under Settings → Waybill. The same notes reach couriers whose own
 * waybill we fill in (Turbo prints the notes we send it).
 */

export const SHIPPING_PLACEHOLDER = "{مبلغ الشحن}";

/** The three layouts of components/orders/waybill-card.tsx. */
export const WAYBILL_TEMPLATES = ["courier", "ticket", "letterhead"] as const;
export type WaybillTemplate = (typeof WAYBILL_TEMPLATES)[number];

export interface WaybillSettings {
    template: WaybillTemplate;
    /** The store's number, for the courier or customer to call. */
    storePhone: string;
    /** The store's website, printed beside the phone. */
    storeWebsite: string;
    /** A line to the customer beside the logo. */
    thanks: string;
    /** An offer for the next order, printed after the thanks, with its code if it has one. */
    offer: string;
    promoCode: string;
    /** Printed on every waybill, after the order's own notes. */
    fixedNote: string;
    /**
     * Tells the courier to collect the delivery charge when the customer
     * refuses the parcel; SHIPPING_PLACEHOLDER becomes the order's charge.
     */
    refusalNote: { enabled: boolean; text: string };
}

export const DEFAULT_WAYBILL_SETTINGS: WaybillSettings = {
    template: "courier",
    storePhone: "",
    storeWebsite: "",
    thanks: "شكرًا لثقتك فينا، نتمنى المنتج يعجبك",
    offer: "",
    promoCode: "",
    fixedNote: "قابل للكسر",
    refusalNote: {
        enabled: false,
        text: `في حالة عدم الإستلام الرجاء تحصيل مبلغ الشحن وهو : ${SHIPPING_PLACEHOLDER} جنيه`,
    },
};

export function waybillSettingsOf(themeConfig: { waybill?: Partial<WaybillSettings> } | null | undefined): WaybillSettings {
    const saved = themeConfig?.waybill || {};
    return {
        template: WAYBILL_TEMPLATES.includes(saved.template as WaybillTemplate) ? saved.template as WaybillTemplate : DEFAULT_WAYBILL_SETTINGS.template,
        storePhone: saved.storePhone ?? DEFAULT_WAYBILL_SETTINGS.storePhone,
        storeWebsite: saved.storeWebsite ?? DEFAULT_WAYBILL_SETTINGS.storeWebsite,
        thanks: saved.thanks ?? DEFAULT_WAYBILL_SETTINGS.thanks,
        offer: saved.offer ?? DEFAULT_WAYBILL_SETTINGS.offer,
        promoCode: saved.promoCode ?? DEFAULT_WAYBILL_SETTINGS.promoCode,
        fixedNote: saved.fixedNote ?? DEFAULT_WAYBILL_SETTINGS.fixedNote,
        refusalNote: { ...DEFAULT_WAYBILL_SETTINGS.refusalNote, ...(saved.refusalNote || {}) },
    };
}

/**
 * The refusal note for one order, on every waybill while it is on. The amount
 * is what the customer was charged for delivery; on free shipping, what the
 * courier charges us, which is what a refused parcel costs the store.
 */
export function refusalNoteFor(settings: WaybillSettings, shippingCost: number | null | undefined, courierCost?: number | null): string | null {
    if (!settings.refusalNote.enabled || !settings.refusalNote.text.trim()) return null;
    const charge = Math.round(Number(shippingCost) || 0) || Math.round(Number(courierCost) || 0);
    const text = charge > 0
        ? settings.refusalNote.text.split(SHIPPING_PLACEHOLDER).join(String(charge))
        // Nothing known to collect: the note without a number, rather than "0".
        : settings.refusalNote.text.split(SHIPPING_PLACEHOLDER).join("").replace(/\s*(وهو)?\s*:?\s*جنيه\s*$/, "").replace(/\s*:\s*$/, "");
    return text.trim();
}
