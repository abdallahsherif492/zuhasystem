/**
 * Why an order was cancelled, picked when cancelling from New from stores and
 * kept on the order (orders.cancel_reason, 20261107_cancellation_review.sql).
 *
 * `settles` marks reasons a second call would not change: an order cancelled
 * for one of them is never suspected of being given up on too soon.
 */
export const CANCEL_REASONS = [
    { key: "customer_refused", label: "العميل قال مش عايز الأوردر", settles: true },
    { key: "no_answer", label: "مابيردش", settles: false },
    { key: "phone_off", label: "الموبايل مقفول / خارج الخدمة", settles: false },
    { key: "price", label: "السعر أو الشحن غالي عليه", settles: true },
    { key: "duplicate", label: "أوردر مكرر", settles: true },
    { key: "wrong_number", label: "الرقم غلط", settles: true },
    { key: "fake", label: "طلب وهمي / هزار", settles: true },
    { key: "out_of_stock", label: "المنتج مش موجود عندنا", settles: true },
    { key: "other", label: "سبب تاني", settles: false },
    // What the customer said on the phone (20261120_confirm_flow.sql).
    { key: "deposit_refused", label: "مش راضي يدفع ديبوزت", settles: true },
    { key: "didnt_order", label: "بيقول مطلبتش", settles: true },
    { key: "changed_mind", label: "غيّر رأيه", settles: true },
    { key: "found_cheaper", label: "لقاه أرخص", settles: true },
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number]["key"];

/**
 * The reasons offered when cancelling from the confirmation flow: what the
 * customer said, and at the last step, that they never answered.
 */
export const FLOW_CANCEL_REASONS: CancelReason[] = ["deposit_refused", "didnt_order", "changed_mind", "found_cheaper", "duplicate", "other"];
export const LAST_STEP_CANCEL_REASONS: CancelReason[] = ["no_answer", "wrong_number", ...FLOW_CANCEL_REASONS];

/** Before 20261120_confirm_flow.sql the new reasons are refused; the nearest old one, with the words in the note. */
export const CANCEL_REASON_FALLBACK: Partial<Record<CancelReason, CancelReason>> = {
    deposit_refused: "price", didnt_order: "fake", changed_mind: "customer_refused", found_cheaper: "price",
};

export const cancelReasonLabel = (key: string | null | undefined) =>
    CANCEL_REASONS.find(r => r.key === key)?.label ?? null;

/** Settings → Cancellations, in theme_config.cancellation_review. */
export interface CancellationReviewSettings { auto: boolean }

export const cancellationReviewOf = (themeConfig: { cancellation_review?: Partial<CancellationReviewSettings> } | null | undefined): CancellationReviewSettings =>
    ({ auto: themeConfig?.cancellation_review?.auto === true });

export const CONFIRM_FLOW_MIGRATION = "supabase/migrations/20261120_confirm_flow.sql";
export const CANCELLATION_REVIEW_MIGRATION = "supabase/migrations/20261107_cancellation_review.sql";
