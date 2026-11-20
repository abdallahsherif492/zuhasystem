/**
 * WhatsApp rules («الأتمتة») set in Settings → WhatsApp and kept in
 * businesses.theme_config.whatsapp.flows: when something happens to an order
 * (or the customer answers, or does not), and the order matches the
 * conditions, do the actions. Run by lib/whatsapp/flows.ts.
 */

export type FlowTrigger =
    | { type: "event"; event: FlowEvent }
    | { type: "reply" }
    | { type: "no_reply"; hours: number };

export type FlowEvent = "new_order" | "confirmed" | "shipped" | "hold" | "returning" | "delivered";

export type FlowField = "governorate" | "total" | "sku" | "product" | "items" | "delivery_rate" | "reply" | "source";
export type FlowOp = "is" | "is_not" | "contains" | "not_contains" | "gt" | "lt";

export interface FlowCondition { field: FlowField; op: FlowOp; value: string }

export type FlowAction =
    | { type: "template"; template: FlowTemplate }
    | { type: "text"; text: string }
    | { type: "status"; status: "Pending" | "Cancelled" }
    | { type: "assign"; email: string }
    | { type: "note"; text: string };

export type FlowTemplate = "confirm" | "reminder" | "confirmed" | "shipped" | "hold" | "returning" | "delivered";

export interface Flow {
    id: string;
    name: string;
    enabled: boolean;
    trigger: FlowTrigger;
    /** "all": every condition (و). "any": one is enough (أو). */
    match: "all" | "any";
    conditions: FlowCondition[];
    actions: FlowAction[];
}

export const EVENT_LABEL: Record<FlowEvent, string> = {
    new_order: "أوردر جديد وصل من المتجر",
    confirmed: "المودريتور أكد الأوردر",
    shipped: "الأوردر اتشحن",
    hold: "المندوب ماقدرش يوصله",
    returning: "الشحنة راجعة",
    delivered: "الأوردر اتسلم",
};

export const FIELD_LABEL: Record<FlowField, string> = {
    governorate: "المحافظة",
    total: "قيمة الأوردر",
    sku: "كود منتج (SKU)",
    product: "اسم منتج",
    items: "عدد القطع",
    delivery_rate: "استلام العميل",
    reply: "رد العميل",
    source: "جاي من",
};

/** Which comparisons make sense for each field. */
export const FIELD_OPS: Record<FlowField, FlowOp[]> = {
    governorate: ["is", "is_not"],
    total: ["gt", "lt"],
    sku: ["is", "is_not"],
    product: ["contains", "not_contains"],
    items: ["gt", "lt"],
    delivery_rate: ["is", "is_not"],
    reply: ["contains", "not_contains", "is"],
    source: ["is", "is_not"],
};

export const OP_LABEL: Record<FlowOp, string> = {
    is: "هو", is_not: "مش", contains: "فيه", not_contains: "مافيهوش", gt: "أكتر من", lt: "أقل من",
};

/** Fixed choices for some fields. */
export const FIELD_CHOICES: Partial<Record<FlowField, { value: string; label: string }[]>> = {
    delivery_rate: [{ value: "low", label: "ضعيف" }, { value: "moderate", label: "متوسط" }, { value: "high", label: "كويس" }, { value: "unknown", label: "مش معروف (عميل جديد)" }],
    source: [{ value: "easyorders", label: "ايزي اوردرز" }, { value: "shopify", label: "شوبيفاي" }, { value: "manual", label: "متسجل يدوي" }],
};

export const TEMPLATE_LABEL: Record<FlowTemplate, string> = {
    confirm: "رسالة التأكيد",
    reminder: "تذكير بالتأكيد",
    confirmed: "الأوردر اتأكد",
    shipped: "الأوردر اتشحن",
    hold: "المندوب ماقدرش يوصله",
    returning: "الشحنة راجعة",
    delivered: "الأوردر اتسلم",
};

/** The values a text message can carry. */
export const TEXT_FIELDS = [
    { key: "{الاسم}", label: "اسم العميل" },
    { key: "{المنتجات}", label: "المنتجات" },
    { key: "{المبلغ}", label: "المطلوب عند الاستلام" },
    { key: "{رقم_الطلب}", label: "رقم الطلب" },
];

export const newFlowId = () => Math.random().toString(36).slice(2, 10);

/** Ready-made rules, one tap to add. */
export const FLOW_PRESETS: { title: string; flow: Omit<Flow, "id"> }[] = [
    {
        title: "تذكير لو العميل مردش على التأكيد بعد 4 ساعات",
        flow: { name: "تذكير بالتأكيد", enabled: true, trigger: { type: "no_reply", hours: 4 }, match: "all", conditions: [], actions: [{ type: "template", template: "reminder" }] },
    },
    {
        title: "أوردر قيمته كبيرة يروح لمودريتور معيّن",
        flow: { name: "أوردرات كبيرة", enabled: false, trigger: { type: "event", event: "new_order" }, match: "all", conditions: [{ field: "total", op: "gt", value: "1500" }], actions: [{ type: "assign", email: "" }] },
    },
    {
        title: "العميل سأل عن الشحن: رد بمعاده",
        flow: { name: "سؤال عن الشحن", enabled: false, trigger: { type: "reply" }, match: "any", conditions: [{ field: "reply", op: "contains", value: "امتى" }, { field: "reply", op: "contains", value: "هيوصل" }, { field: "reply", op: "contains", value: "الشحن" }], actions: [{ type: "text", text: "أهلاً {الاسم} 🌸 الطلب بيوصل خلال 2 لـ 4 أيام عمل من التأكيد، والمندوب هيكلمك قبلها." }] },
    },
];
