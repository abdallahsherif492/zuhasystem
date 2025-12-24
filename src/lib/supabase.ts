import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co"
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key"

if (supabaseUrl.includes("placeholder")) {
    console.error("CRITICAL: Supabase URL is not configured. Please add NEXT_PUBLIC_SUPABASE_URL to your .env or Vercel project settings.");
}

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
