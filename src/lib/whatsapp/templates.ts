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
    /** A product photo above the text. */
    imageHeader?: boolean;
    /** The same picture every time above the text, instead of the product's (a path on the site, or a full link). */
    fixedImage?: string;
    /** Buttons that open a link (after the reply buttons). */
    urlButtons?: { text: string; url: string }[];
}

/** Where the site's own pictures are served (public/whatsapp/…). */
export const SITE_URL = "https://www.e-commerx.com";
export const imageLink = (path: string) => (/^https?:\/\//.test(path) ? path : `${SITE_URL}${path}`);

const CONFIRM_BODY = "أهلاً {{1}}\nشكراً إنك طلبت من Zuha Store.\n\nبرجاء تأكيد طلبك:\n{{2}}\n\nالمطلوب عند الاستلام: {{3}} جنيه\n\nالرجاء الرد بكلمة «تأكيد» لتأكيد الأوردر.";

/**
 * The confirmation a new order gets (the first message the customer reads
 * from us): who it is from, exactly what was ordered and what it costs, where
 * it goes, and one clear thing to do. The products' pictures sit above it
 * (all of them, lib/whatsapp/collage.ts). «تعديل الطلب» keeps a customer who
 * wants something changed from cancelling. The confirm button keeps the word
 * «تأكيد»: the automation rules (the deposit ones) look for it.
 */
const CONFIRM_V2_BODY = [
    "أهلاً {{1}} 👋",
    "طلبك من *Zuha Store* وصلنا، وفاضل خطوة واحدة بس عشان نبدأ نجهّزه: *تأكيدك*.",
    "",
    "🛍️ *طلبك:* {{2}}",
    "💵 *هتدفع عند الاستلام:* {{3}} جنيه",
    "📍 *العنوان:* {{4}}",
    "🗺️ *المحافظة:* {{5}}",
    "",
    "✅ لو كل حاجة مظبوطة دوس «تأكيد الطلب» وهنبدأ نجهّزه على طول.",
    "✏️ لو عايز تغيّر حاجة (منتج، عدد، عنوان، رقم) دوس «تعديل الطلب».",
    "",
    "⏳ الطلب مش هيتشحن غير بعد تأكيدك.",
].join("\n");

/**
 * The reminder to a customer who has not confirmed: the same order details
 * and pictures as the confirmation, and plainly what happens otherwise (an
 * unconfirmed order is cancelled, by hand or on its own).
 */
const REMINDER_V2_BODY = [
    "يا {{1}}، طلبك لسه مستني تأكيدك ⏳",
    "",
    "🛍️ *طلبك:* {{2}}",
    "💵 *هتدفع عند الاستلام:* {{3}} جنيه",
    "",
    "مش هنقدر نجهّز الطلب ولا نشحنه غير بعد تأكيدك.",
    "✅ دوس «تأكيد الطلب» وهنبدأ نجهّزه على طول.",
    "✏️ عايز تغيّر حاجة؟ دوس «تعديل الطلب».",
    "",
    "⚠️ لو الطلب ماتأكدش، هيتلغي تلقائي.",
].join("\n");

export const TEMPLATES: TemplateDef[] = [
    {
        // To a moderator once a day as their shift starts: their «جاهز» opens the 24-hour window,
        // so the shipping answers sent to them that day are free text (lib/whatsapp/team-alerts.ts).
        name: "team_shift_start", purpose: "للمودريتور أول الشيفت: «جاهز» عشان رسايل متابعة الشحن توصله ببلاش طول اليوم",
        body: "صباح الخير يا {{1}} 👋\nشيفتك بدأ، والنهارده هتوصلك هنا ردود العملاء على رسايل متابعة الشحن عشان تحوّلها لجروب شركة الشحن.\nدوس «جاهز» عشان الرسايل توصلك طول اليوم.",
        example: ["مريم"],
        buttons: ["جاهز"],
    },
    {
        // To a moderator, not a customer: forwarded by them to the courier's group (lib/whatsapp/team-alerts.ts).
        name: "team_shipping_update", purpose: "للمودريتور: رد العميل على متابعة الشحن، جاهز يتبعت لجروب شركة الشحن",
        body: "📦 *متابعة شحنة: {{1}}*\nالبوليصة: {{2}}\nكود الأوردر: {{3}}\nالعميل: {{4}}\n\n{{5}}\n\n💬 ردود العميل: {{6}}\n\nبرجاء التنفيذ في أسرع وقت 🙏",
        example: ["تيليغراف", "123456789", "24B4EF7B", "ساره — 01012345678 — الجيزة", "⛔ العميل مش عايز الشحنة: برجاء إيقاف أي محاولات عليها ورجوعها مرتجع بسرعة.", "«مش عايزه» ← «مش هكون موجودة الأسبوع ده»"],
    },
    {
        name: "confirmation_reminder_v2", purpose: "تذكير بالتأكيد: بصور المنتجات والمبلغ، وإن الطلب هيتلغي لو ماتأكدش",
        body: REMINDER_V2_BODY,
        example: ["ساره", "مطحنة بن وتوابل (عدد 1)، طقم بلانشات خشب (عدد 2)", "655"],
        buttons: ["تأكيد الطلب", "تعديل الطلب", "إلغاء الطلب"],
        imageHeader: true,
    },
    {
        name: "order_confirm_v2", purpose: "أوردر جديد: تأكيد واضح بصور كل المنتجات والعنوان، وزرار تعديل",
        body: CONFIRM_V2_BODY,
        example: ["ساره", "مطحنة بن وتوابل (عدد 1)، طقم بلانشات خشب (عدد 2)", "655", "مدينة نصر، شارع عباس العقاد، عمارة 12", "القاهرة"],
        buttons: ["تأكيد الطلب", "تعديل الطلب", "إلغاء الطلب"],
        imageHeader: true,
    },
    {
        name: "order_confirm_photo", purpose: "أوردر جديد بصورة المنتج: برجاء التأكيد",
        body: CONFIRM_BODY,
        example: ["ساره", "مطحنة بن وتوابل (عدد 1)، طقم بلانشات خشب (عدد 2)", "655"],
        buttons: ["تأكيد", "إلغاء الطلب"],
        imageHeader: true,
    },
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
        name: "delivery_failed_photo", purpose: "المندوب ماقدرش يوصله (بصورة المنتج)",
        body: "يا {{1}}، المندوب حاول يوصلك طلبك النهارده بس ماقدرش:\n{{2}}\nرقم الطلب: {{3}}\n\nتحب نبعته تاني إمتى؟",
        example: ["ساره", "مطحنة بن وتوابل (عدد 1)", "24B4EF7B"],
        buttons: ["بكرة", "بعد بكرة", "كلّموني"],
        imageHeader: true,
    },
    {
        name: "order_returning_photo", purpose: "الشحنة راجعة (بصورة المنتج)",
        body: "يا {{1}}، طلبك راجع لنا من شركة الشحن عشان ماقدرناش نوصلك:\n{{2}}\nرقم الطلب: {{3}}\n\nلو لسه عايزه، دوس «ابعتوه تاني» وهنرتب ميعاد جديد.",
        example: ["ساره", "مطحنة بن وتوابل (عدد 1)", "24B4EF7B"],
        buttons: ["ابعتوه تاني", "مش عايزه"],
        imageHeader: true,
    },
    {
        name: "order_returning", purpose: "الشحنة راجعة",
        body: "يا {{1}}، طلبك رقم {{2}} راجع لنا من شركة الشحن عشان ماقدرناش نوصلك.\nلو لسه عايزه، دوس «ابعتوه تاني» وهنرتب ميعاد جديد.",
        example: ["ساره", "24B4EF7B"],
        buttons: ["ابعتوه تاني", "مش عايزه"],
    },
    {
        name: "order_delivered_photo", purpose: "الأوردر اتسلم (بصورة زُهى وزرار تصفح المنتجات)",
        body: "طلبك وصل يا {{1}} ✅\nشكراً إنك اخترت {{2}}، ونتمنى المنتجات تعجبك.\nلو فيه أي حاجة في الطلب مش مظبوطة، دوس «فيه مشكلة» وهنحلها على طول.",
        example: ["ساره", "Zuha Store"],
        buttons: ["فيه مشكلة"],
        urlButtons: [{ text: "تصفح المنتجات", url: "https://www.zuhastore.com" }],
        imageHeader: true,
        fixedImage: "/whatsapp/zuha-order-delivered.jpg",
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

export const templateDef = (name: string | null | undefined) => TEMPLATES.find(t => t.name === name) ||
    (name === "order_confirmation" ? { ...TEMPLATES.find(t => t.name === "order_confirm")!, name, buttons: ["تأكيد"] } : undefined);

/** The text the customer reads: the template with its values filled in. */
export function renderTemplate(name: string, params: string[]): string | null {
    const t = templateDef(name);
    return t ? t.body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "") : null;
}

/** The body Meta's API expects for creating a template; a photo header needs an uploaded sample. */
export function templatePayload(t: TemplateDef, headerHandle?: string) {
    const components: Record<string, unknown>[] = [];
    if (t.imageHeader && headerHandle) components.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [headerHandle] } });
    components.push({ type: "BODY", text: t.body, example: { body_text: [t.example] } });
    const buttons = [
        ...(t.buttons || []).map(text => ({ type: "QUICK_REPLY", text })),
        ...(t.urlButtons || []).map(b => ({ type: "URL", text: b.text, url: b.url })),
    ];
    if (buttons.length) components.push({ type: "BUTTONS", buttons });
    return { name: t.name, language: "ar", category: "UTILITY", components };
}
