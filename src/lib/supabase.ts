import { createBrowserClient } from '@supabase/ssr'

// FALLBACK: Hardcoded keys to unblock Vercel deployment issues
const FALLBACK_URL = "https://telkkknuygjejmqcvyev.supabase.co";
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL !== "undefined")
    ? process.env.NEXT_PUBLIC_SUPABASE_URL
    : FALLBACK_URL;

const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== "undefined")
    ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    : FALLBACK_KEY;

if (supabaseUrl.includes("placeholder")) {
    console.warn("Using Placeholder URL - Connection will fail");
}

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
