/**
 * The Meta app the system sends WhatsApp from ("Zuha System", on the XZino_Store
 * business portfolio) and its Embedded Signup configuration. Neither is a
 * secret; the app secret is WHATSAPP_APP_SECRET on the server only.
 */
export const WHATSAPP_APP_ID = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID || "3063881970646574";
export const WHATSAPP_CONFIG_ID = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID || "1534857181800962";
/**
 * Zuha's number on the Cloud API (+20 11 00354568) and its WhatsApp account
 * on XZino_Store: not secrets, used when the token alone does not say which
 * number it is for.
 */
export const WHATSAPP_WABA_ID = process.env.WHATSAPP_WABA_ID || "2397259777694119";
export const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "1522742187579184";
/** What Meta sends back when the webhook URL is saved; not a secret (the app secret signs every message). */
export const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "zuha-system-whatsapp";
export const GRAPH_VERSION = "v25.0";
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const WHATSAPP_MIGRATION = "supabase/migrations/20261123_whatsapp_accounts.sql";
