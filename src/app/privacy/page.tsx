import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy · eCommerx", description: "How eCommerx handles customer data." };

/**
 * The privacy policy Meta asks for before a WhatsApp app can go live.
 * Public: linked from the app settings on developers.facebook.com.
 */
export default function PrivacyPage() {
    return (
        <main dir="rtl" className="mx-auto max-w-2xl space-y-6 p-6 text-[15px] leading-relaxed">
            <h1 className="text-2xl font-bold">سياسة الخصوصية</h1>
            <p>eCommerx نظام داخلي بتستخدمه متاجر زُهى وليلى هوم لإدارة الطلبات والشحن والتواصل مع العملاء.</p>
            <section className="space-y-2">
                <h2 className="text-lg font-semibold">البيانات اللي بنحتفظ بيها</h2>
                <p>اسم العميل ورقم موبايله وعنوانه وتفاصيل طلبه، ورسايل الواتساب اللي بيبعتها أو بتتبعتله بخصوص طلبه.</p>
            </section>
            <section className="space-y-2">
                <h2 className="text-lg font-semibold">بنستخدمها في إيه</h2>
                <p>تأكيد الطلب وتوصيله ومتابعة الشحن والرد على العميل. ما بنبيعش البيانات ولا بنشاركها غير مع شركة الشحن اللي بتوصّل الطلب.</p>
            </section>
            <section id="data-deletion" className="space-y-2">
                <h2 className="text-lg font-semibold">مسح البيانات</h2>
                <p>لو عايز بياناتك تتمسح، ابعتلنا على واتساب المتجر أو على الإيميل alucardstore058@gmail.com، وهنمسحها خلال 30 يوم، ما عدا اللي القانون بيطلب نحتفظ بيه زي الفواتير.</p>
            </section>
            <hr />
            <section dir="ltr" className="space-y-2 text-left text-sm text-muted-foreground">
                <h2 className="font-semibold">Privacy policy (English)</h2>
                <p>eCommerx is the internal system Zuha Store and Layla Home use to manage orders, shipping and customer messages. We keep customers&apos; names, phone numbers, addresses, order details and WhatsApp messages about their orders, and use them only to confirm, deliver and follow up orders. We do not sell or share them except with the courier delivering the order. To have your data deleted, message the store on WhatsApp or email alucardstore058@gmail.com; we delete it within 30 days, except records the law requires us to keep.</p>
            </section>
        </main>
    );
}
