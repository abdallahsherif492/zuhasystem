/**
 * WhatsApp settings, kept in businesses.theme_config.whatsapp and set from
 * Settings → WhatsApp. Defaults are what the owner asked for.
 */
export interface WhatsAppSettings {
    /** A customer's «تأكيد» confirms the order when nothing needs a person. */
    auto_confirm: boolean;
    deposit_amount: number;
    deposit_instapay: string;
    deposit_wallet: string;
    /** An address with fewer words than this is asked to be completed. */
    min_address_words: number;
}

export const WHATSAPP_DEFAULTS: WhatsAppSettings = {
    auto_confirm: true,
    deposit_amount: 50,
    deposit_instapay: "01011690491",
    deposit_wallet: "01100354568",
    min_address_words: 4,
};

export function whatsappSettingsOf(themeConfig: { whatsapp?: Partial<WhatsAppSettings> } | null | undefined): WhatsAppSettings {
    return { ...WHATSAPP_DEFAULTS, ...(themeConfig?.whatsapp || {}) };
}

/** The confirmation templates: the current one (with «إلغاء الطلب») first. */
export const CONFIRM_TEMPLATES = ["order_confirm", "order_confirmation"];
export const CONFIRM_TEMPLATE = CONFIRM_TEMPLATES[0];

/** Why a customer cancels, offered as a list after «إلغاء الطلب». Titles: 24 characters at most. */
export const CANCEL_CHOICES: { id: string; reason: string; title: string }[] = [
    { id: "cancel:deposit_refused", reason: "deposit_refused", title: "مش عايز أدفع ديبوزت" },
    { id: "cancel:didnt_order", reason: "didnt_order", title: "مطلبتش حاجة" },
    { id: "cancel:changed_mind", reason: "changed_mind", title: "غيرت رأيي" },
    { id: "cancel:found_cheaper", reason: "found_cheaper", title: "لقيته أرخص" },
    { id: "cancel:other", reason: "other", title: "سبب تاني" },
];
