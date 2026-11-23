import type { Flow, FlowCondition } from "@/lib/whatsapp/flow-types";
import type { MessageCase, SavedTemplate } from "@/lib/whatsapp/template-fields";
/**
 * WhatsApp settings, kept in businesses.theme_config.whatsapp and set from
 * Settings → WhatsApp. Defaults are what the owner asked for.
 */
export interface WhatsAppSettings {
    /** A customer's «تأكيد» confirms the order when nothing needs a person. */
    auto_confirm: boolean;
    /** …except the orders these describe (none: no exceptions).*/
    auto_confirm_rule: OrderRule;
    /** A customer's «إلغاء الطلب» cancels the order at once (else it waits for a moderator); except these. */
    auto_cancel: boolean;
    auto_cancel_rule: OrderRule;
    /** «آخر فرصة» orders that never answered the confirmation on WhatsApp are cancelled, this many hours after it (lib/whatsapp/silent-cancel.ts). */
    auto_cancel_silent: boolean;
    auto_cancel_silent_hours: number;
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
    upsell: { enabled: boolean; discount_percent: number; count: number; cheap_max: number; offer_hours: number };
    /** Templates made or edited from the settings: their text and which detail each {{n}} is. */
    templates: Record<string, SavedTemplate>;
    /** The template chosen for each automatic case; none: the system's own. */
    case_templates: Partial<Record<MessageCase, string>>;
    /** «فريق الشحن»: a customer's answers to a shipping message go to a moderator on shift, ready to forward to the courier (lib/whatsapp/team-alerts.ts). */
    team_alerts: { enabled: boolean; members: TeamMember[] };
}

/** A moderator who forwards shipping answers to the courier: their WhatsApp number, and whether they get them. */
export interface TeamMember { email: string; phone: string; on: boolean }

export type OrderEvent = "new_order" | "confirmed" | "shipped" | "hold" | "returning" | "delivered";
export const ORDER_EVENTS: { key: OrderEvent; label: string; template: string }[] = [
    { key: "new_order", label: "أوردر جديد من المتجر: رسالة التأكيد (بصورة المنتج)", template: "order_confirm_photo" },
    { key: "confirmed", label: "المودريتور أكد الأوردر", template: "order_confirmed" },
    { key: "shipped", label: "الأوردر اتشحن", template: "order_shipped" },
    { key: "hold", label: "المندوب ماقدرش يوصله (Hold to redeliver)", template: "delivery_failed" },
    { key: "returning", label: "الشحنة راجعة", template: "order_returning" },
    { key: "delivered", label: "الأوردر اتسلم", template: "order_delivered" },
];

export interface OrderRule { match: "all" | "any"; conditions: FlowCondition[] }

export const WHATSAPP_DEFAULTS: WhatsAppSettings = {
    auto_confirm: true,
    auto_confirm_rule: { match: "all", conditions: [] },
    auto_cancel: true,
    auto_cancel_rule: { match: "all", conditions: [] },
    auto_cancel_silent: true,
    auto_cancel_silent_hours: 24,
    deposit_amount: 50,
    deposit_instapay: "01011690491",
    deposit_wallet: "01100354568",
    min_address_words: 4,
    events: { new_order: true, confirmed: true, shipped: true, hold: true, returning: true, delivered: true },
    flows: [],
    upsell: { enabled: true, discount_percent: 10, count: 6, cheap_max: 150, offer_hours: 2 },
    templates: {},
    case_templates: {},
    team_alerts: { enabled: false, members: [] },
};

export function whatsappSettingsOf(themeConfig: { whatsapp?: Partial<WhatsAppSettings> } | null | undefined): WhatsAppSettings {
    const saved = themeConfig?.whatsapp || {};
    return { ...WHATSAPP_DEFAULTS, ...saved, events: { ...WHATSAPP_DEFAULTS.events, ...(saved.events || {}) }, flows: Array.isArray(saved.flows) ? saved.flows : [], upsell: { ...WHATSAPP_DEFAULTS.upsell, ...(saved.upsell || {}) }, templates: saved.templates || {}, case_templates: saved.case_templates || {},
        team_alerts: { enabled: !!saved.team_alerts?.enabled, members: Array.isArray(saved.team_alerts?.members) ? saved.team_alerts!.members : [] },
        auto_confirm_rule: { ...WHATSAPP_DEFAULTS.auto_confirm_rule, ...(saved.auto_confirm_rule || {}) },
        auto_cancel_rule: { ...WHATSAPP_DEFAULTS.auto_cancel_rule, ...(saved.auto_cancel_rule || {}) } };
}

/** The confirmation templates: the current one (with «إلغاء الطلب») first. */
export const CONFIRM_TEMPLATES = ["order_confirm_v2", "order_confirm", "order_confirm_photo", "order_confirmation"];
export const CONFIRM_TEMPLATE = CONFIRM_TEMPLATES[0];

/** Why a customer cancels, offered as a list after «إلغاء الطلب». Titles: 24 characters at most. */
export const CANCEL_CHOICES: { id: string; reason: string; title: string }[] = [
    { id: "cancel:deposit_refused", reason: "deposit_refused", title: "مش عايز أدفع ديبوزت" },
    { id: "cancel:didnt_order", reason: "didnt_order", title: "مطلبتش حاجة" },
    { id: "cancel:changed_mind", reason: "changed_mind", title: "غيرت رأيي" },
    { id: "cancel:found_cheaper", reason: "found_cheaper", title: "لقيته أرخص" },
    { id: "cancel:other", reason: "other", title: "سبب تاني" },
];
