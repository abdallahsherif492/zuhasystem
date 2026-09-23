/**
 * Governorate names as the rest of the system stores them.
 *
 * The English values must match the courier rate cards and the governorate
 * dropdowns; anything else matches no shipping rate and cannot be filtered.
 * People write them however they like, in Arabic or English, with or without
 * the hamza, so this folds what they typed onto the one stored name.
 */
export const GOVERNORATES = [
    "Cairo", "New Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag",
];

const fold = (s: string) => String(s || "")
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[^a-z؀-ۿ]+/g, "")
    // Every "ال" goes, spaced or not: "البحر الأحمر", "البحرالاحمر" and
    // "بحر احمر" are the same place, and no governorate needs it to be told apart.
    .replace(/ال/g, "");

const ALIASES: Record<string, string> = {
    "القاهره": "Cairo", "قاهره": "Cairo",
    "القاهرهالجديده": "New Cairo", "التجمع": "New Cairo", "التجمعالخامس": "New Cairo",
    "الجيزه": "Giza", "جيزه": "Giza",
    "الاسكندريه": "Alexandria", "اسكندريه": "Alexandria",
    "الدقهليه": "Dakahlia", "دقهليه": "Dakahlia",
    "البحرالاحمر": "Red Sea", "بحراحمر": "Red Sea",
    "البحيره": "Beheira", "بحيره": "Beheira",
    "الفيوم": "Fayoum", "فيوم": "Fayoum",
    "الغربيه": "Gharbiya", "غربيه": "Gharbiya",
    "الاسماعيليه": "Ismailia", "اسماعيليه": "Ismailia",
    "المنوفيه": "Monufia", "منوفيه": "Monufia",
    "المنيا": "Minya", "منيا": "Minya",
    "القليوبيه": "Qaliubiya", "قليوبيه": "Qaliubiya",
    "الواديالجديد": "New Valley", "واديجديد": "New Valley",
    "السويس": "Suez", "سويس": "Suez",
    "اسوان": "Aswan",
    "اسيوط": "Assiut",
    "بنيسويف": "Beni Suef",
    "بورسعيد": "Port Said",
    "دمياط": "Damietta",
    "الشرقيه": "Sharkia", "شرقيه": "Sharkia",
    "جنوبسيناء": "South Sinai",
    "كفرالشيخ": "Kafr Al Sheikh", "كفرشيخ": "Kafr Al Sheikh",
    "مطروح": "Matrouh", "مرسيمطروح": "Matrouh",
    "الاقصر": "Luxor", "اقصر": "Luxor",
    "قنا": "Qena",
    "شمالسيناء": "North Sinai",
    "سوهاج": "Sohag",
    // Big cities people write instead of the governorate
    "6 أكتوبر": "Giza", "أكتوبر": "Giza", "الشيخ زايد": "Giza", "الهرم": "Giza",
    "مدينة نصر": "Cairo", "المعادي": "Cairo", "حلوان": "Cairo", "مصر الجديدة": "Cairo", "وسط البلد": "Cairo",
    "المنصورة": "Dakahlia", "طنطا": "Gharbiya", "المحلة": "Gharbiya", "المحلة الكبرى": "Gharbiya",
    "الزقازيق": "Sharkia", "العاشر من رمضان": "Sharkia", "شبين الكوم": "Monufia",
    "بنها": "Qaliubiya", "شبرا الخيمة": "Qaliubiya", "دمنهور": "Beheira", "الغردقة": "Red Sea",
    "شرم الشيخ": "South Sinai", "العريش": "North Sinai",
    // English spellings the webhook and couriers have used
    "alsharqia": "Sharkia", "sharqia": "Sharkia", "gharbia": "Gharbiya", "qalyubia": "Qaliubiya",
    "kafrelsheikh": "Kafr Al Sheikh", "asyut": "Assiut", "faiyum": "Fayoum", "menofia": "Monufia",
    "alex": "Alexandria", "newcairo": "New Cairo",
};

const BY_FOLD = new Map<string, string>([
    ...GOVERNORATES.map(g => [fold(g), g] as [string, string]),
    ...Object.entries(ALIASES).map(([k, v]) => [fold(k), v] as [string, string]),
]);

/** The stored English name, or null when it is not a governorate we know. */
export function normalizeGovernorate(raw: string | null | undefined): string | null {
    const key = fold(String(raw ?? "").trim());
    if (!key) return null;
    return BY_FOLD.get(key) ?? null;
}
