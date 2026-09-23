/**
 * Telling Meta when a signup actually starts using the system.
 *
 * CompleteRegistration fires the moment the signup form is submitted — before
 * the email is confirmed and long before anything is set up. Optimising ads on
 * it teaches Meta to find people who fill in forms, and 25 of 26 who did so
 * never added a product. This sends a second, later event, StartTrial, once a
 * store shows real use (a product, an order, or a connected platform), so ads
 * can be optimised on merchants who stay instead.
 *
 * The existing registration event is untouched, so running campaigns keep
 * working; switch their optimisation to StartTrial when it has data.
 *
 * The pixel is off everywhere inside the app. This loads it for the one event
 * and removes it again, and only when a System Admin has it switched on.
 */
import { supabase } from "@/lib/supabase";
import { safeLocal } from "@/lib/safe-storage";
import { disableMetaPixel, initMetaPixel, trackPixelEvent, whenPixelReady } from "@/lib/meta-pixel";

const flag = (businessId: string) => `ecx:activationReported:${businessId}`;

export const activationAlreadyReported = (businessId: string) => safeLocal.get(flag(businessId)) === "1";

export async function reportActivation(businessId: string, reason: "product" | "order" | "platform") {
    if (typeof window === "undefined" || activationAlreadyReported(businessId)) return;
    // Mark first: a second tab or a remount must not double-count one store.
    safeLocal.set(flag(businessId), "1");

    const { data } = await supabase
        .from("platform_settings")
        .select("meta_pixel_enabled, meta_pixel_id")
        .eq("id", "global")
        .single();
    const pixelId = (data?.meta_pixel_id || "").trim();
    if (!data?.meta_pixel_enabled || !pixelId) return;

    initMetaPixel(pixelId);
    trackPixelEvent("StartTrial", { content_name: `store_activated_${reason}`, value: 0, currency: "EGP" });
    // Let the beacon leave before the SDK is removed again.
    await whenPixelReady(4000);
    await new Promise(resolve => setTimeout(resolve, 1500));
    disableMetaPixel();
}
