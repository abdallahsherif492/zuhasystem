import type { Flow } from "@/lib/whatsapp/flow-types";
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
    /** Sent on their own, per event (whatsapp_outbox, 20261125). */
    events: Record<OrderEvent, boolean>;
    /** «الأتمتة»: rules (lib/whatsapp/flow-types.ts). */
    flows: Flow[];
    /** After confirming: one product often bought with the order, with its photo, at a discount (lib/whatsapp/upsell.ts). */
    upsell: { enabled: boolean; discount_percent: number; count: number };
}

export type OrderEvent = "new_order" | "confirmed" | "shipped" | "hold" | "returning" | "delivered";
export const ORDER_EVENTS: { key: OrderEvent; label: string; template: string }[] = [
    { key: "new_order", label: "أوردر جديد من المتجر: رسالة التأكيد (بصورة المنتج)", template: "order_confirm_photo" },
    { key: "confirmed", label: "المودريتور أكد الأوردر", template: "order_confirmed" },
    { key: "shipped", label: "الأوردر اتشحن", template: "order_shipped" },
    { key: "hold", label: "المندوب ماقدرش يوصله (Hold to redeliver)", template: "delivery_failed" },
    { key: "returning", label: "الشحنة راجعة", template: "order_returning" },
    { key: "delivered", label: "الأوردر اتسلم", template: "order_delivered" },
];

export const WHATSAPP_DEFAULTS: WhatsAppSettings = {
    auto_confirm: true,
    deposit_amount: 50,
    deposit_instapay: "01011690491",
    deposit_wallet: "01100354568",
    min_address_words: 4,
    events: { new_order: true, confirmed: true, shipped: true, hold: true, returning: true, delivered: true },
    flows: [],
    upsell: { enabled: true, discount_percent: 10, count: 3 },
};

export function whatsappSettingsOf(themeConfig: { whatsapp?: Partial<WhatsAppSettings> } | null | undefined): WhatsAppSettings {
    const saved = themeConfig?.whatsapp || {};
    return { ...WHATSAPP_DEFAULTS, ...saved, events: { ...WHATSAPP_DEFAULTS.events, ...(saved.events || {}) }, flows: Array.isArray(saved.flows) ? saved.flows : [], upsell: { ...WHATSAPP_DEFAULTS.upsell, ...(saved.upsell || {}) } };
}

/** The confirmation templates: the current one (with «إلغاء الطلب») first. */
export const CONFIRM_TEMPLATES = ["order_confirm", "order_confirm_photo", "order_confirmation"];
export const CONFIRM_TEMPLATE = CONFIRM_TEMPLATES[0];

/** Why a customer cancels, offered as a list after «إلغاء الطلب». Titles: 24 characters at most. */
export const CANCEL_CHOICES: { id: string; reason: string; title: string }[] = [
    { id: "cancel:deposit_refused", reason: "deposit_refused", title: "مش عايز أدفع ديبوزت" },
    { id: "cancel:didnt_order", reason: "didnt_order", title: "مطلبتش حاجة" },
    { id: "cancel:changed_mind", reason: "changed_mind", title: "غيرت رأيي" },
    { id: "cancel:found_cheaper", reason: "found_cheaper", title: "لقيته أرخص" },
    { id: "cancel:other", reason: "other", title: "سبب تاني" },
];
