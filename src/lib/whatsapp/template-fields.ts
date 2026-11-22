/**
 * The order details a template can carry, written in the editor as
 * {الاسم}, {المنتجات}… and sent to Meta as {{1}}, {{2}}… in the order they
 * appear (each place its own number). Each template remembers which detail each number is (the
 * system's own templates here; new or edited ones in the WhatsApp settings),
 * so the right value goes in each place whatever the wording.
 */

export type FieldKey = "first_name" | "items" | "due" | "total" | "ref" | "courier" | "tracking" | "store" | "governorate" | "address";

export const FIELDS: { key: FieldKey; label: string; example: string }[] = [
    { key: "first_name", label: "الاسم", example: "ساره" },
    { key: "items", label: "المنتجات", example: "مطحنة بن وتوابل (عدد 1)" },
    { key: "due", label: "المبلغ", example: "655" },
    { key: "total", label: "الإجمالي", example: "700" },
    { key: "ref", label: "رقم_الطلب", example: "24B4EF7B" },
    { key: "courier", label: "شركة_الشحن", example: "تيليغراف" },
    { key: "tracking", label: "رقم_البوليصة", example: "123456789" },
    { key: "store", label: "اسم_المتجر", example: "Zuha Store" },
    { key: "governorate", label: "المحافظة", example: "القاهرة" },
    { key: "address", label: "العنوان", example: "مدينة نصر، شارع عباس العقاد" },
];
const BY_LABEL = new Map(FIELDS.map(f => [f.label, f]));
const BY_KEY = new Map(FIELDS.map(f => [f.key, f]));
export const fieldLabel = (k: string) => BY_KEY.get(k as FieldKey)?.label || k;

/** The system's templates: which detail each {{n}} is. */
export const BUILTIN_PARAMS: Record<string, FieldKey[]> = {
    order_confirm_v2: ["first_name", "items", "due", "address", "governorate"],
    order_confirm_photo: ["first_name", "items", "due"],
    order_confirm: ["first_name", "items", "due"],
    order_confirmation: ["first_name", "items", "due"],
    order_confirmed: ["first_name", "ref", "due"],
    order_shipped: ["first_name", "courier", "tracking", "due"],
    delivery_failed: ["first_name", "ref"],
    delivery_failed_photo: ["first_name", "items", "ref"],
    order_returning: ["first_name", "ref"],
    order_returning_photo: ["first_name", "items", "ref"],
    order_delivered: ["first_name", "store"],
    order_delivered_photo: ["first_name", "store"],
    confirmation_reminder: ["first_name", "items"],
    confirmation_reminder_v2: ["first_name", "items", "due"],
};

/** Editor text → Meta's body ({{n}}), which detail each number is, and the examples Meta asks for. Unknown {words} are an error. */
export function toMetaBody(text: string): { body: string; params: FieldKey[]; example: string[]; unknown: string[] } {
    const params: FieldKey[] = [];
    const unknown: string[] = [];
    const body = text.replace(/\{([^{}]+)\}/g, (all, word: string) => {
        const f = BY_LABEL.get(word.trim());
        if (!f) { unknown.push(word); return all; }
        // Each place gets its own number, even the same detail twice (Meta wants them in order).
        params.push(f.key);
        return `{{${params.length}}}`;
    });
    return { body, params, example: params.map(k => BY_KEY.get(k)!.example), unknown };
}

/** Meta's body → the editor's words. Numbers with no known detail stay {{n}}. */
export function fromMetaBody(body: string, params: string[] | undefined): string {
    return body.replace(/\{\{(\d+)\}\}/g, (all, n) => {
        const k = params?.[Number(n) - 1];
        return k ? `{${fieldLabel(k)}}` : all;
    });
}

/** The cases a template can be chosen for (Settings → WhatsApp). */
export type MessageCase = "confirm" | "reminder" | "confirmed" | "shipped" | "hold" | "returning" | "delivered";
export const CASES: { key: MessageCase; label: string; builtin: string }[] = [
    { key: "confirm", label: "رسالة التأكيد (أوردر جديد)", builtin: "order_confirm_v2 ← order_confirm_photo ← order_confirm" },
    { key: "reminder", label: "تذكير بالتأكيد (من الأتمتة)", builtin: "confirmation_reminder_v2 ← confirmation_reminder" },
    { key: "confirmed", label: "المودريتور أكد الأوردر", builtin: "order_confirmed" },
    { key: "shipped", label: "الأوردر اتشحن", builtin: "order_shipped" },
    { key: "hold", label: "المندوب ماقدرش يوصله", builtin: "delivery_failed_photo ← delivery_failed" },
    { key: "returning", label: "الشحنة راجعة", builtin: "order_returning_photo ← order_returning" },
    { key: "delivered", label: "الأوردر اتسلم", builtin: "order_delivered_photo ← order_delivered" },
];

/** A template as the system keeps it: its text, which detail each number is, buttons, photo. */
export interface SavedTemplate { body: string; params: FieldKey[]; buttons: string[]; image: boolean; category: string }
