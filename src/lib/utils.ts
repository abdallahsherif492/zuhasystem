import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-EG", {
    style: "currency",
    currency: "EGP",
  }).format(amount);
}

/**
 * Fold text for searching so Arabic matches the way people actually type it.
 *
 * Staff rarely type hamza or diacritics — searching "احمر" must find "أحمر",
 * and "قميص" must find "قميصـــ". Without this, a search box quietly returns
 * nothing for a product that plainly exists, which reads as a broken feature.
 *
 * Also folds Arabic-Indic digits, since SKUs and sizes get typed both ways.
 */
export function normalizeSearchText(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    // alef forms -> bare alef
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")   // ta marbuta -> ha
    .replace(/ى/g, "ي")   // alef maqsura -> ya
    .replace(/ـ/g, "")         // tatweel
    .replace(/[ً-ْ]/g, "") // harakat
    // Arabic-Indic and Eastern Arabic-Indic digits -> ASCII
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\s+/g, " ")
    .trim();
}
