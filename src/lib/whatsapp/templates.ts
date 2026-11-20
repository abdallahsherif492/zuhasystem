/**
 * The message templates the system sends, as submitted to Meta (all Utility,
 * Arabic). Settings → WhatsApp submits the ones Meta does not have yet and
 * shows each one's review status.
 */
export interface TemplateDef {
    name: string;
    purpose: string;
    body: string;
    example: string[];
    buttons?: string[];
}

export const TEMPLATES: TemplateDef[] = [
    {
        name: "order_confirm", purpose: "أوردر جديد: برجاء التأكيد",
        body: "أهلاً {{1}}\nشكراً إنك طلبت من Zuha Store.\n\nبرجاء تأكيد طلبك:\n{{2}}\n\nالمطلوب عند الاستلام: {{3}} جنيه\n\nالرجاء الرد بكلمة «تأكيد» لتأكيد الأوردر.",
        example: ["ساره", "مطحنة بن وتوابل (عدد 1)، طقم بلانشات خشب (عدد 2)", "655"],
        buttons: ["تأكيد", "إلغاء الطلب"],
    },
    {
        name: "order_confirmed", purpose: "الأوردر اتأكد من المكالمة",
        body: "تم تأكيد طلبك يا {{1}} ✅\nرقم الطلب: {{2}}\nهيتجهز ويتشحن خلال يومين عمل، وهنبعتلك رقم البوليصة أول ما يتشحن.\nالمطلوب عند الاستلام: {{3}} جنيه.",
        example: ["ساره", "24B4EF7B", "655"],
    },
    {
        name: "order_shipped", purpose: "الأوردر اتشحن",
        body: "طلبك اتشحن يا {{1}} 🚚\nشركة الشحن: {{2}}\nرقم البوليصة: {{3}}\nالمندوب هيكلمك خلال 1 لـ 3 أيام. جهّز {{4}} جنيه عند الاستلام، ولو مش هتكون موجود ابعتلنا هنا.",
        example: ["ساره", "تيليغراف", "24B4EF7B", "655"],
    },
    {
        name: "delivery_failed", purpose: "المندوب ماقدرش يوصله",
        body: "يا {{1}}، المندوب حاول يوصلك طلبك رقم {{2}} النهارده بس ماقدرش.\nتحب نبعته تاني إمتى؟",
        example: ["ساره", "24B4EF7B"],
        buttons: ["بكرة", "بعد بكرة", "كلّموني"],
    },
    {
        name: "order_returning", purpose: "الشحنة راجعة",
        body: "يا {{1}}، طلبك رقم {{2}} راجع لنا من شركة الشحن عشان ماقدرناش نوصلك.\nلو لسه عايزه، دوس «ابعتوه تاني» وهنرتب ميعاد جديد.",
        example: ["ساره", "24B4EF7B"],
        buttons: ["ابعتوه تاني", "مش عايزه"],
    },
    {
        name: "order_delivered", purpose: "الأوردر اتسلم",
        body: "طلبك وصل يا {{1}} ✅ شكراً إنك اخترت {{2}}.\nلو فيه أي حاجة في الطلب مش مظبوطة، دوس «فيه مشكلة» وهنحلها على طول.",
        example: ["ساره", "Zuha Store"],
        buttons: ["كله تمام", "فيه مشكلة"],
    },
    {
        name: "confirmation_reminder", purpose: "ما ردش على التأكيد",
        body: "يا {{1}}، لسه مستنيين تأكيدك على طلبك ({{2}}) عشان نشحنه.\nلو تمام دوس «تأكيد»، ولو مش عايزه دوس «إلغاء».",
        example: ["ساره", "مطحنة بن وتوابل"],
        buttons: ["تأكيد", "إلغاء"],
    },
];

/** The body Meta's API expects for creating a template. */
export function templatePayload(t: TemplateDef) {
    const components: Record<string, unknown>[] = [
        { type: "BODY", text: t.body, example: { body_text: [t.example] } },
    ];
    if (t.buttons?.length) components.push({ type: "BUTTONS", buttons: t.buttons.map(text => ({ type: "QUICK_REPLY", text })) });
    return { name: t.name, language: "ar", category: "UTILITY", components };
}
