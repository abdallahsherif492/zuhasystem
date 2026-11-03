/**
 * What a business prints on its waybills, kept in theme_config.waybill and
 * edited under Settings → Waybill. The same notes reach couriers whose own
 * waybill we fill in (Turbo prints the notes we send it).
 */

export const SHIPPING_PLACEHOLDER = "{مبلغ الشحن}";

export interface WaybillSettings {
    /** Printed on every waybill, after the order's own notes. */
    fixedNote: string;
    /**
     * Tells the courier to collect the delivery charge when the customer
     * refuses the parcel; SHIPPING_PLACEHOLDER becomes the order's charge.
     */
    refusalNote: { enabled: boolean; text: string };
}

export const DEFAULT_WAYBILL_SETTINGS: WaybillSettings = {
    fixedNote: "قابل للكسر",
    refusalNote: {
        enabled: false,
        text: `في حالة عدم الإستلام الرجاء تحصيل مبلغ الشحن وهو : ${SHIPPING_PLACEHOLDER} جنيه`,
    },
};

export function waybillSettingsOf(themeConfig: { waybill?: Partial<WaybillSettings> } | null | undefined): WaybillSettings {
    const saved = themeConfig?.waybill || {};
    return {
        fixedNote: saved.fixedNote ?? DEFAULT_WAYBILL_SETTINGS.fixedNote,
        refusalNote: { ...DEFAULT_WAYBILL_SETTINGS.refusalNote, ...(saved.refusalNote || {}) },
    };
}

/** The refusal note for one order, or null when it is off or there is no charge to collect. */
export function refusalNoteFor(settings: WaybillSettings, shippingCost: number | null | undefined): string | null {
    const charge = Math.round(Number(shippingCost) || 0);
    if (!settings.refusalNote.enabled || charge <= 0 || !settings.refusalNote.text.trim()) return null;
    return settings.refusalNote.text.split(SHIPPING_PLACEHOLDER).join(String(charge)).trim();
}
