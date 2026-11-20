/**
 * The Meta app the system sends WhatsApp from ("Zuha System", on the XZino_Store
 * business portfolio) and its Embedded Signup configuration. Neither is a
 * secret; the app secret is WHATSAPP_APP_SECRET on the server only.
 */
export const WHATSAPP_APP_ID = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID || "3063881970646574";
export const WHATSAPP_CONFIG_ID = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID || "1534857181800962";
export const GRAPH_VERSION = "v25.0";
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const WHATSAPP_MIGRATION = "supabase/migrations/20261123_whatsapp_accounts.sql";
